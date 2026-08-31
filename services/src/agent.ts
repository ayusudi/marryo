/**
 * Client for the Marryo Film Director agent.
 *
 * ADK is Python-native, so the agent runs as a separate service and the Next.js API
 * layer talks to it over HTTP. Locally that is the ADK dev server on AGENT_SERVICE_URL;
 * once the agent is deployed, AGENT_ENGINE_ENDPOINT takes over.
 */

import { env } from "./env.ts";

export interface AgentPing {
  ok: boolean;
  target: string;
  /** Agents the ADK server is serving, when reachable. */
  apps?: string[];
  error?: string;
}

/** Where the agent is currently expected to be reachable. */
export function agentBaseUrl(): string {
  const config = env();
  return (config.AGENT_ENGINE_ENDPOINT ?? config.AGENT_SERVICE_URL).replace(/\/+$/, "");
}

/**
 * Check that the agent service is up. The ADK dev server exposes GET /list-apps, which
 * doubles as a liveness check and a confirmation that marryo_film_director was loaded.
 */
export async function pingAgent(timeoutMs = 5_000): Promise<AgentPing> {
  const target = `${agentBaseUrl()}/list-apps`;

  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return { ok: false, target, error: `agent responded ${response.status}` };
    }

    const body: unknown = await response.json();
    const apps = Array.isArray(body) ? body.filter((app): app is string => typeof app === "string") : [];

    return { ok: true, target, apps };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, target, error };
  }
}
