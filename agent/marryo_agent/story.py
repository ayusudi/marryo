"""Generate narrative structure grounded in analyzed footage."""

from __future__ import annotations

from typing import Any

from marryo_agent.clickhouse_client import query_moments_for_project, query_top_moments
from marryo_agent.config_loader import scene_intent_map, story_framework
from marryo_agent.schemas import NarrativeBeat, StoryStructure


def generate_story(
    project_id: str,
    couple_names: list[dict[str, str]],
    wedding_date: str | None,
    story: str | None,
    mood: str | None,
    visual_tone: str | None,
    max_duration: int,
    ending_message: str | None,
    candidate_coverage: dict[str, int] | None = None,
) -> StoryStructure:
    fw = story_framework()
    all_beats = fw["beats"]
    scaling = fw["duration_scaling"]

    if max_duration <= scaling["short"]["max_seconds"]:
        indices = scaling["short"]["beat_indices"]
    elif max_duration <= scaling["medium"]["max_seconds"]:
        indices = scaling["medium"]["beat_indices"]
    else:
        indices = scaling["long"]["beat_indices"]

    moments = _safe_moments(project_id)
    scores = {m["moment_id"]: float(m.get("quality_score") or 0) for m in _safe_scored(project_id)}
    coverage = candidate_coverage or _coverage_from_moments(moments)
    footage_summary = _footage_summary(moments, couple_names, story)

    intent_map = scene_intent_map()
    beats: list[NarrativeBeat] = []
    skipped: list[str] = []
    # Don't invent more clip beats than we have moments to fill.
    clip_budget = max(1, len(moments)) if moments else 0
    # With scarce footage, drop high min_score gates so couple beats still match.
    scarce = len(moments) <= 5

    for i in indices:
        raw = all_beats[i]
        beat_type = raw.get("type", "clip")
        requires = raw.get("requires")
        min_score = 0.0 if scarce else float(raw.get("min_score", 0))
        name = raw["name"]

        # Keep the beat even when identity labels are missing — fill from best
        # remaining footage instead of collapsing a 60s film to two clips.
        if requires == "groom_present" and coverage.get("groom_present", 0) == 0:
            skipped.append(f"{name} (no labeled groom — using best available)")
        elif requires == "bride_present" and coverage.get("bride_present", 0) == 0:
            skipped.append(f"{name} (no labeled bride — using best available)")
        elif requires == "couple_both" and coverage.get("couple_both", 0) == 0:
            skipped.append(f"{name} (no labeled couple — using best available)")

        if beat_type != "clip":
            beats.append(
                NarrativeBeat(
                    name=name,
                    description=raw.get("description", ""),
                    type=beat_type,
                    requires=requires,
                    min_score=min_score,
                    grounded_summary=_card_text(name, couple_names, wedding_date, ending_message),
                )
            )
            continue

        if sum(1 for b in beats if b.type == "clip") >= clip_budget:
            skipped.append(f"{name} (compressed — only {clip_budget} moment(s) available)")
            continue

        candidates = _match_moments(moments, scores, intent_map.get(name, {}), min_score)
        if not candidates and moments:
            # Soft fallback: ignore intent filters when footage is limited
            candidates = _match_moments(moments, scores, {}, 0)[:3]
        if not candidates:
            skipped.append(f"{name} (no matching moments in footage)")
            continue

        grounded = _grounded_beat_description(name, candidates)
        beats.append(
            NarrativeBeat(
                name=name,
                description=grounded,
                type="clip",
                requires=requires,
                min_score=min_score,
                grounded_summary=grounded,
                candidate_moment_ids=[c["moment_id"] for c in candidates[:3]],
            )
        )

    # Ensure at least one clip beat if we have moments
    clip_beats = [b for b in beats if b.type == "clip"]
    if not clip_beats and moments:
        top = sorted(moments, key=lambda m: scores.get(m["moment_id"], 0), reverse=True)
        grounded = _grounded_beat_description("Available footage", top[:3])
        beats.insert(
            0,
            NarrativeBeat(
                name="Available footage",
                description=grounded,
                type="clip",
                grounded_summary=grounded,
                candidate_moment_ids=[m["moment_id"] for m in top[:3]],
            ),
        )

    return StoryStructure(
        project_id=project_id,
        beats=beats,
        max_duration=max_duration,
        couple_names=couple_names,
        wedding_date=wedding_date,
        ending_message=ending_message,
        footage_summary=footage_summary,
        moments_available=len(moments),
        skipped_beats=skipped,
    )


