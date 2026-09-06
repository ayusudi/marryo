"""ADK tool: deterministic moment scoring."""

from marryo_agent.clickhouse_client import query_moments_for_project, replace_scores_for_project
from marryo_agent.config_loader import derive_theme
from marryo_agent.schemas import MomentRecord
from marryo_agent.scoring import score_all_moments


def score_moments(project_id: str, theme: str | None = None, mood: str | None = None) -> dict:
    """Score all analyzed moments for a project using theme-weighted rules.

    Args:
        project_id: Marryo project id.
        theme: Scoring theme (romantic/cinematic/fun). Derived from mood if omitted.
        mood: Project mood used to derive theme when theme is omitted.

    Returns:
        Dict with theme, scored_count, and top moment ids.
    """
    resolved_theme = theme or derive_theme(mood)
    rows = query_moments_for_project(project_id)
    moments = []
    for row in rows:
        data = {k: row[k] for k in MomentRecord.model_fields if k in row}
        moments.append(MomentRecord(**data))
    scores = score_all_moments(moments, mood or resolved_theme)
    if scores:
        replace_scores_for_project(project_id, resolved_theme, scores)
    top = sorted(scores, key=lambda s: s.quality_score, reverse=True)[:3]
    return {
        "theme": resolved_theme,
        "scored_count": len(scores),
        "top_moments": [
            {"moment_id": s.moment_id, "quality_score": s.quality_score} for s in top
        ],
    }
