/**
 * ClickHouse client. Phase 0 provides connection wiring only; the schema and the
 * project/clip/scene tables land in a later phase.
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { env } from "./env.ts";

let client: ClickHouseClient | undefined;

/** True when enough ClickHouse credentials are present to attempt a connection. */
export function isConfigured(): boolean {
  const config = env();
  return Boolean(config.CLICKHOUSE_HOST && config.CLICKHOUSE_USER);
}

/**
 * The shared client, created on first use. ClickHouse Cloud speaks HTTPS on 8443 and
 * self-hosted speaks HTTP on 8123, so the protocol follows the port.
 */
export function clickhouse(): ClickHouseClient {
  if (!client) {
    const config = env();
    if (!config.CLICKHOUSE_HOST) {
      throw new Error("CLICKHOUSE_HOST is not set");
    }
    const protocol = config.CLICKHOUSE_PORT === 8123 ? "http" : "https";
    client = createClient({
      url: `${protocol}://${config.CLICKHOUSE_HOST}:${config.CLICKHOUSE_PORT}`,
      database: config.CLICKHOUSE_DATABASE,
      username: config.CLICKHOUSE_USER ?? "default",
      password: config.CLICKHOUSE_PASSWORD ?? "",
      application: "marryo",
    });
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

export async function close(): Promise<void> {
  await client?.close();
  client = undefined;
}
