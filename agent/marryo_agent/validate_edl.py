"""Deterministic EDL validation (forced gate before persist)."""

from __future__ import annotations

from marryo_agent.schemas import EditDecisionList, ValidationResult


def validate_edl(
    edl: EditDecisionList,
    max_duration: int,
    ending_message: str | None,
    available_footage_duration: float,
    max_repeats: int = 2,
) -> ValidationResult:
    issues: list[str] = []
    total_clip_duration = 0.0
    moment_counts: dict[str, int] = {}
    shot_types: set[str] = set()

    for scene in edl.scenes:
        if scene.text is not None:
            if scene.name.lower() == "ending" and ending_message:
                if ending_message not in scene.text:
                    issues.append("ending scene must include ending_message")
            if scene.duration:
                total_clip_duration += scene.duration
            continue

        if not scene.clips:
            if scene.name.lower() not in ("names and date",):
                issues.append(f"narrative scene '{scene.name}' has no clip")
            continue

        for clip in scene.clips:
            dur = clip.end - clip.start
            total_clip_duration += dur
            moment_counts[clip.moment_id] = moment_counts.get(clip.moment_id, 0) + 1

    for mid, count in moment_counts.items():
        if count > max_repeats:
            issues.append(f"moment {mid} used {count} times (max {max_repeats})")

    tolerance = max_duration * 0.1
    if total_clip_duration > max_duration + tolerance:
        issues.append(
            f"total duration {total_clip_duration:.1f}s exceeds max {max_duration}s (+10% tolerance)"
        )

    if available_footage_duration < max_duration * 0.5:
        suggested = max(int(available_footage_duration), 20)
        issues.append(
            f"available footage ({available_footage_duration:.1f}s) is less than 50% of target {max_duration}s — suggest max_duration≈{suggested}"
        )
        # Do not hard-fail solely on this if the EDL itself is otherwise fillable;
        # surface as issue and let revision compress. Still mark invalid.
        return ValidationResult(
            valid=False,
            issues=issues,
            total_duration=total_clip_duration,
            suggested_max_duration=suggested,
        )

    return ValidationResult(
        valid=len(issues) == 0,
        issues=issues,
        total_duration=total_clip_duration,
    )


def validate_shot_variety(
    edl: EditDecisionList,
    moment_lookup: dict[str, dict],
    min_types: int = 3,
) -> list[str]:
    """Require shot variety only up to what the available footage actually contains."""
    available_types = {
        str(m.get("shot_type")).strip().lower()
        for m in moment_lookup.values()
        if m.get("shot_type")
    }
    available_types.discard("")

    shot_types: set[str] = set()
    clip_count = 0
    for scene in edl.scenes:
        for clip in scene.clips:
            clip_count += 1
            m = moment_lookup.get(clip.moment_id)
            if m and m.get("shot_type"):
                shot_types.add(str(m["shot_type"]).strip().lower())

    if clip_count == 0:
        return []

    # Can't demand more variety than exists in the source moments.
    ceiling = len(available_types) if available_types else len(shot_types)
    required = min(min_types, clip_count, max(ceiling, 1))
    if len(shot_types) < required:
        return [f"only {len(shot_types)} distinct shot_types (need {required})"]
    return []
