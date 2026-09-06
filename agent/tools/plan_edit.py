"""ADK tool: build Edit Decision List from project_id (no giant nested args)."""

from __future__ import annotations

import json

from marryo_agent.clickhouse_client import query_moments_for_project, query_top_moments
from marryo_agent.mcp_client import query_candidate_moments
from marryo_agent.plan_edit import plan_edit
from marryo_agent.story import generate_story


def plan_edit_tool(
    project_id: str,
    max_duration: int = 60,
    mood: str = "warm",
    visual_tone: str = "cinematic",
    ending_message: str | None = "Forever starts here.",
    wedding_date: str | None = None,
    couple_names_json: str = '[{"name":"Ada","role":"bride"},{"name":"Alan","role":"groom"}]',
    revision_issues_json: str = "[]",
) -> dict:
    """Build an Edit Decision List for a project.

    IMPORTANT: Pass only these simple string/number args. Do NOT pass nested objects.
    This tool loads analyzed moments, builds the story, queries candidates, and plans the EDL.

    Args:
        project_id: Marryo project id.
        max_duration: Target film length in seconds.
        mood: Project mood (e.g. warm).
        visual_tone: Visual tone (e.g. cinematic).
        ending_message: Ending card text.
        wedding_date: Optional wedding date string.
        couple_names_json: JSON string array of {name, role} objects.
        revision_issues_json: JSON string array of validation issues to fix.

    Returns:
        EDL dict plus planning metadata.
    """
    couple_names = _parse_couple_names(couple_names_json)
    revision_issues = _parse_str_list(revision_issues_json)

    moments = query_moments_for_project(project_id)
    available = sum(float(m.get("duration") or 0) for m in moments)
    # Auto-compress target when footage is short (avoids impossible 50%-of-target gate).
    effective_max = max_duration
    if available > 0 and max_duration > available * 1.2:
        effective_max = max(20, int(available))

    narrative = generate_story(
        project_id=project_id,
        couple_names=couple_names,
        wedding_date=wedding_date,
        story=None,
        mood=mood,
        visual_tone=visual_tone,
        max_duration=effective_max,
        ending_message=ending_message,
    )

    candidates_by_beat: dict[str, list[dict]] = {}
    for beat in narrative.beats:
        if beat.type != "clip":
            continue
        # Prefer moment ids already grounded on the beat
        if beat.candidate_moment_ids:
            lookup = {m["moment_id"]: m for m in query_top_moments(project_id, limit=50)}
            pool = []
            for mid in beat.candidate_moment_ids:
                row = lookup.get(mid)
                if row:
                    pool.append(row)
            if pool:
                candidates_by_beat[beat.name] = pool
                continue
        try:
            candidates_by_beat[beat.name] = query_candidate_moments(
                project_id=project_id,
                mood=mood,
                visual_tone=visual_tone,
                scene_intent=beat.name,
                limit=5,
            )
        except Exception:
            candidates_by_beat[beat.name] = query_top_moments(project_id, limit=15)

    # If still empty, dump all scored moments into each clip beat
    fallback = query_top_moments(project_id, limit=25)
    if not fallback:
        moments = query_moments_for_project(project_id)
        fallback = [{**m, "quality_score": 0} for m in moments]
    for beat in narrative.beats:
        if beat.type == "clip" and not candidates_by_beat.get(beat.name):
            candidates_by_beat[beat.name] = fallback

    extra = fallback or [{**m, "quality_score": 0} for m in moments]
    edl = plan_edit(
        narrative,
        candidates_by_beat,
        revision_issues or None,
        extra_moments=extra,
    )
    return {
        "edl": edl.model_dump(),
        "beats_planned": [b.name for b in narrative.beats],
        "skipped_beats": narrative.skipped_beats,
        "footage_summary": narrative.footage_summary,
        "moments_available": narrative.moments_available,
        "max_duration_used": effective_max,
        "available_footage_duration": round(available, 2),
    }


def _parse_couple_names(raw: str) -> list[dict]:
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return [{"name": "Couple", "role": "bride"}]
    if not isinstance(data, list):
        return [{"name": "Couple", "role": "bride"}]
    normalized = []
    for item in data:
        if not isinstance(item, dict):
            continue
        if "name" in item:
            normalized.append({"name": str(item["name"]), "role": str(item.get("role", "bride"))})
            continue
        if "bride_name" in item:
            normalized.append({"name": str(item["bride_name"]), "role": "bride"})
        if "groom_name" in item:
            normalized.append({"name": str(item["groom_name"]), "role": "groom"})
    return normalized or [{"name": "Couple", "role": "bride"}]


def _parse_str_list(raw: str) -> list[str]:
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return []
    if isinstance(data, list):
        return [str(x) for x in data]
    return []
