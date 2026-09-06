/**
 * ClickHouse client. Phase 0 provides connection wiring only; the schema and the
 * project/clip/scene tables land in a later phase.
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { env } from "./env.ts";

/** Long enough for Cloud mutations after a multi-minute Python scene-detect run. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Keep HTTP progress headers flowing so Cloud / LB idle timeouts do not kill
 * long ALTER … mutations_sync waits. Interval is a string (UInt64 setting).
 */
const LONG_RUNNING_SETTINGS = {
  send_progress_in_http_headers: 1,
  http_headers_progress_interval_ms: "10000",
} as const;

let client: ClickHouseClient | undefined;

/** True when enough ClickHouse credentials are present to attempt a connection. */
export function isConfigured(): boolean {
  const config = env();
  return Boolean(config.CLICKHOUSE_HOST && config.CLICKHOUSE_USER);
}

function buildClient(): ClickHouseClient {
  const config = env();
  if (!config.CLICKHOUSE_HOST) {
    throw new Error("CLICKHOUSE_HOST is not set");
  }
  const protocol = config.CLICKHOUSE_PORT === 8123 ? "http" : "https";
  return createClient({
    url: `${protocol}://${config.CLICKHOUSE_HOST}:${config.CLICKHOUSE_PORT}`,
    database: config.CLICKHOUSE_DATABASE,
    username: config.CLICKHOUSE_USER ?? "default",
    password: config.CLICKHOUSE_PASSWORD ?? "",
    application: "marryo",
    request_timeout: REQUEST_TIMEOUT_MS,
    clickhouse_settings: { ...LONG_RUNNING_SETTINGS },
    keep_alive: {
      enabled: true,
      // Stay under typical Cloud idle close; destroy before reuse after long Python gaps.
      idle_socket_ttl: 8_000,
    },
  });
}

/**
 * The shared client, created on first use. ClickHouse Cloud speaks HTTPS on 8443 and
 * self-hosted speaks HTTP on 8123, so the protocol follows the port.
 */
export function clickhouse(): ClickHouseClient {
  if (!client) {
    client = buildClient();
  }
  return client;
}

/** Round-trip a trivial query. Returns the server version on success. */
export async function ping(): Promise<string> {
  const result = await clickhouse().query({
    query: "SELECT version() AS version",
    format: "JSONEachRow",
  });
  const rows = await result.json<{ version: string }>();
  return rows[0]?.version ?? "unknown";
}

/**
 * Wake or rebuild the shared client after a long idle gap (e.g. PySceneDetect).
 * Stale Keep-Alive sockets after minutes of no traffic cause "Timeout error."
 */
export async function ensureAlive(): Promise<void> {
  try {
    await ping();
  } catch {
    await close();
    client = buildClient();
    await ping();
  }
}

export async function close(): Promise<void> {
  await client?.close();
  client = undefined;
}

/** True when an error looks like a client/LB timeout (retry-worthy). */
export function isClickHouseTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout/i.test(message);
}
