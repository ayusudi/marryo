"""Score typography catalog candidates from feature vector X."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import ImageFont

from marryo_agent.config_loader import render_presets, typography_policy

FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"


def _contrast_ratio(fg_hex: str, bg_hex: str) -> float:
    def lum(h: str) -> float:
        raw = h.lstrip("#")
        if len(raw) != 6:
            return 0.0
        r, g, b = int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)

        def chan(c: int) -> float:
            x = c / 255.0
            return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4

        return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)

    l1, l2 = lum(fg_hex), lum(bg_hex)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def _mood_colors(mood: str) -> tuple[str, str]:
    presets = render_presets()
    moods = presets.get("moods") or {}
    entry = moods.get(mood) or {}
    defaults = presets.get("defaults") or {}
    bg = str(entry.get("card_bg") or defaults.get("card_bg") or "#111111")
    fg = str(entry.get("card_fg") or defaults.get("card_fg") or "#f0f0f0")
    return bg, fg


def resolve_font_path(family_id: str, policy: dict | None = None) -> Path:
    policy = policy or typography_policy()
    families = policy.get("families") or {}
    meta = families.get(family_id) or {}
    filename = str(meta.get("file") or "")
    path = FONTS_DIR / filename
    if path.exists():
        return path
    # Fallbacks
    for candidate in FONTS_DIR.glob("*.ttf"):
        return candidate
    return path


def _fit_name_size(
    text: str,
    font_path: Path,
    max_width: int,
    min_size: int,
    max_size: int,
) -> int:
    if not text.strip():
        return min_size
    lo, hi = min_size, max_size
    best = min_size
    while lo <= hi:
        mid = (lo + hi) // 2
        try:
            font = ImageFont.truetype(str(font_path), size=mid)
        except OSError:
            return min_size
        bbox = font.getbbox(text)
        width = (bbox[2] - bbox[0]) if bbox else 0
        if width <= max_width:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def _affinity(table: dict[str, Any], key: str, option: str) -> float:
    row = table.get(key) or {}
    if not isinstance(row, dict):
        return 0.3
    return float(row.get(option, 0.25))


def _emotion_family_score(features: dict[str, Any], family_id: str, policy: dict) -> float:
    hist = features.get("emotion_hist") or {}
    table = policy.get("emotion_family_affinity") or {}
    if not hist:
        return 0.4
    score = 0.0
    for emotion, weight in hist.items():
        # Match partial keys (e.g. "happy and content" → happy)
        best = 0.0
        for key, affinities in table.items():
            if key in emotion:
                best = max(best, float((affinities or {}).get(family_id, 0.0)))
        score += float(weight) * best
    return score


def _legal_families(features: dict[str, Any], policy: dict) -> list[str]:
    families = list((policy.get("families") or {}).keys())
    constraints = policy.get("constraints") or {}
    max_script = int(constraints.get("script_max_name_chars") or 28)
    out: list[str] = []
    for fam in families:
        if fam == "script_soft":
            if int(features.get("name_chars") or 0) > max_script:
                continue
            if not features.get("names_latinnish", True):
                continue
        out.append(fam)
    return out or ["sans_clean"]


def decide_card_typography(
    *,
    role: str,
    features: dict[str, Any],
    card_duration: float,
    canvas_width: int,
    canvas_height: int,
    lines: list[str],
) -> dict[str, Any]:
    policy = typography_policy()
    weights = policy.get("weights") or {}
    constraints = policy.get("constraints") or {}
    layouts = list(policy.get("layouts") or ["center_stack"])
    animations = list(policy.get("animations") or ["none"])

    orientation = features.get("orientation") or "landscape"
    theme = features.get("theme") or "romantic"
    mood = features.get("mood") or "neutral"
    tone = features.get("visual_tone") or "natural"
    tempo = features.get("tempo") or "medium"
    palette = features.get("palette") or {}

    legal_families = _legal_families(features, policy)
    candidates: list[dict[str, Any]] = []

    for family_id in legal_families:
        for layout in layouts:
            for animation in animations:
                breakdown: dict[str, float] = {}
                score = 0.0

                e = _emotion_family_score(features, family_id, policy)
                w_e = float(weights.get("emotion_affinity") or 0)
                breakdown["emotion_affinity"] = round(w_e * e, 2)
                score += breakdown["emotion_affinity"]

                m = _affinity(policy.get("mood_family_affinity") or {}, mood, family_id)
                # Also blend theme affinity
                t = _affinity(policy.get("theme_family_affinity") or {}, theme, family_id)
                mood_blend = 0.6 * m + 0.4 * t
                w_m = float(weights.get("mood_affinity") or 0)
                breakdown["mood_affinity"] = round(w_m * mood_blend, 2)
                score += breakdown["mood_affinity"]

                layout_tone = _affinity(policy.get("tone_layout_affinity") or {}, tone, layout)
                w_tl = float(weights.get("tone_layout") or 0)
                breakdown["tone_layout"] = round(w_tl * layout_tone, 2)
                score += breakdown["tone_layout"]

                layout_or = _affinity(
                    policy.get("orientation_layout_affinity") or {},
                    orientation,
                    layout,
                )
                w_ol = float(weights.get("orientation_layout") or 0)
                breakdown["orientation_layout"] = round(w_ol * layout_or, 2)
                score += breakdown["orientation_layout"]

                # Palette: prefer families that stay readable; reward light/dark match later via color
                prefer_light = bool(palette.get("prefer_light_fg", True))
                palette_score = 0.7 if prefer_light else 0.65
                if family_id == "sans_clean":
                    palette_score += 0.15  # safest on unknown palettes
                w_p = float(weights.get("palette_contrast") or 0)
                breakdown["palette_contrast"] = round(w_p * palette_score, 2)
                score += breakdown["palette_contrast"]

                anim_aff = _affinity(policy.get("tempo_animation_affinity") or {}, tempo, animation)
                w_a = float(weights.get("tempo_animation") or 0)
                breakdown["tempo_animation"] = round(w_a * anim_aff, 2)
                score += breakdown["tempo_animation"]

                penalties = policy.get("penalties") or {}
                if family_id == "script_soft" and int(features.get("name_chars") or 0) > int(
                    constraints.get("script_max_name_chars") or 28
                ):
                    score += float(penalties.get("script_long_name") or 0)
                    breakdown["penalty_script_long"] = float(penalties.get("script_long_name") or 0)
                if family_id == "script_soft" and not features.get("names_latinnish", True):
                    score += float(penalties.get("script_non_latin") or 0)
                    breakdown["penalty_script_non_latin"] = float(
                        penalties.get("script_non_latin") or 0
                    )
                if layout == "lower_third" and orientation == "portrait":
                    score += float(penalties.get("lower_third_on_portrait") or 0)
                    breakdown["penalty_lower_third_portrait"] = float(
                        penalties.get("lower_third_on_portrait") or 0
                    )
                if layout == "portrait_hero" and orientation == "landscape":
                    score += float(penalties.get("portrait_hero_on_landscape") or 0)
                    breakdown["penalty_portrait_hero_landscape"] = float(
                        penalties.get("portrait_hero_on_landscape") or 0
                    )
                if family_id == "script_soft" and theme == "fun":
                    score += float(penalties.get("script_on_fun_theme") or 0)
                    breakdown["penalty_script_fun"] = float(penalties.get("script_on_fun_theme") or 0)

                candidates.append(
                    {
                        "family_id": family_id,
                        "layout": layout,
                        "animation": animation,
                        "score": score,
                        "breakdown": breakdown,
                    }
                )

    candidates.sort(key=lambda c: c["score"], reverse=True)
    best = candidates[0]

    font_path = resolve_font_path(best["family_id"], policy)
    margin_frac = float(
        constraints.get("margin_portrait" if orientation == "portrait" else "margin_landscape")
        or 0.12
    )
    max_text_width = int(canvas_width * (1 - 2 * margin_frac))
    min_size = int(constraints.get("min_name_size") or 28)
    max_size = int(
        constraints.get(
            "max_name_size_portrait" if orientation == "portrait" else "max_name_size_landscape"
        )
        or 96
    )
    primary = lines[0] if lines else features.get("name_display") or " "
    size_name = _fit_name_size(primary, font_path, max_text_width, min_size, max_size)
    sub_ratio = float(constraints.get("subline_size_ratio") or 0.4)
    size_sub = max(18, int(size_name * sub_ratio))

    bg, fg = _mood_colors(mood)
    if palette.get("prefer_light_fg") and _contrast_ratio(fg, bg) < float(
        constraints.get("min_contrast_ratio") or 4.5
    ):
        fg = "#f5f5f5"
    if not palette.get("prefer_light_fg") and _contrast_ratio(fg, bg) < float(
        constraints.get("min_contrast_ratio") or 4.5
    ):
        fg = "#111111"
        if _contrast_ratio(fg, bg) < float(constraints.get("min_contrast_ratio") or 4.5):
            bg = "#f0f0f0"
            fg = "#111111"

    # Ensure contrast after flips
    if _contrast_ratio(fg, bg) < float(constraints.get("min_contrast_ratio") or 4.5):
        bg, fg = "#111111", "#f5f5f5"

    anim_cap = float(constraints.get("animation_duration_cap") or 0.8)
    anim_frac = float(constraints.get("animation_duration_frac") or 0.35)
    anim_dur = min(anim_cap, max(0.0, float(card_duration) * anim_frac))
    if best["animation"] == "none":
        anim_dur = 0.0

    tracking = float((policy.get("tracking") or {}).get(best["family_id"], 0.04))

    return {
        "role": role,
        "font_family_id": best["family_id"],
        "font_path": str(font_path),
        "size_name_px": size_name,
        "size_sub_px": size_sub,
        "tracking": tracking,
        "line_gap": 0.45,
        "position_id": best["layout"],
        "align": "center",
        "color_fg": fg,
        "color_bg": bg,
        "scrim_opacity": 0.35,
        "animation_id": best["animation"],
        "animation_duration_s": round(anim_dur, 3),
        "score": round(float(best["score"]), 2),
        "score_breakdown": best["breakdown"],
        "contrast_ratio": round(_contrast_ratio(fg, bg), 2),
    }


def decide_typography(
    *,
    features: dict[str, Any],
    title_lines: list[str],
    ending_lines: list[str],
    title_duration: float,
    ending_duration: float,
    canvas_width: int,
    canvas_height: int,
) -> dict[str, Any]:
    title = decide_card_typography(
        role="title",
        features=features,
        card_duration=title_duration,
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        lines=title_lines,
    )
    ending = decide_card_typography(
        role="ending",
        features=features,
        card_duration=ending_duration,
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        lines=ending_lines,
    )
    return {
        "features_summary": {
            "theme": features.get("theme"),
            "mood": features.get("mood"),
            "visual_tone": features.get("visual_tone"),
            "orientation": features.get("orientation"),
            "tempo": features.get("tempo"),
            "name_chars": features.get("name_chars"),
            "moments_used": features.get("moments_used"),
            "palette": features.get("palette"),
            "emotion_hist": features.get("emotion_hist"),
        },
        "title": title,
        "ending": ending,
    }
