"""Visual validation of uploaded clips: is this usable wedding footage?

Samples a handful of frames with OpenCV — never decode the whole file for Gemini.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class ClipProbe:
    """Container-level facts about a clip, read without decoding the whole file."""

    duration_s: float
    fps: float
    width: int
    height: int
    frame_count: int


def probe(path: str) -> ClipProbe:
    """Read duration, frame rate and resolution from a video container."""
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        raise ValueError(f"could not open video: {path}")
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        return ClipProbe(
            duration_s=frame_count / fps if fps else 0.0,
            fps=fps,
            width=int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            height=int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            frame_count=frame_count,
        )
    finally:
        capture.release()


def sample_frames(path: str, count: int = 8) -> list[tuple[float, np.ndarray]]:
    """Sample `count` frames spread evenly across the clip, as (timestamp, BGR frame)."""
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        raise ValueError(f"could not open video: {path}")
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS)) or 25.0
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if frame_count <= 0:
            # Fall back to reading sequentially until we have samples or EOF.
            frames: list[tuple[float, np.ndarray]] = []
            index = 0
            while len(frames) < count:
                ok, frame = capture.read()
                if not ok:
                    break
                frames.append((index / fps, frame))
                index += max(1, frame_count // count) if frame_count > 0 else 5
                for _ in range(max(0, (frame_count // count) - 1) if frame_count > 0 else 4):
                    capture.grab()
            return frames

        indices = np.linspace(0, max(frame_count - 1, 0), num=min(count, frame_count), dtype=int)
        sampled: list[tuple[float, np.ndarray]] = []
        for idx in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            sampled.append((float(idx) / fps, frame))
        return sampled
    finally:
        capture.release()


def _mean_brightness(frame: np.ndarray) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(np.mean(gray) / 255.0)


def _laplacian_variance(frame: np.ndarray) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _cascade_path() -> str:
    bundled = Path(__file__).resolve().parent / "data" / "haarcascade_frontalface_default.xml"
    if bundled.is_file():
        return str(bundled)
    # Older opencv-python wheels shipped cascades here; OpenCV 5 wheels often do not.
    fallback = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    return str(fallback)


def _count_faces(frame: np.ndarray) -> int:
    """Detect faces with OpenCV's Haar cascade."""
    detector = cv2.CascadeClassifier(_cascade_path())
    if detector.empty():
        return 0
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(40, 40))
    return int(len(faces))


