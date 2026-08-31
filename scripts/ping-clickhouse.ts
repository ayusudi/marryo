/**
 * Round-trip a query against ClickHouse.
 *
 *   npm run ping:clickhouse
 */
import { close, isConfigured, ping } from "../services/src/clickhouse.ts";
import { describeEnv } from "../services/src/env.ts";

if (!isConfigured()) {
  const missing = describeEnv().find((s) => s.subsystem === "clickhouse")?.missing ?? [];
  console.log(`Skipped: ClickHouse is not configured (missing ${missing.join(", ") || "credentials"}).`);
  console.log("Phase 0 does not need it - fill these in when the data model lands.");
  process.exit(0);
}

try {
  const version = await ping();
  console.log(`ClickHouse reachable, server version ${version}.`);
} catch (error) {
  console.error(`ClickHouse unreachable: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
