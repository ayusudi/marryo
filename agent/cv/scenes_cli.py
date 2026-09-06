"""CLI for scene boundary detection across a project's valid clips.

    python -m cv.scenes_cli --manifest /tmp/manifest.json

Manifest:
  { "clips": [{ "clip_id": "...", "path": "...", "duration": 4.5 }] }

Output JSON:
  {
    "clips": [
      {
        "clip_id": "...",
        "scenes": [{ "start_time": 0.0, "end_time": 4.5, "duration": 4.5 }],
        "detector": "pyscenedetect" | "ffmpeg" | "whole_clip",
        "warnings": []
      }
    ]
  }
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from cv.scenes import detect_scenes_for_clip

_CONCURRENCY = max(1, int(os.environ.get("MARRYO_SCENES_CONCURRENCY", "4")))


def _detect_one(item: dict) -> dict[str, object]:
    clip_id = item.get("clip_id")
    path = item.get("path")
    duration = item.get("duration")
    if not clip_id or not path:
        return {
            "clip_id": str(clip_id or "unknown"),
            "scenes": [],
            "detector": "whole_clip",
            "warnings": ["missing clip_id or path"],
        }

    try:
        detected = detect_scenes_for_clip(
            str(path),
            duration_hint=float(duration) if duration is not None else None,
        )
        return {
            "clip_id": str(clip_id),
            "scenes": detected["scenes"],
            "detector": detected["detector"],
            "warnings": detected.get("warnings", []),
        }
    except Exception as exc:  # noqa: BLE001
        dur = float(duration) if duration is not None else 0.0
        return {
            "clip_id": str(clip_id),
            "scenes": [{"start_time": 0.0, "end_time": dur, "duration": dur}],
            "detector": "whole_clip",
            "warnings": [f"scene_detection_failed:{exc}"],
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Marryo scene boundary detection")
    parser.add_argument("--manifest", required=True, help="Path to JSON manifest")
    args = parser.parse_args(argv)

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except Exception as exc:
        print(json.dumps({"error": f"failed to read manifest: {exc}"}))
        return 1

    clips = manifest.get("clips") or []
    if not isinstance(clips, list):
        print(json.dumps({"error": "manifest must include clips array"}))
        return 1

    results: list[dict[str, object]] = []
    workers = min(_CONCURRENCY, max(1, len(clips)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_detect_one, item) for item in clips if isinstance(item, dict)]
        for fut in as_completed(futures):
            results.append(fut.result())

    # Stable order matching manifest clip order
    order = {str(item.get("clip_id")): i for i, item in enumerate(clips) if isinstance(item, dict)}
    results.sort(key=lambda r: order.get(str(r.get("clip_id")), 999))

    print(json.dumps({"clips": results}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
