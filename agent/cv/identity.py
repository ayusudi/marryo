"""Identity clustering: find recurring people across valid clips.

Detects faces (Haar), embeds crops (LBP histogram), clusters by cosine distance.
Applies stricter detection, per-crop quality gates, and temporal evidence filters
to reduce Haar false positives (non-face junk clusters).
"""

from __future__ import annotations

import secrets
from pathlib import Path

import cv2
import numpy as np

from cv.validate import sample_frames

COSINE_MERGE_THRESHOLD = 0.35
FRAMES_PER_CLIP = 8
MAX_THUMBS_PER_PERSON = 3

# Haar detection — stricter than validate's soft face-count pass
HAAR_SCALE_FACTOR = 1.15
HAAR_MIN_NEIGHBORS = 6
HAAR_MIN_SIZE_FLOOR = 40
HAAR_MIN_SIZE_FRAC = 0.08  # of min(frame w, h)

# Per-crop quality gates (reject before embedding)
MIN_CROP_SIDE = 64
BRIGHTNESS_MIN = 0.08
BRIGHTNESS_MAX = 0.92
CROP_BLUR_MIN = 25.0  # Laplacian variance on padded crop
ASPECT_RATIO_MIN = 0.65  # face boxes are roughly square
ASPECT_RATIO_MAX = 1.55

# Temporal / cluster evidence
MAX_DETECTIONS_PER_FRAME = 5  # keep largest boxes only
MIN_CLUSTER_FRAMES = 2  # keep cluster if seen in ≥N distinct frames
MIN_CLUSTER_CLIPS = 2  # …or ≥N distinct clips


def _cascade_path() -> str:
    bundled = Path(__file__).resolve().parent / "data" / "haarcascade_frontalface_default.xml"
    if bundled.is_file():
        return str(bundled)
    return str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")


def detect_faces(frame: np.ndarray) -> list[dict[str, float]]:
    """Detect faces in a single frame, returning bounding boxes with confidences.

    Uses stricter Haar params than clip validation to cut false positives.
    Caps to the largest MAX_DETECTIONS_PER_FRAME boxes by area.
    """
    detector = cv2.CascadeClassifier(_cascade_path())
    if detector.empty():
        return []
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    side = max(HAAR_MIN_SIZE_FLOOR, int(HAAR_MIN_SIZE_FRAC * min(frame.shape[0], frame.shape[1])))
    boxes = detector.detectMultiScale(
        gray,
        scaleFactor=HAAR_SCALE_FACTOR,
        minNeighbors=HAAR_MIN_NEIGHBORS,
        minSize=(side, side),
    )
    scored: list[tuple[float, dict[str, float]]] = []
    for x, y, w, h in boxes:
        scored.append(
            (
                float(w * h),
                {"x": float(x), "y": float(y), "w": float(w), "h": float(h), "confidence": 1.0},
            )
        )
    scored.sort(key=lambda t: -t[0])
    return [box for _, box in scored[:MAX_DETECTIONS_PER_FRAME]]


def _padded_crop(frame: np.ndarray, box: dict[str, float]) -> np.ndarray | None:
    x, y, w, h = int(box["x"]), int(box["y"]), int(box["w"]), int(box["h"])
    pad = int(0.1 * max(w, h))
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(frame.shape[1], x + w + pad)
    y1 = min(frame.shape[0], y + h + pad)
    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    return crop


def _crop_brightness(crop: np.ndarray) -> float:
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float(np.mean(gray) / 255.0)


def _crop_laplacian_var(crop: np.ndarray) -> float:
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _crop_passes_quality(crop: np.ndarray, box: dict[str, float]) -> tuple[bool, float]:
    """Return (ok, sharpness). Sharpness is Laplacian variance for thumb ranking."""
    ch, cw = crop.shape[:2]
    if min(ch, cw) < MIN_CROP_SIDE:
        return False, 0.0

    bw, bh = float(box["w"]), float(box["h"])
    if bh < 1.0:
        return False, 0.0
    aspect = bw / bh
    if aspect < ASPECT_RATIO_MIN or aspect > ASPECT_RATIO_MAX:
        return False, 0.0

    brightness = _crop_brightness(crop)
    if brightness < BRIGHTNESS_MIN or brightness > BRIGHTNESS_MAX:
        return False, 0.0

    sharp = _crop_laplacian_var(crop)
    if sharp < CROP_BLUR_MIN:
        return False, 0.0

    return True, sharp


def _lbp_histogram(gray: np.ndarray) -> np.ndarray:
    """Uniform-ish LBP (8-neighbour) histogram over a grayscale face crop."""
    h, w = gray.shape
    if h < 3 or w < 3:
        return np.zeros(256, dtype=np.float64)
    center = gray[1:-1, 1:-1].astype(np.int16)
    codes = np.zeros_like(center, dtype=np.uint8)
    offsets = [(-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1)]
    for bit, (dy, dx) in enumerate(offsets):
        neighbour = gray[1 + dy : h - 1 + dy, 1 + dx : w - 1 + dx].astype(np.int16)
        codes |= ((neighbour >= center).astype(np.uint8) << bit)
    hist, _ = np.histogram(codes.ravel(), bins=256, range=(0, 256))
    return hist.astype(np.float64)


