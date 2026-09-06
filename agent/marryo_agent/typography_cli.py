"""CLI: decide typography from a JSON manifest. Prints one JSON object to stdout.

    python -m marryo_agent.typography_cli --manifest /tmp/typo-manifest.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from marryo_agent.typography_decide import decide_typography
from marryo_agent.typography_features import build_typography_features


def _title_lines(couple_names: list[Any], wedding_date: str | None) -> list[str]:
    parts: list[str] = []
    for entry in couple_names or []:
        if isinstance(entry, dict):
            name = str(entry.get("name") or "").strip()
        else:
            name = str(entry).strip()
        if name:
            parts.append(name)
    if len(parts) >= 2:
        lines = [f"{parts[0]} & {parts[1]}"]
    elif parts:
        lines = [parts[0]]
    else:
        lines = ["Together"]
    if wedding_date:
        lines.append(str(wedding_date))
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Marryo typography decision")
    parser.add_argument("--manifest", required=True, help="Path to JSON manifest")
    args = parser.parse_args(argv)

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"failed to read manifest: {exc}"}))
        return 1

    project = manifest.get("project") or {}
    moments = manifest.get("moments") or []
    local_paths = manifest.get("local_video_paths") or []
    orientation = str(manifest.get("orientation") or project.get("orientation") or "landscape")
    width = int(manifest.get("width") or (1080 if orientation == "portrait" else 1920))
    height = int(manifest.get("height") or (1920 if orientation == "portrait" else 1080))
    title_duration = float(manifest.get("title_duration") or 2.0)
    ending_duration = float(manifest.get("ending_duration") or 3.0)

    couple_names = project.get("couple_names") or []
    ending_message = project.get("ending_message") or "Forever starts here."
    wedding_date = project.get("wedding_date")

    try:
        features = build_typography_features(
            moments=moments if isinstance(moments, list) else [],
            couple_names=couple_names if isinstance(couple_names, list) else [],
            ending_message=str(ending_message) if ending_message else None,
            mood=project.get("mood"),
            visual_tone=project.get("visual_tone"),
            orientation=orientation,
            theme=manifest.get("theme"),
            local_video_paths=[str(p) for p in local_paths],
        )
        title_lines = _title_lines(couple_names, wedding_date)
        ending_lines = [str(ending_message)]
        decision = decide_typography(
            features=features,
            title_lines=title_lines,
            ending_lines=ending_lines,
            title_duration=title_duration,
            ending_duration=ending_duration,
            canvas_width=width,
            canvas_height=height,
        )
        decision["title_lines"] = title_lines
        decision["ending_lines"] = ending_lines
        print(json.dumps(decision))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
