"""Build Edit Decision List from narrative structure and ranked candidates."""

from __future__ import annotations

from marryo_agent.schemas import EdlClip, EdlScene, EditDecisionList, StoryStructure

MAX_SINGLE_CLIP_S = 12.0
MIN_CLIP_S = 1.5
# Aim slightly over the target so xfade overlaps still land near max_duration.
FILL_RATIO = 1.07


def plan_edit(
    narrative: StoryStructure,
    candidates_by_beat: dict[str, list[dict]],
    revision_issues: list[str] | None = None,
    max_repeats: int = 2,
    extra_moments: list[dict] | None = None,
) -> EditDecisionList:
    """Pick moments per beat, then pack unused footage until near max_duration."""
    used_counts: dict[str, int] = {}
    used_shots: set[str] = set()
    scenes: list[EdlScene] = []
    target = float(narrative.max_duration)
    clip_beats = [b for b in narrative.beats if b.type == "clip"]
    card_beats = [b for b in narrative.beats if b.type in ("title_card", "ending_card")]
    title_dur = 2.0 if target <= 40 else 4.0
    ending_dur = 3.0 if target <= 40 else 5.0
    card_overhead = sum(title_dur if b.type == "title_card" else ending_dur for b in card_beats)
    clip_time_budget = max(target - card_overhead, target * 0.55)
    per_clip_budget = clip_time_budget / max(len(clip_beats), 1)

    global_pool: list[dict] = []
    seen: set[str] = set()
    for row in list(extra_moments or []) + [
        item for items in candidates_by_beat.values() for item in items
    ]:
        mid = str(row.get("moment_id", ""))
        if mid and mid not in seen:
            seen.add(mid)
            global_pool.append(row)

    for beat in narrative.beats:
        if beat.type == "title_card":
            scenes.append(EdlScene(name=beat.name, text=_title_text(narrative), duration=title_dur))
            continue
        if beat.type == "ending_card":
            scenes.append(
                EdlScene(
                    name=beat.name,
                    text=narrative.ending_message or "Forever starts here.",
                    duration=ending_dur,
                )
            )
            continue

        pool = list(candidates_by_beat.get(beat.name, []))
        chosen = _pick_moment(pool, used_counts, used_shots, revision_issues, max_repeats)
        if chosen is None:
            chosen = _pick_moment(global_pool, used_counts, used_shots, revision_issues, max_repeats)

        if chosen is None:
            scenes.append(EdlScene(name=beat.name, clips=[]))
            continue

        mid = str(chosen["moment_id"])
        used_counts[mid] = used_counts.get(mid, 0) + 1
        shot = str(chosen.get("shot_type") or "")
        if shot:
            used_shots.add(shot)

        duration = float(chosen.get("duration") or 2.0)
        clip_dur = min(duration, per_clip_budget, MAX_SINGLE_CLIP_S)
        scenes.append(
            EdlScene(
                name=beat.name,
                clips=[
                    EdlClip(
                        moment_id=mid,
                        start=0.0,
                        end=round(max(clip_dur, min(duration, MIN_CLIP_S)), 2),
                    )
                ],
            )
        )

    _fill_to_duration(
        scenes,
        global_pool,
        used_counts,
        used_shots,
        target=target,
        revision_issues=revision_issues,
        max_repeats=max_repeats,
    )

    return EditDecisionList(
        project_id=narrative.project_id,
        target_duration=target,
        scenes=scenes,
    )


def _edl_duration(scenes: list[EdlScene]) -> float:
    total = 0.0
    for scene in scenes:
        if scene.duration:
            total += float(scene.duration)
        for clip in scene.clips:
            total += float(clip.end) - float(clip.start)
    return total


def _fill_to_duration(
    scenes: list[EdlScene],
    pool: list[dict],
    used_counts: dict[str, int],
    used_shots: set[str],
    target: float,
    revision_issues: list[str] | None,
    max_repeats: int,
) -> None:
    """Keep adding unused moments until the cut is close to the target length."""
    goal = target * FILL_RATIO
    montage = next((s for s in scenes if "montage" in s.name.lower() and s.text is None), None)
    insert_at = next((i for i, s in enumerate(scenes) if s.text is not None), len(scenes))

    # Leave room for ~0.5s xfade between ~10 scenes so playback lands near max_duration.
    cap = min(target + 5.0, target * 1.08)
    while _edl_duration(scenes) < min(goal, cap):
        remaining = cap - _edl_duration(scenes)
        if remaining < MIN_CLIP_S:
            break
        chosen = _pick_moment(pool, used_counts, used_shots, revision_issues, max_repeats)
        if chosen is None:
            break
        mid = str(chosen["moment_id"])
        duration = float(chosen.get("duration") or 2.0)
        clip_dur = min(duration, remaining, MAX_SINGLE_CLIP_S)
        if clip_dur < MIN_CLIP_S:
            break
        used_counts[mid] = used_counts.get(mid, 0) + 1
        shot = str(chosen.get("shot_type") or "")
        if shot:
            used_shots.add(shot)
        clip = EdlClip(moment_id=mid, start=0.0, end=round(clip_dur, 2))
        if montage is not None:
            montage.clips.append(clip)
        else:
            extra = EdlScene(name="More moments", clips=[clip])
            scenes.insert(insert_at, extra)
            insert_at += 1
            montage = extra


def _pick_moment(
    pool: list[dict],
    used_counts: dict[str, int],
    used_shots: set[str],
    revision_issues: list[str] | None,
    max_repeats: int,
) -> dict | None:
    diversify = bool(revision_issues) and any("shot_type" in issue for issue in (revision_issues or []))

    def rank(row: dict) -> tuple[int, int, float]:
        mid = str(row.get("moment_id", ""))
        if not mid:
            return (9, 9, 0.0)
        count = used_counts.get(mid, 0)
        if count >= max_repeats:
            return (8, 9, 0.0)
        shot = str(row.get("shot_type") or "")
        diversity = 0 if (shot and shot not in used_shots) else 1
        if diversify and diversity == 1 and len(used_shots) < 3:
            diversity = 2
        return (count, diversity, -float(row.get("quality_score") or 0))

    ranked = sorted(pool, key=rank)
    for row in ranked:
        mid = str(row.get("moment_id", ""))
        if mid and used_counts.get(mid, 0) < max_repeats:
            return row
    return None


def _title_text(narrative: StoryStructure) -> str:
    names = " & ".join(n.get("name", "") for n in narrative.couple_names if n.get("name"))
    date = narrative.wedding_date or ""
    if names and date:
        return f"{names} — {date}"
    return names or date or "Our Story"
