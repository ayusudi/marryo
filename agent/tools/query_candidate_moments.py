"""ADK tool: query ranked candidate moments via MCP."""

from marryo_agent.mcp_client import query_candidate_moments


def query_candidate_moments_tool(
    project_id: str,
    mood: str,
    visual_tone: str,
    scene_intent: str,
    limit: int = 5,
) -> dict:
    """Fetch ranked moment candidates for a narrative scene intent.

    Args:
        project_id: Marryo project id.
        mood: Project mood.
        visual_tone: Project visual tone.
        scene_intent: Narrative beat name (e.g. Opening, Couple highlight).
        limit: Max candidates to return.

    Returns:
        Dict with candidates list.
    """
    candidates = query_candidate_moments(project_id, mood, visual_tone, scene_intent, limit)
    return {"candidates": candidates, "count": len(candidates)}
