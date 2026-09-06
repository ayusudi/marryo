"""Deterministic moment scoring engine."""

from __future__ import annotations

from marryo_agent.config_loader import derive_theme, scoring_config
from marryo_agent.schemas import MomentRecord, MomentScore, ScoreBreakdown


def score_moment(moment: MomentRecord, theme: str) -> MomentScore:
    cfg_all = scoring_config()
    cfg = cfg_all.get(theme) or cfg_all["romantic"]
    breakdown = ScoreBreakdown()

    if moment.bride_present and moment.groom_present:
        breakdown.couple = float(cfg["couple_both"])
    elif moment.bride_present or moment.groom_present:
        breakdown.couple = float(cfg["couple_one"])
    else:
        breakdown.couple = float(cfg.get("couple_none", 0))

    emotion = moment.emotion.lower()
    if emotion in [e.lower() for e in cfg.get("emotions_positive", [])]:
        breakdown.emotion = float(cfg["emotion_match"])

    vq_cfg = cfg.get("visual_quality", {})
    breakdown.visual_quality = float(vq_cfg.get(moment.visual_quality.lower(), 0))

    if moment.lighting.lower() in [l.lower() for l in cfg.get("lightings_positive", [])]:
        breakdown.lighting = float(cfg["lighting_match"])

    shot_bonus = cfg.get("shot_bonus", {})
    breakdown.shot_type = float(shot_bonus.get(moment.shot_type.lower(), 0))

    ds = cfg.get("duration_sweet_spot", {})
    if ds.get("min", 0) <= moment.duration <= ds.get("max", 999):
        breakdown.duration = float(ds.get("bonus", 0))

    if moment.other_people and not (moment.bride_present and moment.groom_present):
        breakdown.penalty = float(cfg.get("other_people_penalty", 0))

    total = (
        breakdown.couple
        + breakdown.emotion
        + breakdown.visual_quality
        + breakdown.lighting
        + breakdown.shot_type
        + breakdown.duration
        + breakdown.penalty
    )
    max_score = float(cfg.get("max_score", 100))
    quality = max(0.0, min(total, max_score))

    return MomentScore(
        moment_id=moment.moment_id,
        project_id=moment.project_id,
        quality_score=round(quality, 1),
        score_breakdown=breakdown.model_dump(),
        theme=theme,
    )


def score_all_moments(moments: list[MomentRecord], mood: str | None) -> list[MomentScore]:
    theme = derive_theme(mood)
    return [score_moment(m, theme) for m in moments]
