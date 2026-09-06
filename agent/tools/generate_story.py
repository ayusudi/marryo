"""ADK tool: generate narrative story structure grounded in footage."""

from marryo_agent.story import generate_story


def generate_story_tool(
    project_id: str,
    couple_names: list[dict],
    wedding_date: str | None,
    story: str | None,
    mood: str | None,
    visual_tone: str | None,
    max_duration: int,
    ending_message: str | None = None,
) -> dict:
    """Build a narrative structure from the framework, grounded in analyzed moments.

    Loads video_moments / scores from ClickHouse for this project_id. Beat
    descriptions reference real footage; beats with no matching moments are skipped.
    Do not invent scenes that are not in the analyzed clips.

    Returns:
        Story structure with footage_summary, grounded beats, and skipped_beats.
    """
    structure = generate_story(
        project_id=project_id,
        couple_names=couple_names,
        wedding_date=wedding_date,
        story=story,
        mood=mood,
        visual_tone=visual_tone,
        max_duration=max_duration,
        ending_message=ending_message,
    )
    return structure.model_dump()
