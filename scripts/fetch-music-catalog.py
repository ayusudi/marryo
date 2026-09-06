#!/usr/bin/env python3
"""Download starter Mixkit tracks into agent/assets/music/.

Reads agent/config/music_catalog.json and fetches each track's download_url.

    agent/.venv/bin/python scripts/fetch-music-catalog.py
    # or: npm run sample:music
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "agent" / "config" / "music_catalog.json"
OUT = ROOT / "agent" / "assets" / "music"

LICENSE_NOTE = """# Music licenses (starter catalog)

Tracks in this directory are downloaded from [Mixkit](https://mixkit.co/free-stock-music/)
under the **Mixkit Free License**.

## Allowed (typical Marryo use)

- Use as background music **inside wedding films / videos**
- Commercial and personal video projects
- YouTube, social, client delivery of the **finished video**
- Attribution appreciated but **not required**

## Not allowed

- Redistributing tracks as a **standalone music product** (selling the MP3s themselves)
- CDs, DVDs, video games, TV/radio broadcast (see Mixkit terms)

Full terms: https://mixkit.co/license/#musicFree

Catalog metadata: `agent/config/music_catalog.json`  
Fetched by: `scripts/fetch-music-catalog.py`

This is a **dev/starter** library. For a production “Marryo Library” brand,
replace with a B2B redistribution-cleared catalog when you are ready.
"""

USER_AGENT = "MarryoMusicFetch/1.0 (+local-dev; https://github.com/)"


def main() -> int:
    if not CATALOG.exists():
        print(f"error: missing catalog {CATALOG}", file=sys.stderr)
        return 1

    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    tracks = data.get("tracks") or []
    if not tracks:
        print("error: catalog has no tracks", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "README.md").write_text(LICENSE_NOTE, encoding="utf-8")

    ok = 0
    for track in tracks:
        track_id = track.get("id", "?")
        name = track.get("file")
        url = track.get("download_url")
        if not name or not url:
            print(f"skip {track_id}: missing file/download_url", file=sys.stderr)
            continue

        dest = OUT / name
        if dest.exists() and dest.stat().st_size > 10_000:
            print(f"skip {name} (exists, {dest.stat().st_size} bytes)")
            ok += 1
            continue

        print(f"fetch {name} …")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = resp.read()
            if len(payload) < 10_000:
                print(f"error: {name} too small ({len(payload)} bytes)", file=sys.stderr)
                return 1
            dest.write_bytes(payload)
            print(f"  wrote {dest} ({len(payload)} bytes)")
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print(f"error fetching {name}: {exc}", file=sys.stderr)
            return 1

    print(f"done: {ok}/{len(tracks)} tracks in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
