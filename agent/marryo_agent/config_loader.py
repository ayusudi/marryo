"""Load JSON config files from agent/config/."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


@lru_cache(maxsize=8)
def load_json(name: str) -> dict:
    path = CONFIG_DIR / name
    return json.loads(path.read_text(encoding="utf-8"))


def scoring_config() -> dict:
    return load_json("scoring.json")


def story_framework() -> dict:
    return load_json("story_framework.json")


def scene_intent_map() -> dict:
    return load_json("scene_intent_map.json")


MOOD_TO_THEME = {
    "warm": "romantic",
    "romantic": "romantic",
    "cinematic": "cinematic",
    "dramatic": "cinematic",
    "playful": "fun",
    "fun": "fun",
    "joyful": "fun",
}


def derive_theme(mood: str | None) -> str:
    if not mood:
        return "romantic"
    key = mood.strip().lower()
    return MOOD_TO_THEME.get(key, "romantic")


def typography_policy() -> dict:
    return load_json("typography_policy.json")


def render_presets() -> dict:
    return load_json("render_presets.json")


def music_catalog() -> dict:
    return load_json("music_catalog.json")
