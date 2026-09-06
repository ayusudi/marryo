"""Resolve env before ADK imports the root agent (Vertex / GCS credentials)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_AGENT_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _AGENT_DIR.parent

load_dotenv(_AGENT_DIR / ".env")
load_dotenv(_REPO_ROOT / ".env")

_creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
if _creds and not os.path.isabs(_creds):
    for candidate in (
        (_REPO_ROOT / _creds).resolve(),
        (_REPO_ROOT / Path(_creds).name).resolve(),
        (_AGENT_DIR / _creds).resolve(),
    ):
        if candidate.is_file():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidate)
            break

from . import agent

__all__ = ["agent"]
