/**
 * Thin HTTP client for Google MCP Toolbox for Databases (Phase 3 proof).
 * Invokes tools via Toolbox's REST API (`--enable-api`), not hand-rolled SQL.
 */

import { env } from "./env.ts";

export class McpToolboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolboxError";
  }
}

function toolboxBaseUrl(): string {
  return env().MCP_TOOLBOX_URL.replace(/\/$/, "");
}

export async function isToolboxReachable(timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${toolboxBaseUrl()}/api/toolset`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /api/tool/{name}/invoke with a JSON parameter object.
 * Requires Toolbox started with `--enable-api`.
 */
export async function invokeToolboxTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const url = `${toolboxBaseUrl()}/api/tool/${encodeURIComponent(toolName)}/invoke`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (error) {
    throw new McpToolboxError(
      `MCP Toolbox unreachable at ${toolboxBaseUrl()}: ${error instanceof Error ? error.message : String(error)}. ` +
        "Start toolbox with --config mcp/toolbox/tools.yaml --enable-api (see mcp/toolbox/README.md).",
    );
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // keep text
  }

  if (!response.ok) {
    throw new McpToolboxError(
      `MCP tool ${toolName} failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  // Toolbox often wraps rows in { result: "<json string>" } or { result: [...] }
  if (body && typeof body === "object" && "result" in body) {
    const result = (body as { result: unknown }).result;
    if (typeof result === "string") {
      try {
        return JSON.parse(result) as unknown;
      } catch {
        return result;
      }
    }
    return result;
  }
  return body;
}

export async function queryTopMoments(input: {
  project_id: string;
  emotion?: string;
  shot_type?: string;
  lighting?: string;
  limit?: number;
}): Promise<unknown> {
  return invokeToolboxTool("query_top_moments", {
    project_id: input.project_id,
    emotion: input.emotion ?? "%",
    shot_type: input.shot_type ?? "%",
    lighting: input.lighting ?? "%",
    limit: input.limit ?? 10,
  });
}

export async function queryScenesForClip(clipId: string): Promise<unknown> {
  return invokeToolboxTool("query_scenes_for_clip", { clip_id: clipId });
}
