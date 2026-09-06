"""ADK tool: validate Edit Decision List (forced gate)."""

from __future__ import annotations

import json

from marryo_agent.clickhouse_client import query_moments_for_project
from marryo_agent.schemas import EditDecisionList, EdlClip, EdlScene
from marryo_agent.validate_edl import validate_edl, validate_shot_variety


def validate_edl_tool(
    project_id: str,
    edl_json: str,
    max_duration: int = 60,
    ending_message: str | None = "Forever starts here.",
) -> dict:
    """Validate an EDL before it is finalized. Always call this after plan_edit.

    IMPORTANT: Pass edl_json as a JSON *string*, not a nested object.

    Args:
        project_id: Marryo project id.
        edl_json: Stringified EDL JSON (the edl object from plan_edit, or full plan_edit result).
        max_duration: Target duration in seconds.
        ending_message: Expected ending card text.

    Returns:
        Validation result with valid flag and issues list.
    """
    parsed = _parse_edl(edl_json, project_id, max_duration)
    moments = query_moments_for_project(project_id)
    available = sum(float(m.get("duration") or 0) for m in moments)
    moment_lookup = {str(m["moment_id"]): m for m in moments}

    result = validate_edl(parsed, max_duration, ending_message, available)
    variety = validate_shot_variety(parsed, moment_lookup)
    if variety:
        result.issues.extend(variety)
        result.valid = False
    out = result.model_dump()
    out["project_id"] = project_id
    return out


def _parse_edl(raw: str, project_id: str, max_duration: int) -> EditDecisionList:
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as exc:
        raise ValueError(f"edl_json must be a JSON string: {exc}") from exc

    if isinstance(data, dict) and "edl" in data:
        data = data["edl"]
    if not isinstance(data, dict):
        raise ValueError("edl_json must decode to an object")

    scenes = []
    for s in data.get("scenes", []):
        clips = [EdlClip(**c) for c in s.get("clips", [])]
        scenes.append(
            EdlScene(name=s["name"], clips=clips, text=s.get("text"), duration=s.get("duration"))
        )
    return EditDecisionList(
        project_id=str(data.get("project_id") or project_id),
        target_duration=float(data.get("target_duration", max_duration)),
        scenes=scenes,
    )
