"""CLI for identity clustering across a project's valid clips.

    python -m cv.identity_cli --manifest /tmp/manifest.json

Manifest:
  { "clips": [{ "clip_id": "...", "path": "..." }], "thumbs_dir": "..." }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cv.identity import cluster_project


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Marryo face identity clustering")
    parser.add_argument("--manifest", required=True, help="Path to JSON manifest")
    args = parser.parse_args(argv)

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    clips = manifest.get("clips") or []
    thumbs_dir = manifest.get("thumbs_dir")
    if not isinstance(clips, list) or not thumbs_dir:
        print(json.dumps({"error": "manifest must include clips[] and thumbs_dir"}))
        return 1

    clip_paths: dict[str, str] = {}
    for item in clips:
        clip_id = item.get("clip_id")
        path = item.get("path")
        if not clip_id or not path:
            continue
        clip_paths[str(clip_id)] = str(path)

    try:
        result = cluster_project(clip_paths, out_dir=str(thumbs_dir))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"persons": [], "warnings": ["identity_error"], "error": str(exc)}))
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
