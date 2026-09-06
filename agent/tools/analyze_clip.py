"""ADK tool: analyze a clip's scenes with Gemini."""

from marryo_agent.analyze import analyze_clip_scenes
from marryo_agent.clickhouse_client import query_scenes_for_project, replace_moments_for_project


def analyze_clip(
    clip_id: str,
    storage_uri: str,
    project_id: str,
    work_dir: str = "/tmp",
    bride_person_id: str | None = None,
    groom_person_id: str | None = None,
    clip_person_ids: list[str] | None = None,
) -> dict:
    """Analyze detected scenes in a clip with Gemini video understanding.

    Args:
        clip_id: Marryo clip identifier.
        storage_uri: GCS or local storage URI for the clip.
        project_id: Parent project id.
        work_dir: Temp directory for subclips.
        bride_person_id: Confirmed bride person id for presence override.
        groom_person_id: Confirmed groom person id for presence override.
        clip_person_ids: Person ids appearing in this clip.

    Returns:
        Dict with moment_count, failed_scenes, and moment_ids.
    """
    scenes = [s for s in query_scenes_for_project(project_id) if s["clip_id"] == clip_id]
    moments, failed = analyze_clip_scenes(
        clip_id=clip_id,
        storage_uri=storage_uri,
        project_id=project_id,
        scenes=scenes,
        bride_person_id=bride_person_id,
        groom_person_id=groom_person_id,
        clip_person_ids=set(clip_person_ids or []),
        work_dir=work_dir,
    )
    if moments:
        replace_moments_for_project(project_id, moments)
    return {
        "moment_count": len(moments),
        "moment_ids": [m.moment_id for m in moments],
        "failed_scenes": failed,
    }
