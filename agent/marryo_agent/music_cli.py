"""CLI: recommend soundtrack tracks from a JSON manifest. Prints one JSON object.

    python -m marryo_agent.music_cli --manifest /tmp/music-manifest.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from marryo_agent.config_loader import derive_theme
from marryo_agent.music_decide import recommend_tracks
from marryo_agent.music_features import build_music_features


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Marryo soundtrack recommendations")
    parser.add_argument("--manifest", required=True, help="Path to JSON manifest")
    parser.add_argument("--top-n", type=int, default=5)
    args = parser.parse_args(argv)

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"failed to read manifest: {exc}"}))
        return 1

    project = manifest.get("project") or {}
    moments = manifest.get("moments") or []
    mood = project.get("mood")
    visual_tone = project.get("visual_tone")
    target_duration = manifest.get("target_duration") or project.get("max_duration")
    theme = manifest.get("theme") or derive_theme(mood if isinstance(mood, str) else None)

    try:
        features = build_music_features(
            moments=moments if isinstance(moments, list) else [],
            mood=str(mood) if mood else None,
            visual_tone=str(visual_tone) if visual_tone else None,
            target_duration=float(target_duration) if target_duration else None,
            theme=str(theme) if theme else None,
        )
        result = recommend_tracks(features, top_n=int(args.top_n))
        print(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
