"""CLI entry for visual validation. Prints one JSON object to stdout.

    python -m cv.validate_cli /path/to/clip.mp4 --frames 8
"""

from __future__ import annotations

import argparse
import json
import sys

from cv.validate import assess


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Marryo visual clip validation")
    parser.add_argument("path", help="Absolute path to a video file")
    parser.add_argument("--frames", type=int, default=8, help="Frames to sample (default 8)")
    args = parser.parse_args(argv)

    try:
        result = assess(args.path, frame_count=args.frames)
    except Exception as exc:  # noqa: BLE001 - CLI surface
        print(
            json.dumps(
                {
                    "valid": False,
                    "warnings": ["assess_error"],
                    "metrics": {"brightness": 0, "blur": 0, "faceCount": 0},
                    "frames_sampled": 0,
                    "summary": (
                        f"Rejected — visual analysis failed before scoring ({exc}). "
                        "This clip cannot enter the film."
                    ),
                    "verdict_detail": (
                        "Technical read failed before visual scoring. "
                        "Re-export as H.264 MP4 or MOV and try again."
                    ),
                    "checks": [
                        {
                            "id": "frames",
                            "label": "Decodable frames",
                            "passed": False,
                            "score": 0,
                            "unit": "frames sampled",
                            "threshold": "≥ 1",
                            "reason": f"Analysis crashed: {exc}",
                            "detail": (
                                "The validator process raised before it could sample frames. "
                                "Often a corrupt file, missing codec support, or bad path."
                            ),
                            "implication": "Excluded from People, Direct, and the final film.",
                        }
                    ],
                    "error": str(exc),
                }
            )
        )
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
