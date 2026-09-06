"""Score Mixkit catalog tracks against film music features → top N."""

from __future__ import annotations

from typing import Any

from marryo_agent.config_loader import music_catalog

# Mood → preferred catalog mood tags
MOOD_AFFINITY: dict[str, dict[str, float]] = {
    "warm": {"warm": 1.0, "romantic": 0.85, "gentle": 0.75, "hopeful": 0.6, "soft": 0.7},
    "romantic": {"romantic": 1.0, "warm": 0.85, "emotional": 0.8, "gentle": 0.7, "soft": 0.65},
    "cinematic": {"elegant": 0.9, "classical": 0.85, "uplifting": 0.7, "emotional": 0.75, "warm": 0.5},
    "dramatic": {"emotional": 0.95, "elegant": 0.8, "classical": 0.75, "uplifting": 0.55},
    "playful": {"celebratory": 0.9, "uplifting": 0.85, "hopeful": 0.7, "joyful": 0.95, "warm": 0.5},
    "fun": {"celebratory": 0.9, "uplifting": 0.85, "joyful": 0.95, "hopeful": 0.7},
    "joyful": {"celebratory": 1.0, "uplifting": 0.9, "hopeful": 0.8, "warm": 0.6},
}

EMOTION_AFFINITY: dict[str, dict[str, float]] = {
    "happy": {"celebratory": 0.9, "uplifting": 0.85, "hopeful": 0.7, "warm": 0.6},
    "joy": {"celebratory": 0.95, "uplifting": 0.9, "joyful": 1.0},
    "love": {"romantic": 1.0, "warm": 0.85, "emotional": 0.8, "soft": 0.7},
    "tender": {"gentle": 0.95, "soft": 0.9, "romantic": 0.8, "warm": 0.75},
    "calm": {"calm": 1.0, "gentle": 0.9, "soft": 0.85, "natural": 0.7},
    "emotional": {"emotional": 1.0, "romantic": 0.8, "warm": 0.7},
}


def _mood_score(features: dict[str, Any], track_moods: list[str]) -> float:
    film_mood = str(features.get("mood") or "warm")
    table = MOOD_AFFINITY.get(film_mood) or MOOD_AFFINITY["warm"]
    if not track_moods:
        return 0.35
    scores = [float(table.get(m, 0.25)) for m in track_moods]
    return sum(scores) / len(scores)


def _emotion_score(features: dict[str, Any], track_moods: list[str]) -> float:
    hist = features.get("emotion_hist") or {}
    if not hist or not track_moods:
        return 0.4
    total = 0.0
    weight_sum = 0.0
    for emotion, weight in hist.items():
        w = float(weight)
        weight_sum += w
        best = 0.25
        emo_key = str(emotion).lower()
        for key, aff in EMOTION_AFFINITY.items():
            if key in emo_key or emo_key in key:
                for tm in track_moods:
                    best = max(best, float(aff.get(tm, 0.25)))
        total += best * w
    return total / weight_sum if weight_sum else 0.4


def _tempo_score(features: dict[str, Any], tempo_bpm: float | None, energy: float | None) -> float:
    cut = float(features.get("cut_density") or 0.25)
    # Preferred BPM rises gently with cut density.
    target_bpm = 70 + min(40.0, cut * 80.0)
    bpm = float(tempo_bpm or 80)
    bpm_delta = abs(bpm - target_bpm)
    bpm_part = max(0.0, 1.0 - bpm_delta / 50.0)

    target_energy = min(0.85, 0.3 + cut * 1.2)
    en = float(energy if energy is not None else 0.4)
    energy_part = max(0.0, 1.0 - abs(en - target_energy) / 0.6)
    return 0.55 * bpm_part + 0.45 * energy_part


def score_track(features: dict[str, Any], track: dict[str, Any]) -> dict[str, Any]:
    moods = [str(m).lower() for m in (track.get("moods") or [])]
    tags = [str(t).lower() for t in (track.get("tags") or [])]
    mood_s = _mood_score(features, moods)
    emo_s = _emotion_score(features, moods + tags)
    tempo_s = _tempo_score(features, track.get("tempo_bpm"), track.get("energy"))

    # Duration fitness: prefer tracks that cover most of the film when looped (all do).
    # Mild preference for longer source tracks.
    # (No hard fail — we loop in remux.)
    length_s = 0.7

    total = 0.4 * mood_s + 0.3 * emo_s + 0.25 * tempo_s + 0.05 * length_s
    return {
        "track_id": track.get("id"),
        "title": track.get("title"),
        "artist": track.get("artist"),
        "file": track.get("file"),
        "moods": moods,
        "tags": tags,
        "energy": track.get("energy"),
        "tempo_bpm": track.get("tempo_bpm"),
        "score": round(total, 4),
        "breakdown": {
            "mood": round(mood_s, 4),
            "emotion": round(emo_s, 4),
            "tempo": round(tempo_s, 4),
            "length": length_s,
        },
        "source_url": track.get("source_url"),
        "license": track.get("license"),
    }


def recommend_tracks(
    features: dict[str, Any],
    *,
    top_n: int = 5,
    catalog: dict | None = None,
) -> dict[str, Any]:
    catalog = catalog or music_catalog()
    tracks = catalog.get("tracks") or []
    scored = [score_track(features, t) for t in tracks if isinstance(t, dict) and t.get("id")]
    scored.sort(key=lambda x: float(x.get("score") or 0), reverse=True)
    top = scored[: max(1, top_n)]
    return {
        "features": features,
        "top_n": top_n,
        "recommendations": top,
        "catalog_size": len(scored),
        "license_summary": catalog.get("license_summary"),
    }
