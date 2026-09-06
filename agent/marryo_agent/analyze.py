"""Gemini video analysis per scene."""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from google import genai
from google.genai import types

from marryo_agent.schemas import MomentAnalysis, MomentRecord
from marryo_agent.storage_local import extract_subclip, materialize_local

ANALYSIS_PROMPT = """You are analyzing a short wedding video scene clip.
Describe what you see. Return structured JSON only — no quality score.
Focus on: description, action, emotion, shot_type, lighting, camera_motion,
and whether bride, groom, or other people appear.
"""

# Cap Gemini input length (EDL still uses full scene start/end).
ANALYSIS_MAX_DURATION_S = float(os.environ.get("MARRYO_ANALYSIS_MAX_S", "5"))
ANALYZE_CONCURRENCY = max(1, int(os.environ.get("MARRYO_ANALYZE_CONCURRENCY", "6")))
MAX_SCENES_PER_PROJECT = max(1, int(os.environ.get("MARRYO_MAX_SCENES_PROJECT", "12")))

_analysis_cache: dict[str, MomentAnalysis] = {}


def _use_vertex() -> bool:
    return os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "1") not in ("0", "false", "False")


def _gemini_client() -> genai.Client:
    if _use_vertex():
        project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
        if not project:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT required for Vertex AI")
        return genai.Client(vertexai=True, project=project, location=location)
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY required when GOOGLE_GENAI_USE_VERTEXAI=0")
    return genai.Client(api_key=api_key)


def _model() -> str:
    return os.environ.get("MARRYO_MODEL", "gemini-2.5-flash")


def _gemini_configured() -> bool:
    if os.environ.get("MOCK_GEMINI", "").lower() in ("1", "true", "yes"):
        return False
    if _use_vertex():
        return bool(os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip())
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


def _mime_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in (".mov", ".qt"):
        return "video/quicktime"
    if suffix in (".webm",):
        return "video/webm"
    return "video/mp4"


def _video_part(client: genai.Client, video_path: str) -> types.Part:
    """Build a video Part compatible with the active Gemini client.

    Vertex AI does not support client.files.upload (Gemini Developer API only).
    Use inline bytes for local subclips on Vertex; File API on Developer API.
    """
    path = Path(video_path)
    mime = _mime_for_path(path)

    if _use_vertex():
        data = path.read_bytes()
        return types.Part.from_bytes(data=data, mime_type=mime)

    uploaded = client.files.upload(file=str(path))
    return types.Part.from_uri(
        file_uri=uploaded.uri,
        mime_type=uploaded.mime_type or mime,
    )


def _cache_key(clip_id: str, start: float, end: float) -> str:
    return f"{clip_id}:{round(start, 3)}:{round(end, 3)}"


