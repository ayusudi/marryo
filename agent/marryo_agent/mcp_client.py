"""MCP Toolbox HTTP client for reading ranked moments (with ClickHouse fallback)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)


def toolbox_base_url() -> str:
    return os.environ.get("MCP_TOOLBOX_URL", "http://127.0.0.1:5001").rstrip("/")


def invoke_tool(tool_name: str, params: dict[str, Any]) -> Any:
    url = f"{toolbox_base_url()}/api/tool/{tool_name}/invoke"
    body = json.dumps(params).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"MCP Toolbox HTTP {exc.code}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"MCP Toolbox unreachable: {exc}") from exc

    payload = json.loads(raw)
    if isinstance(payload, dict) and "result" in payload:
        result = payload["result"]
        if isinstance(result, str):
            return json.loads(result)
        return result
    return payload


def query_candidate_moments(
    project_id: str,
    mood: str,
    visual_tone: str,
    scene_intent: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    from marryo_agent.clickhouse_client import query_top_moments
    from marryo_agent.config_loader import scene_intent_map

    intent_cfg = scene_intent_map().get(scene_intent, {})
    emotion = intent_cfg.get("emotion", "%")
    shot_type = intent_cfg.get("shot_type", "%")
    lighting = intent_cfg.get("lighting", "%")

    rows: list[dict[str, Any]] = []
    try:
        result = invoke_tool(
            "query_top_moments",
            {
                "project_id": project_id,
                "emotion": emotion,
                "shot_type": shot_type,
                "lighting": lighting,
                "limit": limit,
            },
        )
        if isinstance(result, list):
            rows = result
    except Exception as exc:  # noqa: BLE001 — fall back to direct ClickHouse
        logger.warning("MCP Toolbox unavailable (%s); using ClickHouse fallback", exc)
        rows = query_top_moments(
            project_id=project_id,
            emotion=emotion,
            shot_type=shot_type,
            lighting=lighting,
            limit=limit,
        )

    filtered = rows
    if intent_cfg.get("bride_present"):
        filtered = [r for r in filtered if r.get("bride_present")]
    if intent_cfg.get("groom_present"):
        filtered = [r for r in filtered if r.get("groom_present")]
    return filtered[:limit]
