"""Visual validation of uploaded clips: is this usable wedding footage?

Phase 1. Backed by OpenCV frame sampling — sample a handful of frames across the clip
rather than decoding all of it, because a single clip can be several hundred megabytes.
"""

from dataclasses import dataclass

import cv2


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


def sample_frames(path: str, count: int = 8) -> list[tuple[float, "cv2.typing.MatLike"]]:
    """Sample `count` frames spread evenly across the clip, as (timestamp, frame)."""
    raise NotImplementedError("Phase 1: visual validation")


def assess(path: str) -> dict[str, object]:
    """Judge whether a clip is usable: exposure, sharpness, shake, wedding-ness."""
    raise NotImplementedError("Phase 1: visual validation")
