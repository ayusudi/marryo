"""Build a compact feature vector for soundtrack scoring."""

from __future__ import annotations

from collections import Counter
from typing import Any


def _hist(values: list[str], top_n: int = 8) -> dict[str, float]:
    if not values:
        return {}
    counts = Counter(v for v in values if v)
    total = sum(counts.values()) or 1
    return {k: round(v / total, 4) for k, v in counts.most_common(top_n)}


def build_music_features(
    *,
    moments: list[dict[str, Any]],
    mood: str | None,
    visual_tone: str | None,
    target_duration: float | None,
    theme: str | None = None,
) -> dict[str, Any]:
    emotions: list[str] = []
    shot_types: list[str] = []
    qualities: list[float] = []
    durations: list[float] = []

    for m in moments:
        if not isinstance(m, dict):
            continue
        emo = m.get("emotion") or m.get("dominant_emotion")
        if emo:
            emotions.append(str(emo).lower())
        shot = m.get("shot_type") or m.get("shot")
        if shot:
            shot_types.append(str(shot).lower())
        q = m.get("quality_score")
        if isinstance(q, (int, float)):
            qualities.append(float(q))
        else:
            vq = str(m.get("visual_quality") or "").lower()
            if vq in ("high", "good"):
                qualities.append(0.85)
            elif vq in ("medium", "ok"):
                qualities.append(0.55)
            elif vq in ("low", "poor"):
                qualities.append(0.3)
        st = m.get("start_time")
        et = m.get("end_time")
        if isinstance(st, (int, float)) and isinstance(et, (int, float)) and et > st:
            durations.append(float(et) - float(st))
        elif isinstance(m.get("duration"), (int, float)):
            durations.append(float(m["duration"]))

    avg_clip = (sum(durations) / len(durations)) if durations else 4.0
    # Higher cut density → prefer slightly higher energy/tempo tracks.
    cut_density = 1.0 / max(1.5, avg_clip)

    mood_l = (mood or "warm").strip().lower()
    tone_l = (visual_tone or "").strip().lower()
    theme_l = (theme or "").strip().lower() or mood_l

    return {
        "mood": mood_l,
        "visual_tone": tone_l,
        "theme": theme_l,
        "target_duration": float(target_duration or 90),
        "emotion_hist": _hist(emotions),
        "shot_hist": _hist(shot_types),
        "avg_quality": round(sum(qualities) / len(qualities), 4) if qualities else 0.5,
        "cut_density": round(cut_density, 4),
        "moment_count": len(moments),
    }