def analyze_scene_video(
    video_path: str,
    scene_id: str,
) -> MomentAnalysis:
    if not _gemini_configured():
        variants = [
            ("wide", "calm", "daylight"),
            ("medium", "romantic", "golden_hour"),
            ("close_up", "tender", "soft"),
        ]
        idx = abs(hash(scene_id)) % len(variants)
        shot_type, emotion, lighting = variants[idx]
        return MomentAnalysis(
            scene_id=scene_id,
            description="Mock wedding scene for pipeline test",
            action="standing",
            emotion=emotion,
            shot_type=shot_type,
            lighting=lighting,
            camera_motion="static",
            bride_present=True,
            groom_present=idx == 1,
            other_people=False,
            visual_quality="high",
        )

    client = _gemini_client()
    path = Path(video_path)
    if not path.is_file():
        raise FileNotFoundError(f"scene video not found: {video_path}")

    video_part = _video_part(client, video_path)
    schema = MomentAnalysis.model_json_schema()
    response = client.models.generate_content(
        model=_model(),
        contents=[
            types.Content(
                role="user",
                parts=[
                    video_part,
                    types.Part.from_text(text=ANALYSIS_PROMPT + f"\nscene_id: {scene_id}"),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=0.2,
        ),
    )

    text = response.text or ""
    data = json.loads(text)
    data["scene_id"] = scene_id
    return MomentAnalysis.model_validate(data)


def apply_identity_override(
    analysis: MomentAnalysis,
    bride_person_id: str | None,
    groom_person_id: str | None,
    clip_person_ids: set[str],
) -> MomentAnalysis:
    data = analysis.model_dump()
    if bride_person_id and bride_person_id in clip_person_ids:
        data["bride_present"] = True
    if groom_person_id and groom_person_id in clip_person_ids:
        data["groom_present"] = True
    return MomentAnalysis.model_validate(data)


def select_scenes_for_analysis(
    scenes_by_clip: dict[str, list[dict]],
    max_total: int = MAX_SCENES_PER_PROJECT,
) -> dict[str, list[dict]]:
    """Pick up to max_total scenes project-wide, preferring longer mid-clip segments."""
    flat: list[tuple[str, dict, float]] = []
    for clip_id, scenes in scenes_by_clip.items():
        for scene in scenes:
            start = float(scene.get("start_time", 0))
            end = float(scene.get("end_time", start))
            dur = max(0.0, end - start)
            flat.append((clip_id, scene, dur))
    flat.sort(key=lambda row: row[2], reverse=True)
    chosen = flat[:max_total]
    out: dict[str, list[dict]] = {}
    for clip_id, scene, _ in chosen:
        out.setdefault(clip_id, []).append(scene)
    for clip_id in out:
        out[clip_id].sort(key=lambda s: float(s.get("start_time", 0)))
    return out


def _analyze_one_scene(
    *,
    clip_id: str,
    storage_uri: str,
    project_id: str,
    scene: dict,
    local_clip: str,
    work_dir: str,
    bride_person_id: str | None,
    groom_person_id: str | None,
    clip_person_ids: set[str],
) -> tuple[MomentRecord | None, dict | None]:
    scene_id = str(scene["scene_id"])
    start = float(scene["start_time"])
    end = float(scene["end_time"])
    duration = end - start
    last_error = ""

    key = _cache_key(clip_id, start, end)
    cached = _analysis_cache.get(key)

    for attempt in range(2):
        try:
            if cached is None:
                analysis_end = min(end, start + ANALYSIS_MAX_DURATION_S)
                subclip = extract_subclip(local_clip, start, analysis_end, work_dir)
                analysis = analyze_scene_video(subclip, scene_id)
                _analysis_cache[key] = analysis
            else:
                analysis = cached
            analysis = apply_identity_override(
                analysis, bride_person_id, groom_person_id, clip_person_ids
            )
            moment_id = f"mom_{scene_id}"
            return (
                MomentRecord(
                    moment_id=moment_id,
                    scene_id=scene_id,
                    clip_id=clip_id,
                    project_id=project_id,
                    storage_uri=storage_uri,
                    start_time=start,
                    end_time=end,
                    description=analysis.description,
                    action=analysis.action,
                    emotion=analysis.emotion,
                    shot_type=analysis.shot_type,
                    lighting=analysis.lighting,
                    camera_motion=analysis.camera_motion,
                    bride_present=analysis.bride_present,
                    groom_present=analysis.groom_present,
                    other_people=analysis.other_people,
                    visual_quality=analysis.visual_quality,
                    duration=round(duration, 3),
                ),
                None,
            )
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            cached = None
    return None, {"scene_id": scene_id, "clip_id": clip_id, "reason": last_error}


def analyze_clip_scenes(
    clip_id: str,
    storage_uri: str,
    project_id: str,
    scenes: list[dict],
    bride_person_id: str | None,
    groom_person_id: str | None,
    clip_person_ids: set[str],
    work_dir: str,
) -> tuple[list[MomentRecord], list[dict]]:
    """Analyze all scenes for a clip (parallel within the clip). Returns (moments, failed_scenes)."""
    local_clip = materialize_local(storage_uri, work_dir)
    moments: list[MomentRecord] = []
    failed: list[dict] = []

    if not scenes:
        return moments, failed

    workers = min(ANALYZE_CONCURRENCY, len(scenes))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(
                _analyze_one_scene,
                clip_id=clip_id,
                storage_uri=storage_uri,
                project_id=project_id,
                scene=scene,
                local_clip=local_clip,
                work_dir=work_dir,
                bride_person_id=bride_person_id,
                groom_person_id=groom_person_id,
                clip_person_ids=clip_person_ids,
            )
            for scene in scenes
        ]
        for fut in as_completed(futures):
            moment, fail = fut.result()
            if moment:
                moments.append(moment)
            if fail:
                failed.append(fail)

    moments.sort(key=lambda m: m.start_time)
    return moments, failed


def analyze_project_scenes(
    jobs: list[dict],
    work_dir: str,
) -> tuple[list[MomentRecord], list[dict]]:
    """Analyze many (clip, scenes) jobs with shared concurrency across the project."""
    # Materialize each clip once up front.
    local_by_uri: dict[str, str] = {}
    for job in jobs:
        uri = job["storage_uri"]
        if uri not in local_by_uri:
            local_by_uri[uri] = materialize_local(uri, work_dir)

    tasks: list[dict] = []
    for job in jobs:
        for scene in job["scenes"]:
            tasks.append({**job, "scene": scene, "local_clip": local_by_uri[job["storage_uri"]]})

    moments: list[MomentRecord] = []
    failed: list[dict] = []
    if not tasks:
        return moments, failed

    workers = min(ANALYZE_CONCURRENCY, len(tasks))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(
                _analyze_one_scene,
                clip_id=t["clip_id"],
                storage_uri=t["storage_uri"],
                project_id=t["project_id"],
                scene=t["scene"],
                local_clip=t["local_clip"],
                work_dir=work_dir,
                bride_person_id=t.get("bride_person_id"),
                groom_person_id=t.get("groom_person_id"),
                clip_person_ids=t.get("clip_person_ids") or set(),
            )
            for t in tasks
        ]
        for fut in as_completed(futures):
            moment, fail = fut.result()
            if moment:
                moments.append(moment)
            if fail:
                failed.append(fail)

    moments.sort(key=lambda m: (m.clip_id, m.start_time))
    return moments, failed
