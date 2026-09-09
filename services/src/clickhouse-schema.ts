/**
 * ClickHouse DDL + sample-row helpers for Phase 3/4 analytics tables.
 * Missing credentials → ClickHouseNotConfiguredError ("not configured: ClickHouse …").
 */

import { createClient } from "@clickhouse/client";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clickhouse,
  close,
  ensureAlive,
  isClickHouseTimeoutError,
  isConfigured,
} from "./clickhouse.ts";
import { env } from "./env.ts";

export class ClickHouseNotConfiguredError extends Error {
  constructor(message = "not configured: ClickHouse — set CLICKHOUSE_HOST, CLICKHOUSE_USER, and CLICKHOUSE_PASSWORD") {
    super(message);
    this.name = "ClickHouseNotConfiguredError";
  }
}

function requireConfigured(): void {
  if (!isConfigured()) {
    throw new ClickHouseNotConfiguredError();
  }
}

/**
 * Keep in sync with clickhouse/schema.sql.
 * Embedded so Cloud Run / Next standalone never depends on a repo-relative file path.
 */
const EMBEDDED_SCHEMA_SQL = `-- Marryo ClickHouse analytics schema (Phase 3).
CREATE DATABASE IF NOT EXISTS marryo;

CREATE TABLE IF NOT EXISTS marryo.scenes
(
    scene_id String,
    clip_id String,
    project_id String,
    start_time Float64,
    end_time Float64,
    duration Float64,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (project_id, clip_id, scene_id);

CREATE TABLE IF NOT EXISTS marryo.video_moments
(
    moment_id String,
    scene_id String,
    clip_id String,
    project_id String,
    storage_uri String,
    start_time Float64,
    end_time Float64,
    description String,
    action String,
    emotion String,
    shot_type String,
    lighting String,
    camera_motion String,
    bride_present Bool,
    groom_present Bool,
    other_people Bool,
    visual_quality String,
    duration Float64,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (project_id, clip_id, moment_id);

CREATE TABLE IF NOT EXISTS marryo.moment_scores
(
    moment_id String,
    project_id String,
    quality_score Float64,
    score_breakdown String,
    theme String,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (project_id, moment_id);
`;

async function loadSchemaSql(): Promise<string> {
  const candidates: string[] = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, "../../clickhouse/schema.sql"));
  } catch {
    // bundled runtime may not expose a real file URL
  }
  candidates.push(
    path.resolve(process.cwd(), "clickhouse/schema.sql"),
    path.resolve(process.cwd(), "../clickhouse/schema.sql"),
    "/app/clickhouse/schema.sql",
  );

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return await readFile(candidate, "utf8");
    } catch {
      // try next
    }
  }
  return EMBEDDED_SCHEMA_SQL;
}

function splitStatements(sql: string): string[] {
  // Strip line comments first so semicolons inside comments cannot split statements.
  const withoutComments = sql
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("--")) return "";
      return line;
    })
    .join("\n");

  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fully-qualified table name using CLICKHOUSE_DATABASE (must match DDL / schema.sql). */
function chTable(name: "scenes" | "video_moments" | "moment_scores"): string {
  return `${env().CLICKHOUSE_DATABASE}.${name}`;
}

function bootstrapClient() {
  const config = env();
  const protocol = config.CLICKHOUSE_PORT === 8123 ? "http" : "https";
  // Connect to `default` so CREATE DATABASE IF NOT EXISTS <app db> can run.
  return createClient({
    url: `${protocol}://${config.CLICKHOUSE_HOST}:${config.CLICKHOUSE_PORT}`,
    database: "default",
    username: config.CLICKHOUSE_USER ?? "default",
    password: config.CLICKHOUSE_PASSWORD ?? "",
    application: "marryo-migrate",
  });
}

let schemaEnsured = false;

/** Create database + scenes / video_moments / moment_scores if missing. */
export async function ensureSchema(force = false): Promise<void> {
  requireConfigured();
  if (schemaEnsured && !force) return;
  const sql = await loadSchemaSql();
  const statements = splitStatements(sql);
  const bootstrap = bootstrapClient();
  try {
    for (const statement of statements) {
      await bootstrap.command({ query: statement });
    }
    schemaEnsured = true;
  } finally {
    await bootstrap.close();
  }
}

export interface SceneRecordInput {
  scene_id: string;
  start_time: number;
  end_time: number;
  duration: number;
}

/**
 * Replace scenes for multiple clips in a project atomically in ClickHouse.
 * Executes a single synchronous delete mutation and a single batch insert.
 */
async function deleteScenesForClips(projectId: string, clipIds: string[]): Promise<void> {
  const client = clickhouse();
  await client.command({
    query: `ALTER TABLE ${chTable("scenes")} DELETE WHERE project_id = {projectId:String} AND clip_id IN ({clipIds:Array(String)})`,
    query_params: { projectId, clipIds },
    // Wait for the mutation, but do not hang past request_timeout (120s).
    clickhouse_settings: { mutations_sync: "1" },
  });
}

