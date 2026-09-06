"""ClickHouse read/write helpers for the Film Director agent."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import clickhouse_connect

from marryo_agent.schemas import MomentRecord, MomentScore


def _client():
    host = os.environ.get("CLICKHOUSE_HOST", "")
    if not host:
        raise RuntimeError("not configured: ClickHouse — set CLICKHOUSE_HOST")
    port = int(os.environ.get("CLICKHOUSE_PORT", "8443"))
    secure = port != 8123
    return clickhouse_connect.get_client(
        host=host,
        port=port,
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "marryo"),
        secure=secure,
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def query_scenes_for_project(project_id: str) -> list[dict[str, Any]]:
    client = _client()
    result = client.query(
        """
        SELECT scene_id, clip_id, project_id, start_time, end_time, duration
        FROM scenes
        WHERE project_id = {project_id:String}
        ORDER BY clip_id, start_time
        """,
        parameters={"project_id": project_id},
    )
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


def query_moments_for_project(project_id: str) -> list[dict[str, Any]]:
    client = _client()
    result = client.query(
        """
        SELECT *
        FROM video_moments
        WHERE project_id = {project_id:String}
        ORDER BY clip_id, start_time
        """,
        parameters={"project_id": project_id},
    )
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


def query_top_moments(
    project_id: str,
    emotion: str = "%",
    shot_type: str = "%",
    lighting: str = "%",
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Direct ClickHouse fallback when MCP Toolbox is unavailable."""
    client = _client()
    result = client.query(
        """
        SELECT
            vm.moment_id AS moment_id,
            vm.scene_id AS scene_id,
            vm.clip_id AS clip_id,
            vm.project_id AS project_id,
            vm.description AS description,
            vm.emotion AS emotion,
            vm.shot_type AS shot_type,
            vm.lighting AS lighting,
            vm.bride_present AS bride_present,
            vm.groom_present AS groom_present,
            vm.duration AS duration,
            ms.quality_score AS quality_score,
            ms.theme AS theme,
            ms.score_breakdown AS score_breakdown
        FROM video_moments AS vm
        INNER JOIN moment_scores AS ms
            ON vm.moment_id = ms.moment_id AND vm.project_id = ms.project_id
        WHERE vm.project_id = {project_id:String}
            AND vm.emotion LIKE {emotion:String}
            AND vm.shot_type LIKE {shot_type:String}
            AND vm.lighting LIKE {lighting:String}
        ORDER BY ms.quality_score DESC
        LIMIT {limit:UInt32}
        """,
        parameters={
            "project_id": project_id,
            "emotion": emotion,
            "shot_type": shot_type,
            "lighting": lighting,
            "limit": int(limit),
        },
    )
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


def replace_moments_for_project(project_id: str, moments: list[MomentRecord]) -> None:
    client = _client()
    clip_ids = list({m.clip_id for m in moments})
    if clip_ids:
        client.command(
            """
            ALTER TABLE video_moments DELETE WHERE project_id = {project_id:String}
            AND clip_id IN {clip_ids:Array(String)}
            SETTINGS mutations_sync = 1
            """,
            parameters={"project_id": project_id, "clip_ids": clip_ids},
        )
    if not moments:
        return
    columns = [
        "moment_id",
        "scene_id",
        "clip_id",
        "project_id",
        "storage_uri",
        "start_time",
        "end_time",
        "description",
        "action",
        "emotion",
        "shot_type",
        "lighting",
        "camera_motion",
        "bride_present",
        "groom_present",
        "other_people",
        "visual_quality",
        "duration",
        "created_at",
    ]
    data = [
        (
            m.moment_id,
            m.scene_id,
            m.clip_id,
            m.project_id,
            m.storage_uri,
            m.start_time,
            m.end_time,
            m.description,
            m.action,
            m.emotion,
            m.shot_type,
            m.lighting,
            m.camera_motion,
            m.bride_present,
            m.groom_present,
            m.other_people,
            m.visual_quality,
            m.duration,
            _now(),
        )
        for m in moments
    ]
    client.insert("video_moments", data, column_names=columns)


def replace_scores_for_project(project_id: str, theme: str, scores: list[MomentScore]) -> None:
    client = _client()
    client.command(
        """
        ALTER TABLE moment_scores DELETE WHERE project_id = {project_id:String}
        AND theme = {theme:String}
        SETTINGS mutations_sync = 1
        """,
        parameters={"project_id": project_id, "theme": theme},
    )
    if not scores:
        return
    columns = [
        "moment_id",
        "project_id",
        "quality_score",
        "score_breakdown",
        "theme",
        "created_at",
    ]
    data = [
        (
            s.moment_id,
            s.project_id,
            s.quality_score,
            json.dumps(s.score_breakdown),
            s.theme,
            _now(),
        )
        for s in scores
    ]
    client.insert("moment_scores", data, column_names=columns)
