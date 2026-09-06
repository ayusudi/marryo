"""Pydantic models for Phase 5 Film Director pipeline."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MomentAnalysis(BaseModel):
    scene_id: str
    description: str
    action: str
    emotion: str
    shot_type: str
    lighting: str
    camera_motion: str
    bride_present: bool
    groom_present: bool
    other_people: bool
    visual_quality: str


class MomentRecord(BaseModel):
    moment_id: str
    scene_id: str
    clip_id: str
    project_id: str
    storage_uri: str
    start_time: float
    end_time: float
    description: str
    action: str
    emotion: str
    shot_type: str
    lighting: str
    camera_motion: str
    bride_present: bool
    groom_present: bool
    other_people: bool
    visual_quality: str
    duration: float


class ScoreBreakdown(BaseModel):
    couple: float = 0
    emotion: float = 0
    visual_quality: float = 0
    lighting: float = 0
    shot_type: float = 0
    duration: float = 0
    penalty: float = 0


class MomentScore(BaseModel):
    moment_id: str
    project_id: str
    quality_score: float
    score_breakdown: dict[str, float]
    theme: str


class EdlClip(BaseModel):
    moment_id: str
    start: float
    end: float


class EdlScene(BaseModel):
    name: str
    clips: list[EdlClip] = Field(default_factory=list)
    text: str | None = None
    duration: float | None = None


class EditDecisionList(BaseModel):
    project_id: str
    target_duration: float
    scenes: list[EdlScene]


class ValidationResult(BaseModel):
    valid: bool
    issues: list[str] = Field(default_factory=list)
    total_duration: float = 0
    suggested_max_duration: int | None = None


class NarrativeBeat(BaseModel):
    name: str
    description: str
    type: str = "clip"
    requires: str | None = None
    min_score: float = 0
    # Grounded in analyzed footage (Phase 5)
    grounded_summary: str | None = None
    candidate_moment_ids: list[str] = Field(default_factory=list)


class StoryStructure(BaseModel):
    project_id: str
    beats: list[NarrativeBeat]
    max_duration: int
    couple_names: list[dict[str, str]]
    wedding_date: str | None = None
    ending_message: str | None = None
    footage_summary: str | None = None
    moments_available: int = 0
    skipped_beats: list[str] = Field(default_factory=list)


class FailedScene(BaseModel):
    scene_id: str
    clip_id: str
    reason: str


class DirectorResult(BaseModel):
    project_id: str
    edl: EditDecisionList
    valid: bool
    issues: list[str] = Field(default_factory=list)
    failed_scenes: list[FailedScene] = Field(default_factory=list)
    moments_analyzed: int = 0
    moments_scored: int = 0
    theme: str = "romantic"
    top_moments: list[dict[str, Any]] = Field(default_factory=list)