export async function replaceScenesForProject(
  projectId: string,
  clipScenesList: Array<{ clip_id: string; scenes: SceneRecordInput[] }>,
): Promise<void> {
  requireConfigured();
  await ensureSchema();

  if (clipScenesList.length === 0) return;

  // Refresh after long Python gaps so we do not reuse a dead Keep-Alive socket.
  await ensureAlive();

  const clipIds = clipScenesList.map((c) => c.clip_id);

  try {
    await deleteScenesForClips(projectId, clipIds);
  } catch (error) {
    if (!isClickHouseTimeoutError(error)) throw error;
    await ensureAlive();
    await deleteScenesForClips(projectId, clipIds);
  }

  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  const allRows: Array<{
    scene_id: string;
    clip_id: string;
    project_id: string;
    start_time: number;
    end_time: number;
    duration: number;
    created_at: string;
  }> = [];

  for (const item of clipScenesList) {
    for (const s of item.scenes) {
      allRows.push({
        scene_id: s.scene_id,
        clip_id: item.clip_id,
        project_id: projectId,
        start_time: s.start_time,
        end_time: s.end_time,
        duration: s.duration,
        created_at: now,
      });
    }
  }

  if (allRows.length > 0) {
    const client = clickhouse();
    const table = chTable("scenes");
    try {
      await client.insert({
        table,
        values: allRows,
        format: "JSONEachRow",
      });
    } catch (error) {
      if (!isClickHouseTimeoutError(error)) throw error;
      await ensureAlive();
      await clickhouse().insert({
        table,
        values: allRows,
        format: "JSONEachRow",
      });
    }
  }
}

/**
 * Replace scenes for a given clip in ClickHouse.
 * Synchronously removes any existing rows for (projectId, clipId) and inserts the new ones.
 */
export async function replaceScenesForClip(
  projectId: string,
  clipId: string,
  scenes: SceneRecordInput[],
): Promise<void> {
  return replaceScenesForProject(projectId, [{ clip_id: clipId, scenes }]);
}

export interface MomentRecordInput {
  moment_id: string;
  scene_id: string;
  clip_id: string;
  storage_uri: string;
  start_time: number;
  end_time: number;
  description: string;
  action: string;
  emotion: string;
  shot_type: string;
  lighting: string;
  camera_motion: string;
  bride_present: boolean;
  groom_present: boolean;
  other_people: boolean;
  visual_quality: string;
  duration: number;
}

/** Subset of video_moments needed by the Phase 6 renderer / typography. */
export interface MomentLookupRow {
  moment_id: string;
  clip_id: string;
  storage_uri: string;
  start_time: number;
  end_time: number;
  duration: number;
  shot_type: string;
  emotion: string;
  lighting: string;
  visual_quality: string;
  bride_present: boolean;
  groom_present: boolean;
}

/**
 * Fetch video_moments rows by id for a project (used to resolve EDL clip seek times).
 * Read-only: does not run DDL (tables are created by earlier pipeline phases).
 */
export async function fetchMomentsByIds(
  projectId: string,
  momentIds: string[],
): Promise<MomentLookupRow[]> {
  requireConfigured();
  if (momentIds.length === 0) return [];

  const unique = [...new Set(momentIds)];
  const client = clickhouse();
  const result = await client.query({
    query: `
      SELECT
        moment_id,
        clip_id,
        storage_uri,
        start_time,
        end_time,
        duration,
        shot_type,
        emotion,
        lighting,
        visual_quality,
        bride_present,
        groom_present
      FROM ${chTable("video_moments")}
      WHERE project_id = {projectId:String}
        AND moment_id IN ({momentIds:Array(String)})
    `,
    query_params: { projectId, momentIds: unique },
    format: "JSONEachRow",
  });

  const rows = await result.json<MomentLookupRow>();
  return rows.map((row) => ({
    moment_id: String(row.moment_id),
    clip_id: String(row.clip_id),
    storage_uri: String(row.storage_uri),
    start_time: Number(row.start_time),
    end_time: Number(row.end_time),
    duration: Number(row.duration),
    shot_type: String(row.shot_type ?? ""),
    emotion: String(row.emotion ?? ""),
    lighting: String(row.lighting ?? ""),
    visual_quality: String(row.visual_quality ?? ""),
    bride_present: Boolean(row.bride_present),
    groom_present: Boolean(row.groom_present),
  }));
}

export interface ScoreRecordInput {
  moment_id: string;
  quality_score: number;
  score_breakdown: Record<string, number>;
  theme: string;
}

/**
 * Replace video_moments for clips in a project (batch delete + insert).
 */
export async function replaceMomentsForProject(
  projectId: string,
  clipIds: string[],
  moments: MomentRecordInput[],
): Promise<void> {
  requireConfigured();
  await ensureSchema();
  if (clipIds.length === 0 && moments.length === 0) return;

  const client = clickhouse();
  if (clipIds.length > 0) {
    await client.command({
      query: `ALTER TABLE ${chTable("video_moments")} DELETE WHERE project_id = {projectId:String} AND clip_id IN ({clipIds:Array(String)})`,
      query_params: { projectId, clipIds },
      clickhouse_settings: { mutations_sync: "1" },
    });
  }

  if (moments.length === 0) return;

  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  const rows = moments.map((m) => ({
    ...m,
    project_id: projectId,
    created_at: now,
  }));

  await client.insert({ table: chTable("video_moments"), values: rows, format: "JSONEachRow" });
}

