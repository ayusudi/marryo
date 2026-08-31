"""Identity clustering: find the couple and group faces across clips.

Phase 3. Backed by MediaPipe face detection and embedding rather than dlib-based
face_recognition, which needs a from-source build on Apple silicon.
"""

import mediapipe as mp


def detect_faces(frame: object) -> list[dict[str, float]]:
    """Detect faces in a single frame, returning bounding boxes with confidences."""
    raise NotImplementedError("Phase 3: identity clustering")


def embed_faces(frame: object, boxes: list[dict[str, float]]) -> list[list[float]]:
    """Produce a comparable embedding vector per detected face."""
    raise NotImplementedError("Phase 3: identity clustering")


def cluster(embeddings: list[list[float]]) -> list[int]:
    """Group face embeddings into people, returning a cluster id per embedding."""
    raise NotImplementedError("Phase 3: identity clustering")


def mediapipe_version() -> str:
    """Report the installed MediaPipe version, so setup can be verified."""
    return str(mp.__version__)
