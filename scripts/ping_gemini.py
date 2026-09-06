"""Make one real Gemini call, using whichever auth path is configured.

    npm run ping:gemini
    # or: agent/.venv/bin/python scripts/ping_gemini.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / "agent" / ".env")
load_dotenv(REPO_ROOT / ".env")

_creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
if _creds and not os.path.isabs(_creds):
    for candidate in (REPO_ROOT / _creds, REPO_ROOT / Path(_creds).name):
        if candidate.is_file():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidate.resolve())
            break

MODEL = os.environ.get("MARRYO_MODEL", "gemini-2.5-flash")
PROMPT = "Reply with exactly: Marryo is online."


def main() -> int:
    from google import genai

    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "1") == "1"

    if use_vertex:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not project:
            print("GOOGLE_CLOUD_PROJECT is not set. Fill it in, or set GOOGLE_GENAI_USE_VERTEXAI=0 to use an AI Studio key.")
            return 1
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
        print(f"Calling {MODEL} via Vertex AI (project {project}, {location})")
        client = genai.Client(vertexai=True, project=project, location=location)
    else:
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            print("GEMINI_API_KEY is not set.")
            return 1
        print(f"Calling {MODEL} via the AI Studio API")
        client = genai.Client(api_key=api_key)

    try:
        response = client.models.generate_content(model=MODEL, contents=PROMPT)
    except Exception as exc:  # noqa: BLE001 - surface the raw auth/quota error
        print(f"Call failed: {type(exc).__name__}: {exc}")
        return 1

    print(f"Response: {(response.text or '').strip()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
