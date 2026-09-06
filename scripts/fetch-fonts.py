#!/usr/bin/env python3
"""Download OFL font files into agent/assets/fonts/ for typography catalog.

    agent/.venv/bin/python scripts/fetch-fonts.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "agent" / "assets" / "fonts"

# jsDelivr fontsource static Latin faces (OFL).
FONTS = {
    "PlayfairDisplay-Regular.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@5.2.5/latin-400-normal.ttf",
    "Inter-Regular.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-400-normal.ttf",
    "GreatVibes-Regular.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/great-vibes@5.2.5/latin-400-normal.ttf",
    "Montserrat-Bold.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.5/latin-700-normal.ttf",
}

LICENSE_NOTE = """# Font licenses

All fonts in this directory are licensed under the SIL Open Font License (OFL).

| File | Family | Source |
| --- | --- | --- |
| PlayfairDisplay-Regular.ttf | Playfair Display | Google Fonts / OFL |
| Inter-Regular.ttf | Inter | rsms.me / OFL |
| GreatVibes-Regular.ttf | Great Vibes | Google Fonts / OFL |
| Montserrat-Bold.ttf | Montserrat | Google Fonts / OFL |

Fetched by `scripts/fetch-fonts.py`.
"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "README.md").write_text(LICENSE_NOTE, encoding="utf-8")

    for name, url in FONTS.items():
        dest = OUT / name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"skip {name} (exists)")
            continue
        print(f"fetch {name} …")
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                data = resp.read()
            if len(data) < 1000:
                print(f"error: {name} too small ({len(data)} bytes)", file=sys.stderr)
                return 1
            dest.write_bytes(data)
            print(f"  wrote {dest} ({len(data)} bytes)")
        except Exception as exc:  # noqa: BLE001
            print(f"error fetching {name}: {exc}", file=sys.stderr)
            return 1

    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
