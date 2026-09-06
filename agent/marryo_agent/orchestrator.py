"""Film Director orchestration pipeline (Phase 5 hybrid)."""

from __future__ import annotations

import os
import tempfile
from typing import Any

from marryo_agent.analyze import analyze_project_scenes, select_scenes_for_analysis
from marryo_agent.clickhouse_client import (
    query_scenes_for_project,
    replace_moments_for_project,
    replace_scores_for_project,
)
from marryo_agent.config_loader import derive_theme
from marryo_agent.mcp_client import query_candidate_moments
from marryo_agent.plan_edit import plan_edit
from marryo_agent.schemas import DirectorResult, FailedScene
from marryo_agent.scoring import score_all_moments
from marryo_agent.story import generate_story
from marryo_agent.validate_edl import validate_edl, validate_shot_variety


def run_film_director(manifest: dict[str, Any]) -> dict[str, Any]:
    project = manifest["project"]
    project_id = project["project_id"]
    clips = [c for c in manifest.get("clips", []) if c.get("valid") is True and c.get("storage_uri")]
    clip_persons = manifest.get("clip_persons", [])

    bride_id = project.get("bride_person_id")
    groom_id = project.get("groom_person_id")
    persons_by_clip: dict[str, set[str]] = {}
    for cp in clip_persons:
        persons_by_clip.setdefault(cp["clip_id"], set()).add(cp["person_id"])

    all_scenes = query_scenes_for_project(project_id)
    scenes_by_clip: dict[str, list[dict]] = {}
    for s in all_scenes:
        scenes_by_clip.setdefault(s["clip_id"], []).append(s)

    work_dir = tempfile.mkdtemp(prefix="marryo-director-")
    all_moments = []
    all_failed: list[FailedScene] = []

    # Cap scenes project-wide, then analyze in parallel.
    selected = select_scenes_for_analysis(scenes_by_clip)
    jobs = []
    for clip in clips:
        clip_id = clip["clip_id"]
        clip_scenes = selected.get(clip_id, [])
        if not clip_scenes:
            continue
        jobs.append(
            {
                "clip_id": clip_id,
                "storage_uri": clip["storage_uri"],
                "project_id": project_id,
                "scenes": clip_scenes,
                "bride_person_id": bride_id,
                "groom_person_id": groom_id,
                "clip_person_ids": persons_by_clip.get(clip_id, set()),
            }
        )
    moments, failed = analyze_project_scenes(jobs, work_dir)
    all_moments.extend(moments)
    all_failed.extend([FailedScene(**f) for f in failed])

    if all_moments:
        replace_moments_for_project(project_id, all_moments)

    # Step 2: score moments
    theme = derive_theme(project.get("mood"))
    scores = score_all_moments(all_moments, project.get("mood"))
    if scores:
        replace_scores_for_project(project_id, theme, scores)

    # Coverage for story generation
    coverage = {
        "bride_present": sum(1 for m in all_moments if m.bride_present),
        "groom_present": sum(1 for m in all_moments if m.groom_present),
        "couple_both": sum(1 for m in all_moments if m.bride_present and m.groom_present),
    }

    # Step 3: generate story
    narrative = generate_story(
        project_id=project_id,
        couple_names=project.get("couple_names", []),
        wedding_date=project.get("wedding_date"),
        story=project.get("story"),
        mood=project.get("mood"),
        visual_tone=project.get("visual_tone"),
        max_duration=int(project.get("max_duration", 90)),
        ending_message=project.get("ending_message"),
        candidate_coverage=coverage,
    )

    # Step 4: query candidates per beat
    candidates_by_beat: dict[str, list[dict]] = {}
    use_mcp = os.environ.get("MCP_TOOLBOX_URL", "").strip() != ""
    for beat in narrative.beats:
        if beat.type != "clip":
            continue
        if use_mcp:
            try:
                candidates_by_beat[beat.name] = query_candidate_moments(
                    project_id=project_id,
                    mood=project.get("mood") or "warm",
                    visual_tone=project.get("visual_tone") or "cinematic",
                    scene_intent=beat.name,
                    limit=15,
                )
            except Exception:
                candidates_by_beat[beat.name] = _local_candidates(all_moments, scores, beat.name)
        else:
            candidates_by_beat[beat.name] = _local_candidates(all_moments, scores, beat.name)

    # Step 5-7: plan + validate with revision loop
    max_duration = int(project.get("max_duration", 90))
    available_footage = sum(m.duration for m in all_moments)
    moment_lookup = {m.moment_id: m.model_dump() for m in all_moments}
    for s in scores:
        moment_lookup.setdefault(s.moment_id, {})["quality_score"] = s.quality_score

    extra_moments = [
        {**m.model_dump(), "quality_score": moment_lookup.get(m.moment_id, {}).get("quality_score", 0)}
        for m in all_moments
    ]
    edl = plan_edit(narrative, candidates_by_beat, extra_moments=extra_moments)
    issues: list[str] = []
    for attempt in range(3):
        validation = validate_edl(
            edl,
            max_duration=max_duration,
            ending_message=project.get("ending_message"),
            available_footage_duration=available_footage,
        )
        variety_issues = validate_shot_variety(edl, moment_lookup)
        all_issues = validation.issues + variety_issues
        if validation.valid and not variety_issues:
            issues = []
            break
        issues = all_issues
        if attempt < 2:
            edl = plan_edit(
                narrative,
                candidates_by_beat,
                revision_issues=issues,
                extra_moments=extra_moments,
            )

    top_moments = sorted(
        [
            {
                "moment_id": s.moment_id,
                "quality_score": s.quality_score,
                "score_breakdown": s.score_breakdown,
                "emotion": moment_lookup.get(s.moment_id, {}).get("emotion"),
            }
            for s in scores
        ],
        key=lambda x: x["quality_score"],
        reverse=True,
    )[:5]

    result = DirectorResult(
        project_id=project_id,
        edl=edl,
        valid=len(issues) == 0,
        issues=issues,
        failed_scenes=all_failed,
        moments_analyzed=len(all_moments),
        moments_scored=len(scores),
        theme=theme,
        top_moments=top_moments,
    )
    return result.model_dump()


def _local_candidates(moments, scores, beat_name: str) -> list[dict]:
    score_map = {s.moment_id: s.quality_score for s in scores}
    rows = []
    for m in moments:
        rows.append({**m.model_dump(), "quality_score": score_map.get(m.moment_id, 0)})
    rows.sort(key=lambda r: r.get("quality_score", 0), reverse=True)
    return rows[:20]
