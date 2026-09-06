/**
 * Apply ClickHouse DDL from clickhouse/schema.sql.
 *
 *   npm run db:clickhouse
 */
import {
  ClickHouseNotConfiguredError,
  ensureSchema,
} from "../services/src/clickhouse-schema.ts";
import { close, isConfigured } from "../services/src/clickhouse.ts";
import { describeEnv } from "../services/src/env.ts";

if (!isConfigured()) {
  const missing = describeEnv().find((s) => s.subsystem === "clickhouse")?.missing ?? [];
  console.error(
    `not configured: ClickHouse — missing ${missing.join(", ") || "credentials"}. ` +
      "Set CLICKHOUSE_HOST, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD (and usually CLICKHOUSE_PASSWORD).",
  );
  process.exit(1);
}

try {
  await ensureSchema();
  console.log("ClickHouse schema ensured (database marryo + scenes, video_moments, moment_scores).");
} catch (error) {
  if (error instanceof ClickHouseNotConfiguredError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    console.error(`ClickHouse migrate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} finally {
  await close();
}