def assess(path: str, frame_count: int = 8) -> dict[str, object]:
    """Judge whether a clip is usable enough to spend Gemini tokens on.

    Returns metrics, machine warnings, and human-readable per-check results
    (score, threshold, pass/fail, reason, detail, implication) for the studio UI.
    """
    frames = sample_frames(path, count=frame_count)
    if not frames:
        return {
            "valid": False,
            "warnings": ["no_frames"],
            "metrics": {"brightness": 0.0, "blur": 0.0, "faceCount": 0},
            "frames_sampled": 0,
            "summary": (
                "Rejected — we could not decode any video frames from this file. "
                "Without frames we cannot measure brightness, sharpness, or faces, "
                "so this clip cannot enter the film."
            ),
            "verdict_detail": (
                "Technical read failed before visual scoring. Re-export as H.264 MP4 "
                "or MOV and try again."
            ),
            "checks": [
                {
                    "id": "frames",
                    "label": "Decodable frames",
                    "passed": False,
                    "score": 0,
                    "unit": "frames sampled",
                    "threshold": "≥ 1",
                    "reason": "OpenCV opened the file but could not sample any frames.",
                    "detail": (
                        "We spread sample points evenly across the timeline. "
                        "Zero readable frames usually means a corrupt container, "
                        "an unsupported codec, or an empty file."
                    ),
                    "implication": "Excluded from People, Direct, and the final film.",
                }
            ],
        }

    brightnesses = [_mean_brightness(frame) for _, frame in frames]
    blurs = [_laplacian_variance(frame) for _, frame in frames]
    face_counts = [_count_faces(frame) for _, frame in frames]

    mean_brightness = float(np.mean(brightnesses))
    mean_blur = float(np.mean(blurs))
    total_faces = int(sum(face_counts))
    near_black_ratio = sum(1 for b in brightnesses if b < 0.05) / len(brightnesses)
    n = len(frames)

    warnings: list[str] = []
    if near_black_ratio >= 0.75 or mean_brightness < 0.08:
        warnings.append("near_black")
    if mean_brightness > 0.92:
        warnings.append("overexposed")
    if mean_blur < 15.0:
        warnings.append("too_blurry")
    if total_faces == 0:
        warnings.append("no_faces")

    hard_fail = "near_black" in warnings
    valid = len(warnings) == 0

    if "near_black" in warnings:
        bright_reason = (
            f"Failed — mean brightness is {mean_brightness:.2f} "
            f"(need 0.08–0.92). {near_black_ratio:.0%} of the {n} sampled frames "
            "were near black."
        )
        bright_detail = (
            "Brightness is the average gray-level of sampled frames, scaled 0 (black) "
            "to 1 (white). We reject clips that are mostly black or extremely dim "
            "because faces, clothes, and venue detail will not read on screen."
        )
        bright_implication = (
            "This alone is enough to exclude the clip from the story cut."
        )
        bright_passed = False
    elif "overexposed" in warnings:
        bright_reason = (
            f"Failed — mean brightness is {mean_brightness:.2f}, above the 0.92 ceiling."
        )
        bright_detail = (
            "Highlights are crushed toward white. Skin tones and dress detail will "
            "look washed out, so we do not keep overexposed clips for the highlight film."
        )
        bright_implication = "Excluded until you provide a better-exposed take."
        bright_passed = False
    else:
        bright_reason = (
            f"Passed — mean brightness {mean_brightness:.2f} sits inside 0.08–0.92 "
            f"across {n} evenly spaced frames."
        )
        bright_detail = (
            "We average luma over grayscale conversions of each sample. Mid-range "
            "values leave room for faces and venue color without crushing blacks or whites."
        )
        bright_implication = "Usable lighting for later scene analysis and the edit."
        bright_passed = True

    if "too_blurry" in warnings:
        sharp_reason = (
            f"Failed — sharpness score {mean_blur:.1f} is below the minimum of 15.0."
        )
        sharp_detail = (
            "Sharpness is Laplacian variance on grayscale frames: higher means more "
            "edge energy (crisper). Low scores usually mean motion blur, soft focus, "
            "or heavy compression."
        )
        sharp_implication = (
            "Soft clips look weak when projected; we leave them out of the Film Director."
        )
        sharp_passed = False
    else:
        sharp_reason = (
            f"Passed — sharpness score {mean_blur:.1f} clears the ≥ 15 threshold "
            f"(measured on {n} frames)."
        )
        sharp_detail = (
            "Laplacian variance rewards fine edge detail. Your clip has enough "
            "definition to survive title cards and a large-screen cut."
        )
        sharp_implication = "Clear enough for scored moments and the final render."
        sharp_passed = True

    if "no_faces" in warnings:
        face_reason = (
            f"Failed — 0 face detections across {n} sampled frames (need at least 1)."
        )
        face_detail = (
            "We run an OpenCV Haar frontal-face detector on each sample. Wide shots, "
            "backs-to-camera, heavy occlusion, or extreme angles can score zero even "
            "when people are present — but with no detections we cannot later cluster "
            "bride/groom identity from this clip."
        )
        face_implication = (
            "Excluded from identity clustering and from people-led story beats."
        )
        face_passed = False
    else:
        face_reason = (
            f"Passed — {total_faces} face detection(s) across {n} sampled frames."
        )
        face_detail = (
            "Detections are summed across samples (the same person may count more than "
            "once). This is a presence signal for storytelling, not a unique-person count."
        )
        face_implication = (
            "Eligible for People labeling and for moments that feature the couple."
        )
        face_passed = True

    checks = [
        {
            "id": "brightness",
            "label": "Brightness",
            "passed": bright_passed,
            "score": round(mean_brightness, 4),
            "unit": "0–1 mean luma",
            "threshold": "0.08–0.92",
            "reason": bright_reason,
            "detail": bright_detail,
            "implication": bright_implication,
        },
        {
            "id": "sharpness",
            "label": "Sharpness",
            "passed": sharp_passed,
            "score": round(mean_blur, 2),
            "unit": "Laplacian variance",
            "threshold": "≥ 15",
            "reason": sharp_reason,
            "detail": sharp_detail,
            "implication": sharp_implication,
        },
        {
            "id": "faces",
            "label": "Faces",
            "passed": face_passed,
            "score": total_faces,
            "unit": "detections in samples",
            "threshold": "≥ 1",
            "reason": face_reason,
            "detail": face_detail,
            "implication": face_implication,
        },
    ]

    failed_labels = [c["label"] for c in checks if not c["passed"]]
    if valid:
        summary = (
            f"Kept for the film — all three visual checks passed on {n} sampled frames "
            f"(brightness {mean_brightness:.2f}, sharpness {mean_blur:.1f}, "
            f"{total_faces} face detections)."
        )
        verdict_detail = (
            "This clip advances to People (optional face labeling), then scene detection "
            "and the Film Director. Rejected clips never reach those stages."
        )
    elif hard_fail:
        summary = (
            f"Rejected — too dark to use (brightness {mean_brightness:.2f}; "
            f"{near_black_ratio:.0%} of samples near black). "
            + (
                f"Also failed: {', '.join(failed_labels[1:])}."
                if len(failed_labels) > 1
                else ""
            )
        )
        verdict_detail = (
            "Near-black footage cannot carry ceremony or couple moments. "
            "Upload a brighter take if you want this moment in the cut."
        )
    else:
        summary = (
            f"Rejected — failed {', '.join(failed_labels)} "
            f"(brightness {mean_brightness:.2f}, sharpness {mean_blur:.1f}, "
            f"{total_faces} faces). The clip stays listed so you can see why."
        )
        verdict_detail = (
            "Failed checks block this file from identity clustering and from the "
            "Film Director’s candidate pool. Fix the issue in-camera or replace the clip."
        )

    return {
        "valid": valid,
        "warnings": warnings,
        "metrics": {
            "brightness": round(mean_brightness, 4),
            "blur": round(mean_blur, 2),
            "faceCount": total_faces,
        },
        "frames_sampled": n,
        "summary": summary.strip(),
        "verdict_detail": verdict_detail,
        "checks": checks,
    }