/**
 * Replace moment_scores for a project+theme (batch delete + insert).
 */
export async function replaceScoresForProject(
  projectId: string,
  theme: string,
  scores: ScoreRecordInput[],
): Promise<void> {
  requireConfigured();
  await ensureSchema();

  const client = clickhouse();
  await client.command({
    query: `ALTER TABLE ${chTable("moment_scores")} DELETE WHERE project_id = {projectId:String} AND theme = {theme:String}`,
    query_params: { projectId, theme },
    clickhouse_settings: { mutations_sync: "1" },
  });

  if (scores.length === 0) return;

  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  const rows = scores.map((s) => ({
    moment_id: s.moment_id,
    project_id: projectId,
    quality_score: s.quality_score,
    score_breakdown: JSON.stringify(s.score_breakdown),
    theme: s.theme,
    created_at: now,
  }));

  await client.insert({ table: chTable("moment_scores"), values: rows, format: "JSONEachRow" });
}

export interface SampleAnalyticsIds {
  projectId: string;
  clipId: string;
  sceneIds: string[];
  momentIds: string[];
}

/**
 * Insert fixed sample rows for MCP / pipeline proof (not production analytics writers).
 * Idempotent enough for re-runs: uses deterministic ids derived from projectId.
 */
export async function insertSampleAnalyticsRows(
  projectId: string,
  clipId: string = "clp_mcp_sample",
): Promise<SampleAnalyticsIds> {
  requireConfigured();
  await ensureSchema();

  const sceneIds = [`scn_${projectId}_1`, `scn_${projectId}_2`];
  const momentIds = [`mom_${projectId}_1`, `mom_${projectId}_2`, `mom_${projectId}_3`];
  const storageUri = `gs://example/projects/${projectId}/raw/${clipId}.mp4`;
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");

  const client = clickhouse();

  await client.insert({
    table: chTable("scenes"),
    values: [
      {
        scene_id: sceneIds[0],
        clip_id: clipId,
        project_id: projectId,
        start_time: 0,
        end_time: 4.5,
        duration: 4.5,
        created_at: now,
      },
      {
        scene_id: sceneIds[1],
        clip_id: clipId,
        project_id: projectId,
        start_time: 4.5,
        end_time: 9.0,
        duration: 4.5,
        created_at: now,
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: chTable("video_moments"),
    values: [
      {
        moment_id: momentIds[0],
        scene_id: sceneIds[0],
        clip_id: clipId,
        project_id: projectId,
        storage_uri: storageUri,
        start_time: 0.5,
        end_time: 2.5,
        description: "Couple walking under trees",
        action: "walking",
        emotion: "joy",
        shot_type: "medium",
        lighting: "golden_hour",
        camera_motion: "slow_pan",
        bride_present: true,
        groom_present: true,
        other_people: false,
        visual_quality: "high",
        duration: 2.0,
        created_at: now,
      },
      {
        moment_id: momentIds[1],
        scene_id: sceneIds[0],
        clip_id: clipId,
        project_id: projectId,
        storage_uri: storageUri,
        start_time: 2.5,
        end_time: 4.0,
        description: "Close-up of joined hands",
        action: "holding_hands",
        emotion: "tender",
        shot_type: "close_up",
        lighting: "golden_hour",
        camera_motion: "static",
        bride_present: true,
        groom_present: true,
        other_people: false,
        visual_quality: "high",
        duration: 1.5,
        created_at: now,
      },
      {
        moment_id: momentIds[2],
        scene_id: sceneIds[1],
        clip_id: clipId,
        project_id: projectId,
        storage_uri: storageUri,
        start_time: 5.0,
        end_time: 8.0,
        description: "Wide establishing of venue",
        action: "standing",
        emotion: "calm",
        shot_type: "wide",
        lighting: "daylight",
        camera_motion: "drone_push",
        bride_present: false,
        groom_present: false,
        other_people: true,
        visual_quality: "medium",
        duration: 3.0,
        created_at: now,
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: chTable("moment_scores"),
    values: [
      {
        moment_id: momentIds[0],
        project_id: projectId,
        quality_score: 88.5,
        score_breakdown: JSON.stringify({ couple: 30, emotion: 25, shot: 18, lighting: 15.5 }),
        theme: "romantic",
        created_at: now,
      },
      {
        moment_id: momentIds[1],
        project_id: projectId,
        quality_score: 92.0,
        score_breakdown: JSON.stringify({ couple: 32, emotion: 28, shot: 20, lighting: 12 }),
        theme: "romantic",
        created_at: now,
      },
      {
        moment_id: momentIds[2],
        project_id: projectId,
        quality_score: 61.0,
        score_breakdown: JSON.stringify({ couple: 5, emotion: 10, shot: 22, lighting: 24 }),
        theme: "cinematic",
        created_at: now,
      },
    ],
    format: "JSONEachRow",
  });

  return { projectId, clipId, sceneIds, momentIds };
}

export { close as closeClickHouse };
