"""CLI entry point for Film Director orchestration.

    python -m marryo_agent.orchestrator_cli --manifest /tmp/manifest.json

Manifest JSON (written by TypeScript bridge):
  {
    "project": { "project_id", "couple_names", "max_duration", "mood", ... },
    "clips": [{ "clip_id", "storage_uri", "valid" }],
    "clip_persons": [{ "clip_id", "person_id" }]
  }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from marryo_agent.orchestrator import run_film_director


def main(argv: list[str] | None = None) -> int:
    # Load env from agent/.env then repo .env
    agent_dir = Path(__file__).resolve().parent.parent
    load_dotenv(agent_dir / ".env")
    load_dotenv(agent_dir.parent / ".env")

    parser = argparse.ArgumentParser(description="Marryo Film Director orchestrator")
    parser.add_argument("--manifest", required=True, help="Path to JSON manifest")
    args = parser.parse_args(argv)

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        result = run_film_director(manifest)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
