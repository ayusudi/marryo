"""Shot boundary detection: split a clip into its constituent shots.

Phase 4. Backed by PySceneDetect with ffmpeg and whole-clip fallbacks.
Shot boundaries are cheap to compute and are what later phases feed to Gemini,
so the model reasons over real scenes instead of arbitrary time windows.
"""

from __future__ import annotations

import math
import re
import subprocess
from pathlib import Path
from scenedetect import ContentDetector, detect

from cv.validate import probe

MIN_SCENE_DURATION_S = 1.5
MAX_SCENES_PER_CLIP = 6
MAX_SCENES_PER_PROJECT = 12
DEFAULT_PSD_THRESHOLD = 30.0


def detect_shots(path: str, threshold: float = DEFAULT_PSD_THRESHOLD) -> list[tuple[float, float]]:
    """Find shot boundaries in a clip using PySceneDetect, returning list of (start_s, end_s)."""
    scenes = detect(path, ContentDetector(threshold=threshold))
    return [
        (max(0.0, float(start.get_seconds())), max(0.0, float(end.get_seconds())))
        for start, end in scenes
        if end.get_seconds() > start.get_seconds()
    ]


def detect_shots_ffmpeg(path: str, duration: float, scene_threshold: float = 0.4) -> list[tuple[float, float]]:
    """Fallback shot boundary detection using ffmpeg's scene filter."""
    if duration <= 0 or math.isnan(duration) or math.isinf(duration):
        return []

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-i",
        path,
        "-filter:v",
        f"select='gt(scene,{scene_threshold})',showinfo",
        "-f",
        "null",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = proc.stderr or ""
    except Exception:
        return []

    pts_matches = re.findall(r"pts_time:([0-9]+(?:\.[0-9]+)?)", output)
    cut_points = sorted({float(pts) for pts in pts_matches if 0.0 < float(pts) < duration})

    if not cut_points:
        return []

    points = [0.0] + cut_points + [duration]
    spans: list[tuple[float, float]] = []
    for i in range(len(points) - 1):
        start = points[i]
        end = points[i + 1]
        if end > start:
            spans.append((start, end))

    return spans


def postprocess_scenes(
    spans: list[tuple[float, float]],
    duration: float,
    min_duration: float = MIN_SCENE_DURATION_S,
    max_scenes: int = MAX_SCENES_PER_CLIP,
) -> list[tuple[float, float]]:
    """Clamp, merge short scenes, enforce max scene count, and guarantee whole-clip fallback."""
    if duration <= 0 or math.isnan(duration) or math.isinf(duration):
        return [(0.0, max(0.0, duration if not math.isnan(duration) and not math.isinf(duration) else 0.0))]

    if not spans:
        return [(0.0, duration)]

    # 1. Clamp spans to [0, duration] and ensure start < end
    clamped: list[tuple[float, float]] = []
    for s, e in spans:
        if math.isnan(s) or math.isnan(e) or math.isinf(s) or math.isinf(e):
            continue
        s_clamped = max(0.0, min(duration, s))
        e_clamped = max(0.0, min(duration, e))
        if e_clamped > s_clamped:
            clamped.append((s_clamped, e_clamped))

    if not clamped:
        return [(0.0, duration)]

    # Ensure contiguous coverage across [0, duration]
    # If there are gaps or start > 0 / end < duration, adjust endpoints
    normalized: list[tuple[float, float]] = []
    for i, (s, e) in enumerate(clamped):
        if i == 0:
            s = 0.0
        else:
            s = normalized[-1][1]
        if i == len(clamped) - 1:
            e = duration
        if e > s:
            normalized.append((s, e))

    if not normalized:
        return [(0.0, duration)]

    # 2. Merge short spans (< min_duration)
    # If total clip duration is shorter than min_duration, single span is fine
    if duration <= min_duration:
        return [(0.0, duration)]

    merged: list[list[float]] = [[s, e] for s, e in normalized]
    i = 0
    while i < len(merged) and len(merged) > 1:
        s, e = merged[i]
        span_dur = e - s
        if span_dur < min_duration:
            if i > 0:
                # Merge into previous
                merged[i - 1][1] = e
                merged.pop(i)
                # recheck previous
                i = max(0, i - 1)
            else:
                # Merge into next (first element)
                merged[i + 1][0] = s
                merged.pop(i)
        else:
            i += 1

    # 3. Cap at max_scenes by iteratively merging the shortest span into its neighbor
    while len(merged) > max_scenes:
        shortest_idx = 0
        min_len = merged[0][1] - merged[0][0]
        for idx in range(1, len(merged)):
            dur = merged[idx][1] - merged[idx][0]
            if dur < min_len:
                min_len = dur
                shortest_idx = idx

        if shortest_idx == 0:
            merged[1][0] = merged[0][0]
            merged.pop(0)
        elif shortest_idx == len(merged) - 1:
            merged[shortest_idx - 1][1] = merged[shortest_idx][1]
            merged.pop(shortest_idx)
        else:
            # Merge with the shorter of left or right neighbor
            left_dur = merged[shortest_idx - 1][1] - merged[shortest_idx - 1][0]
            right_dur = merged[shortest_idx + 1][1] - merged[shortest_idx + 1][0]
            if left_dur <= right_dur:
                merged[shortest_idx - 1][1] = merged[shortest_idx][1]
                merged.pop(shortest_idx)
            else:
                merged[shortest_idx + 1][0] = merged[shortest_idx][0]
                merged.pop(shortest_idx)

    # Convert to immutable tuples with clean rounding
    result = [(round(s, 3), round(e, 3)) for s, e in merged if e > s]
    return result if result else [(0.0, round(duration, 3))]


def detect_scenes_for_clip(
    path: str,
    duration_hint: float | None = None,
) -> dict[str, object]:
    """Detect scenes for a single clip with fallback chain (PSD -> ffmpeg -> whole_clip)."""
    warnings: list[str] = []
    duration = duration_hint

    if duration is None or duration <= 0:
        try:
            duration = float(probe(path).duration_s)
        except Exception as exc:
            warnings.append(f"probe_failed:{exc}")
            duration = 0.0

    raw_spans: list[tuple[float, float]] = []
    detector = "whole_clip"

    # Step 1: PySceneDetect
    try:
        raw_spans = detect_shots(path)
        if raw_spans:
            detector = "pyscenedetect"
    except Exception as exc:
        warnings.append(f"psd_error:{exc}")

    # Step 2: ffmpeg scene detection fallback
    if not raw_spans and duration > 0:
        try:
            raw_spans = detect_shots_ffmpeg(path, duration=duration)
            if raw_spans:
                detector = "ffmpeg"
        except Exception as exc:
            warnings.append(f"ffmpeg_error:{exc}")

    # Step 3: Post-processing and whole clip fallback
    scenes = postprocess_scenes(raw_spans, duration=duration)
    if not raw_spans or detector == "whole_clip":
        detector = "whole_clip"

    scenes_dicts = [
        {
            "start_time": s,
            "end_time": e,
            "duration": round(e - s, 3),
        }
        for s, e in scenes
    ]

    return {
        "scenes": scenes_dicts,
        "detector": detector,
        "warnings": warnings,
    }
