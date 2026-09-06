"""Generate tiny sample clips for pipeline tests.

Creates:
  scripts/sample-clips/good-1.mp4  — person A (Lena)
  scripts/sample-clips/good-2.mp4  — person A, different crop
  scripts/sample-clips/good-3.mp4  — person B (second face, for identity clustering)
  scripts/sample-clips/cuts.mp4    — hard cut (2.0s face A + 2.0s face B, for scene detection)
  scripts/sample-clips/black.mp4   — near-black (must fail visual validation)
"""

from __future__ import annotations

import subprocess
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "sample-clips"
# OpenCV sample faces — Haar detects both; LBP should separate them.
LENA_URL = "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/lena.jpg"
# Classic OpenCV sample with a clear frontal face (different person from Lena).
FACE2_URL = "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/messi5.jpg"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ensure_image(url: str, dest: Path) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        print(f"Downloading {url} → {dest}")
        urllib.request.urlretrieve(url, dest)
    return dest


def write_clip_from_image(image_path: Path, out_path: Path, seconds: float = 2.0, fps: int = 10) -> None:
    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError(f"could not read {image_path}")
    h, w = img.shape[:2]
    w -= w % 2
    h -= h % 2
    img = cv2.resize(img, (w, h))
    tmp = out_path.with_suffix(".raw.avi")
    writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"MJPG"), fps, (w, h))
    frames = int(seconds * fps)
    for i in range(frames):
        frame = img.copy()
        shift = (i % 5) - 2
        m = np.float32([[1, 0, shift], [0, 1, 0]])
        frame = cv2.warpAffine(frame, m, (w, h), borderMode=cv2.BORDER_REPLICATE)
        writer.write(frame)
    writer.release()
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(tmp),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    )
    tmp.unlink(missing_ok=True)


def write_cut_clip(image_a: Path, image_b: Path, out_path: Path, shot_seconds: float = 2.0, fps: int = 10) -> None:
    img_a = cv2.imread(str(image_a))
    img_b = cv2.imread(str(image_b))
    if img_a is None or img_b is None:
        raise RuntimeError(f"could not read {image_a} or {image_b}")

    target_w, target_h = 400, 400
    img_a = cv2.resize(img_a, (target_w, target_h))
    img_b = cv2.resize(img_b, (target_w, target_h))

    tmp = out_path.with_suffix(".raw.avi")
    writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"MJPG"), fps, (target_w, target_h))

    frames_per_shot = int(shot_seconds * fps)
    # Shot 1 (Image A)
    for i in range(frames_per_shot):
        frame = img_a.copy()
        shift = (i % 5) - 2
        m = np.float32([[1, 0, shift], [0, 1, 0]])
        frame = cv2.warpAffine(frame, m, (target_w, target_h), borderMode=cv2.BORDER_REPLICATE)
        writer.write(frame)

    # Shot 2 (Image B - hard cut)
    for i in range(frames_per_shot):
        frame = img_b.copy()
        shift = 2 - (i % 5)
        m = np.float32([[1, 0, shift], [0, 1, 0]])
        frame = cv2.warpAffine(frame, m, (target_w, target_h), borderMode=cv2.BORDER_REPLICATE)
        writer.write(frame)

    writer.release()
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(tmp),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    )
    tmp.unlink(missing_ok=True)


def write_black_clip(out_path: Path, seconds: float = 2.0) -> None:
    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s=640x360:d={seconds}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(out_path),
        ]
    )


def main() -> int:
    face_a = ensure_image(LENA_URL, OUT / "face.jpg")
    face_b = ensure_image(FACE2_URL, OUT / "face-b.jpg")

    write_clip_from_image(face_a, OUT / "good-1.mp4", seconds=2.0)
    img = cv2.imread(str(face_a))
    assert img is not None
    h, w = img.shape[:2]
    crop = img[h // 10 : h - h // 10, w // 10 : w - w // 10]
    crop_path = OUT / "face-crop.jpg"
    cv2.imwrite(str(crop_path), crop)
    write_clip_from_image(crop_path, OUT / "good-2.mp4", seconds=2.0)
    write_clip_from_image(face_b, OUT / "good-3.mp4", seconds=2.0)
    write_cut_clip(face_a, face_b, OUT / "cuts.mp4", shot_seconds=2.0)
    write_black_clip(OUT / "black.mp4", seconds=2.0)
    print(f"Wrote samples under {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
