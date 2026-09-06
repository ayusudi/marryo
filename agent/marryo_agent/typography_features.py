"""Build typography feature vector X from moments + project prefs."""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from marryo_agent.config_loader import derive_theme


def _norm_hist(values: list[str]) -> dict[str, float]:
    if not values:
        return {}
    counts = Counter(v.strip().lower() for v in values if v and str(v).strip())
    total = sum(counts.values()) or 1
    return {k: c / total for k, c in counts.items()}


def _name_chars(couple_names: list[Any]) -> tuple[int, str, bool]:
    """Return (char_count, joined_display, all_latinish)."""
    parts: list[str] = []
    for entry in couple_names or []:
        if isinstance(entry, dict):
            name = str(entry.get("name") or "").strip()
        else:
            name = str(entry).strip()
        if name:
            parts.append(name)
    joined = " & ".join(parts) if len(parts) == 2 else (parts[0] if parts else "")
    # Allow basic Latin letters, spaces, hyphen, apostrophe, ampersand.
    latinish = bool(joined) and bool(re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿ\s\-'.&]+", joined))
    return len(joined.replace(" ", "")), joined, latinish


def _relative_luminance(rgb: tuple[float, float, float]) -> float:
    def channel(c: float) -> float:
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def sample_palette_from_videos(
    video_paths: list[str],
    frames_per_video: int = 3,
) -> dict[str, Any]:
    """Cheap dominant luminance / hue bucket from a few frames."""
    pixels: list[np.ndarray] = []
    for path in video_paths[:2]:
        if not path or not Path(path).exists():
            continue
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            continue
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total <= 0:
            cap.release()
            continue
        indices = [int(total * (i + 1) / (frames_per_video + 1)) for i in range(frames_per_video)]
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            small = cv2.resize(frame, (64, 36), interpolation=cv2.INTER_AREA)
            # OpenCV BGR → RGB flat
            rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).reshape(-1, 3).astype(np.float32)
            pixels.append(rgb)
        cap.release()

    if not pixels:
        return {
            "bg_luminance": 0.2,
            "dominant_hue_bucket": "neutral",
            "prefer_light_fg": True,
            "sampled": False,
        }

    all_px = np.concatenate(pixels, axis=0)
    # Quantize via k-means (k=3) when enough pixels.
    k = 3
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _compactness, labels, centers = cv2.kmeans(
        all_px,
        k,
        None,
        criteria,
        3,
        cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.flatten()
    sizes = [int(np.sum(labels == i)) for i in range(k)]
    dominant = centers[int(np.argmax(sizes))]
    lum = float(_relative_luminance((float(dominant[0]), float(dominant[1]), float(dominant[2]))))

    hsv = cv2.cvtColor(np.uint8([[dominant]]), cv2.COLOR_RGB2HSV)[0][0]
    hue = float(hsv[0])  # 0–179 in OpenCV
    sat = float(hsv[1])
    if sat < 40:
        bucket = "neutral"
    elif hue < 15 or hue >= 165:
        bucket = "red"
    elif hue < 35:
        bucket = "warm"
    elif hue < 85:
        bucket = "green"
    elif hue < 135:
        bucket = "cool"
    else:
        bucket = "magenta"

    return {
        "bg_luminance": lum,
        "dominant_hue_bucket": bucket,
        "prefer_light_fg": lum < 0.45,
        "sampled": True,
    }


def infer_tempo(mean_clip_duration: float, theme: str) -> str:
    if theme == "cinematic" or mean_clip_duration >= 5.0:
        return "slow"
    if theme == "fun" or mean_clip_duration <= 2.5:
        return "fast"
    return "medium"


def build_typography_features(
    *,
    moments: list[dict[str, Any]],
    couple_names: list[Any],
    ending_message: str | None,
    mood: str | None,
    visual_tone: str | None,
    orientation: str,
    theme: str | None = None,
    local_video_paths: list[str] | None = None,
) -> dict[str, Any]:
    theme_key = (theme or derive_theme(mood)).strip().lower() or "romantic"
    emotions = [str(m.get("emotion") or "") for m in moments]
    lightings = [str(m.get("lighting") or "") for m in moments]
    shots = [str(m.get("shot_type") or "") for m in moments]

    qualities: list[float] = []
    couple_both = 0
    durations: list[float] = []
    for m in moments:
        q = m.get("quality_score")
        if q is None:
            vq = str(m.get("visual_quality") or "").lower()
            q = {"high": 0.85, "medium": 0.55, "low": 0.25}.get(vq, 0.5)
        qualities.append(float(q) if float(q) <= 1.0 else float(q) / 100.0)
        if m.get("bride_present") and m.get("groom_present"):
            couple_both += 1
        try:
            durations.append(float(m.get("duration") or 0))
        except (TypeError, ValueError):
            pass

    name_chars, name_display, latinish = _name_chars(couple_names)
    ending = (ending_message or "").strip()
    mean_dur = float(sum(durations) / len(durations)) if durations else 3.5
    palette = sample_palette_from_videos(local_video_paths or [])

    return {
        "theme": theme_key,
        "mood": (mood or "neutral").strip().lower(),
        "visual_tone": (visual_tone or "natural").strip().lower(),
        "orientation": orientation if orientation in ("landscape", "portrait") else "landscape",
        "emotion_hist": _norm_hist(emotions),
        "lighting_hist": _norm_hist(lightings),
        "shot_hist": _norm_hist(shots),
        "quality_mean": float(sum(qualities) / len(qualities)) if qualities else 0.5,
        "couple_both_rate": (couple_both / len(moments)) if moments else 0.0,
        "mean_clip_duration": mean_dur,
        "tempo": infer_tempo(mean_dur, theme_key),
        "name_chars": name_chars,
        "name_display": name_display,
        "names_latinnish": latinish,
        "ending_chars": len(ending),
        "ending_message": ending,
        "palette": palette,
        "moments_used": len(moments),
    }
