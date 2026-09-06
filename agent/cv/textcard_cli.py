"""CLI for rendering title/ending text cards to PNG via Pillow.

    python -m cv.textcard_cli --spec /tmp/cards.json

Spec JSON:
  {
    "width": 1920,
    "height": 1080,
    "out_dir": "/tmp/cards",
    "cards": [
      {
        "id": "title",
        "lines": ["Ayu & Fauzan", "2026-10-10"],
        "style": {
          "bg": "#1a1410",
          "fg": "#f5e9dc",
          "font_path": "/path/to/font.ttf",
          "size_name_px": 72,
          "size_sub_px": 28,
          "tracking": 0.04,
          "line_gap": 0.45,
          "position_id": "center_stack",
          "scrim_opacity": 0.35
        }
      }
    ]
  }

Output JSON:
  { "cards": [{ "id": "title", "png_path": "/tmp/cards/title.png" }] }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
]


def _hex_to_rgb(value: str, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    raw = (value or "").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return fallback
    try:
        return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)
    except ValueError:
        return fallback


def _load_font(size: int, font_path: str | None = None) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    candidates: list[str] = []
    if font_path:
        candidates.append(font_path)
    candidates.extend(FONT_CANDIDATES)
    for path in candidates:
        if path and Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def _add_vignette(img: Image.Image, scrim_opacity: float = 0.35) -> Image.Image:
    """Subtle radial darkening toward edges + optional scrim."""
    width, height = img.size
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx, cy = width / 2, height / 2
    max_r = (cx**2 + cy**2) ** 0.5
    steps = 24
    strength = max(0.0, min(1.0, scrim_opacity))
    for i in range(steps):
        t = i / steps
        alpha = int(55 * strength * (t**1.6))
        pad_x = int(cx * t)
        pad_y = int(cy * t)
        draw.ellipse(
            [pad_x, pad_y, width - pad_x, height - pad_y],
            outline=(0, 0, 0, alpha),
            width=max(2, int(max_r / steps) + 1),
        )
    return Image.alpha_composite(base, overlay).convert("RGB")


def _anchor_y(
    position_id: str,
    height: int,
    total_text_h: int,
) -> int:
    if position_id == "lower_third":
        return int(height * 0.68)
    if position_id == "upper_third":
        return int(height * 0.18)
    if position_id == "portrait_hero":
        return int(height * 0.38) - total_text_h // 2
    # center_stack
    return (height - total_text_h) // 2


def render_card(
    card_id: str,
    lines: list[str],
    out_path: Path,
    width: int,
    height: int,
    style: dict,
) -> str:
    bg = str(style.get("bg") or "#111111")
    fg = str(style.get("fg") or "#f0f0f0")
    font_path = style.get("font_path")
    size_name = int(style.get("size_name_px") or 72)
    size_sub = int(style.get("size_sub_px") or max(18, size_name // 2))
    line_gap_ratio = float(style.get("line_gap") or 0.45)
    position_id = str(style.get("position_id") or "center_stack")
    scrim_opacity = float(style.get("scrim_opacity") or 0.35)
    tracking = float(style.get("tracking") or 0.0)

    bg_rgb = _hex_to_rgb(bg, (17, 17, 17))
    fg_rgb = _hex_to_rgb(fg, (240, 240, 240))

    img = Image.new("RGB", (width, height), bg_rgb)
    img = _add_vignette(img, scrim_opacity=scrim_opacity)
    draw = ImageDraw.Draw(img)

    clean_lines = [line.strip() for line in lines if str(line).strip()]
    if not clean_lines:
        clean_lines = [" "]

    fonts: list[ImageFont.ImageFont] = []
    for i, _line in enumerate(clean_lines):
        size = size_name if i == 0 else size_sub
        fonts.append(_load_font(size, str(font_path) if font_path else None))

    # Apply tracking by inserting thin spaces for display measurement/draw when tracking > 0
    def tracked(text: str, amount: float) -> str:
        if amount <= 0.01 or len(text) < 2:
            return text
        # Approximate tracking with hair spaces proportional to amount
        gap = "\u200a" if amount < 0.06 else "\u2009"
        return gap.join(list(text))

    display_lines = [tracked(line, tracking if i == 0 else tracking * 0.5) for i, line in enumerate(clean_lines)]

    line_heights: list[int] = []
    line_widths: list[int] = []
    for i, line in enumerate(display_lines):
        w, h = _text_size(draw, line, fonts[i])
        line_widths.append(w)
        line_heights.append(h)

    primary_size = size_name
    gap = int(primary_size * line_gap_ratio)
    total_h = sum(line_heights) + gap * (len(clean_lines) - 1)
    y = _anchor_y(position_id, height, total_h)
    y = max(int(height * 0.05), min(y, height - total_h - int(height * 0.05)))

    for i, line in enumerate(display_lines):
        x = (width - line_widths[i]) // 2
        draw.text((x, y), line, fill=fg_rgb, font=fonts[i])
        y += line_heights[i] + gap

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="PNG")
    return str(out_path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Marryo text card PNG renderer")
    parser.add_argument("--spec", required=True, help="Path to JSON card spec")
    args = parser.parse_args(argv)

    try:
        spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"failed to read spec: {exc}"}))
        return 1

    width = int(spec.get("width") or 1920)
    height = int(spec.get("height") or 1080)
    out_dir = Path(spec.get("out_dir") or ".")
    cards = spec.get("cards") or []
    if not isinstance(cards, list):
        print(json.dumps({"error": "spec.cards must be an array"}))
        return 1

    rendered: list[dict[str, str]] = []
    for card in cards:
        card_id = str(card.get("id") or "card")
        lines = card.get("lines") or []
        if not isinstance(lines, list):
            lines = [str(lines)]
        style = card.get("style") or {}
        if not isinstance(style, dict):
            style = {}
        # Back-compat: flat bg/fg
        if "bg" not in style and card.get("bg"):
            style["bg"] = card.get("bg")
        if "fg" not in style and card.get("fg"):
            style["fg"] = card.get("fg")
        out_path = out_dir / f"{card_id}.png"
        try:
            png_path = render_card(
                card_id,
                [str(x) for x in lines],
                out_path,
                width,
                height,
                style,
            )
            rendered.append({"id": card_id, "png_path": png_path})
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"error": f"failed to render card {card_id}: {exc}"}))
            return 1

    print(json.dumps({"cards": rendered}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
