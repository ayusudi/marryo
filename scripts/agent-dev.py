#!/usr/bin/env python3
"""Launch ADK web with repo-root .env and absolute GCS credentials."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
AGENT = ROOT / "agent"


def main() -> int:
    load_dotenv(AGENT / ".env")
    load_dotenv(ROOT / ".env")

    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if creds and not os.path.isabs(creds):
        for candidate in (ROOT / creds, ROOT / Path(creds).name):
            if candidate.is_file():
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidate.resolve())
                break

    env = os.environ.copy()
    env["PYTHONPATH"] = str(AGENT) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")

    adk = AGENT / ".venv" / "bin" / "adk"
    return subprocess.call([str(adk), "web", "."], cwd=str(AGENT), env=env)


if __name__ == "__main__":
    sys.exit(main())