def _safe_moments(project_id: str) -> list[dict[str, Any]]:
    try:
        return query_moments_for_project(project_id)
    except Exception:
        return []


def _safe_scored(project_id: str) -> list[dict[str, Any]]:
    try:
        return query_top_moments(project_id, limit=50)
    except Exception:
        return []


def _coverage_from_moments(moments: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "bride_present": sum(1 for m in moments if m.get("bride_present")),
        "groom_present": sum(1 for m in moments if m.get("groom_present")),
        "couple_both": sum(1 for m in moments if m.get("bride_present") and m.get("groom_present")),
    }


def _footage_summary(
    moments: list[dict[str, Any]],
    couple_names: list[dict[str, str]],
    story: str | None,
) -> str:
    if not moments:
        return "No analyzed moments yet — run analyze_clip and score_moments first."

    names = " & ".join(n.get("name", "") for n in couple_names if n.get("name")) or "the couple"
    bits = []
    for m in moments[:5]:
        desc = (m.get("description") or "").strip()
        if desc:
            bits.append(desc[:160])
    joined = " | ".join(bits)
    base = f"Available footage for {names} ({len(moments)} moments): {joined}"
    if story:
        return f"{base} User notes: {story}"
    return base


def _match_moments(
    moments: list[dict[str, Any]],
    scores: dict[str, float],
    intent: dict[str, Any],
    min_score: float,
) -> list[dict[str, Any]]:
    emotion = str(intent.get("emotion", "%"))
    shot_type = str(intent.get("shot_type", "%"))
    lighting = str(intent.get("lighting", "%"))

    matched: list[dict[str, Any]] = []
    for m in moments:
        mid = str(m.get("moment_id", ""))
        score = scores.get(mid, 0.0)
        if score < min_score and min_score > 0 and scores:
            continue
        if intent.get("bride_present") and not m.get("bride_present"):
            continue
        if intent.get("groom_present") and not m.get("groom_present"):
            continue
        if emotion != "%" and emotion.lower() not in str(m.get("emotion", "")).lower():
            # Free-text Gemini emotions rarely equal exact labels — keep soft.
            pass
        if shot_type != "%" and shot_type.lower() not in str(m.get("shot_type", "")).lower():
            # Soft: ignore strict shot filters when matching scarce wedding footage
            pass
        if lighting != "%" and lighting.lower() not in str(m.get("lighting", "")).lower():
            pass
        matched.append({**m, "quality_score": score})

    matched.sort(key=lambda r: r.get("quality_score", 0), reverse=True)
    return matched


def _grounded_beat_description(name: str, candidates: list[dict[str, Any]]) -> str:
    parts = []
    for c in candidates[:2]:
        desc = (c.get("description") or "").strip()
        emotion = (c.get("emotion") or "").strip()
        shot = (c.get("shot_type") or "").strip()
        snippet = desc[:140] if desc else "analyzed wedding moment"
        extras = ", ".join(x for x in (emotion, shot) if x)
        parts.append(f"{snippet}" + (f" ({extras})" if extras else ""))
    body = " / ".join(parts)
    return f"{name} using real footage: {body}"


def _card_text(
    name: str,
    couple_names: list[dict[str, str]],
    wedding_date: str | None,
    ending_message: str | None,
) -> str:
    names = " & ".join(n.get("name", "") for n in couple_names if n.get("name"))
    if name.lower().startswith("ending"):
        return ending_message or "Forever starts here."
    if names and wedding_date:
        return f"{names} — {wedding_date}"
    return names or wedding_date or "Our Story"