def _face_embedding_from_crop(crop: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
    hist = _lbp_histogram(gray)
    norm = np.linalg.norm(hist)
    if norm < 1e-9:
        return hist
    return hist / norm


def _face_embedding(frame: np.ndarray, box: dict[str, float]) -> np.ndarray:
    crop = _padded_crop(frame, box)
    if crop is None:
        return np.zeros(256, dtype=np.float64)
    return _face_embedding_from_crop(crop)


def embed_faces(frame: np.ndarray, boxes: list[dict[str, float]]) -> list[list[float]]:
    """Produce a comparable embedding vector per detected face."""
    return [_face_embedding(frame, box).tolist() for box in boxes]


def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-9:
        return 1.0
    return float(1.0 - np.dot(a, b) / denom)


def cluster(embeddings: list[list[float]], threshold: float = COSINE_MERGE_THRESHOLD) -> list[int]:
    """Greedy threshold clustering: merge into an existing cluster if cosine distance < threshold."""
    if not embeddings:
        return []
    vectors = [np.asarray(e, dtype=np.float64) for e in embeddings]
    labels = [-1] * len(vectors)
    centroids: list[np.ndarray] = []
    counts: list[int] = []

    for i, vec in enumerate(vectors):
        best_j = -1
        best_dist = float("inf")
        for j, centroid in enumerate(centroids):
            dist = _cosine_distance(vec, centroid)
            if dist < best_dist:
                best_dist = dist
                best_j = j
        if best_j >= 0 and best_dist < threshold:
            labels[i] = best_j
            n = counts[best_j]
            centroids[best_j] = (centroids[best_j] * n + vec) / (n + 1)
            counts[best_j] = n + 1
        else:
            labels[i] = len(centroids)
            centroids.append(vec.copy())
            counts.append(1)
    return labels


def _new_person_id() -> str:
    return f"per_{secrets.token_hex(8)}"


def _cluster_has_evidence(
    detections: list[dict[str, object]],
    indices: list[int],
    *,
    min_frames: int = MIN_CLUSTER_FRAMES,
    min_clips: int = MIN_CLUSTER_CLIPS,
) -> bool:
    """Keep clusters that appear in ≥min_frames distinct frames OR ≥min_clips clips."""
    frames = {detections[i]["frame_key"] for i in indices}
    clips = {detections[i]["clip_id"] for i in indices}
    return len(frames) >= min_frames or len(clips) >= min_clips


def cluster_project(
    clip_paths: dict[str, str],
    out_dir: str,
    frames_per_clip: int = FRAMES_PER_CLIP,
    *,
    min_cluster_frames: int = MIN_CLUSTER_FRAMES,
    min_cluster_clips: int = MIN_CLUSTER_CLIPS,
) -> dict[str, object]:
    """Run detection → quality filter → embed → cluster across all clips.

    Writes thumbnails under out_dir (sharpest crops preferred).

    Returns:
      {
        "persons": [{ personId, thumbnailUris, clipIds, faceCount }],
        "warnings": [...]
      }
    """
    detections: list[dict[str, object]] = []
    # Each item: clip_id, frame_key, embedding, crop, sharpness

    for clip_id, path in clip_paths.items():
        frames = sample_frames(path, count=frames_per_clip)
        for frame_idx, (_ts, frame) in enumerate(frames):
            frame_key = f"{clip_id}:{frame_idx}"
            boxes = detect_faces(frame)
            for box in boxes:
                crop = _padded_crop(frame, box)
                if crop is None:
                    continue
                ok, sharpness = _crop_passes_quality(crop, box)
                if not ok:
                    continue
                emb = _face_embedding_from_crop(crop)
                detections.append(
                    {
                        "clip_id": clip_id,
                        "frame_key": frame_key,
                        "embedding": emb,
                        "crop": crop.copy(),
                        "sharpness": sharpness,
                    }
                )

    warnings: list[str] = []
    if not detections:
        warnings.append("low_quality_or_no_faces")
        warnings.append("couldnt_detect_two_distinct_people")
        return {"persons": [], "warnings": warnings}

    embeddings = [d["embedding"].tolist() for d in detections]
    labels = cluster(embeddings)

    by_label: dict[int, list[int]] = {}
    for idx, label in enumerate(labels):
        by_label.setdefault(label, []).append(idx)

    out_root = Path(out_dir)
    out_root.mkdir(parents=True, exist_ok=True)

    persons: list[dict[str, object]] = []
    for label, indices in sorted(by_label.items(), key=lambda kv: -len(kv[1])):
        if not _cluster_has_evidence(
            detections,
            indices,
            min_frames=min_cluster_frames,
            min_clips=min_cluster_clips,
        ):
            continue

        person_id = _new_person_id()
        clip_ids = sorted({str(detections[i]["clip_id"]) for i in indices})
        person_dir = out_root / person_id
        person_dir.mkdir(parents=True, exist_ok=True)

        # Prefer sharpest crops for thumbnails (stable secondary key by index)
        ranked = sorted(indices, key=lambda i: (-float(detections[i]["sharpness"]), i))
        chosen = ranked[:MAX_THUMBS_PER_PERSON]

        thumb_uris: list[str] = []
        for t_idx, det_i in enumerate(chosen):
            crop = detections[det_i]["crop"]
            assert isinstance(crop, np.ndarray)
            thumb_name = f"thumb-{t_idx}.jpg"
            thumb_path = person_dir / thumb_name
            cv2.imwrite(str(thumb_path), crop, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            # Relative path under thumbs root — TS layer turns this into storage URIs
            thumb_uris.append(str(Path(person_id) / thumb_name))

        persons.append(
            {
                "personId": person_id,
                "thumbnailUris": thumb_uris,
                "clipIds": clip_ids,
                "faceCount": len(indices),
            }
        )

    if len(persons) == 0:
        warnings.append("low_quality_or_no_faces")
    if len(persons) < 2:
        warnings.append("couldnt_detect_two_distinct_people")

    return {"persons": persons, "warnings": warnings}
