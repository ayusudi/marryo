"""Shot boundary detection: split a clip into its constituent shots.

Phase 2. Backed by PySceneDetect. Shot boundaries are cheap to compute and are what
later phases feed to Gemini, so the model reasons over shots instead of whole clips.
"""

from scenedetect import ContentDetector, detect


def detect_shots(path: str, threshold: float = 27.0) -> list[tuple[float, float]]:
    """Find shot boundaries in a clip, as a list of (start_s, end_s) spans."""
    scenes = detect(path, ContentDetector(threshold=threshold))
    return [(start.get_seconds(), end.get_seconds()) for start, end in scenes]
