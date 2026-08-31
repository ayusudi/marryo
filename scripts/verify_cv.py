"""Check every video/CV dependency the later phases rely on.

    npm run agent:verify
    # or: agent/.venv/bin/python scripts/verify_cv.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys


def check(label: str, fn) -> bool:
    try:
        detail = fn()
    except Exception as exc:  # noqa: BLE001 - this script exists to report failures
        print(f"  [fail] {label:<16} {type(exc).__name__}: {exc}")
        return False
    print(f"  [ok]   {label:<16} {detail}")
    return True


def _opencv() -> str:
    import cv2

    return f"opencv {cv2.__version__}"


def _mediapipe() -> str:
    import mediapipe as mp

    # Touching the vision namespace catches a broken native build early.
    _ = mp.tasks.vision
    return f"mediapipe {mp.__version__}"


def _scenedetect() -> str:
    import scenedetect

    _ = scenedetect.ContentDetector
    return f"scenedetect {scenedetect.__version__}"


def _adk() -> str:
    from google.adk.agents import Agent  # noqa: F401
    import google.adk as adk

    return f"google-adk {adk.__version__}"


def _agent_engine() -> str:
    import vertexai
    from vertexai import agent_engines  # noqa: F401

    return f"vertexai {vertexai.__version__}"


def _marryo_agent() -> str:
    from marryo_agent.agent import root_agent

    return f'root_agent "{root_agent.name}" on {root_agent.model}'


def _cv_package() -> str:
    from cv import identity, scenes, validate  # noqa: F401

    return "cv.validate, cv.identity, cv.scenes"


def _ffmpeg() -> str:
    binary = shutil.which("ffmpeg")
    if binary is None:
        raise RuntimeError("ffmpeg not found on PATH (brew install ffmpeg)")
    result = subprocess.run([binary, "-version"], capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip().splitlines()[0] if result.stderr else "ffmpeg failed")
    return result.stdout.splitlines()[0]


def main() -> int:
    print("Marryo agent dependencies\n")
    checks = [
        ("opencv", _opencv),
        ("mediapipe", _mediapipe),
        ("scenedetect", _scenedetect),
        ("google-adk", _adk),
        ("agent engine", _agent_engine),
        ("marryo_agent", _marryo_agent),
        ("cv package", _cv_package),
        ("ffmpeg", _ffmpeg),
    ]
    results = [check(label, fn) for label, fn in checks]

    print("")
    failed = results.count(False)
    if failed:
        print(f"{failed} check(s) failed.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
