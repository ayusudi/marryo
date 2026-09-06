/**
 * Pipeline smoke test (Phase 1–4):
 * create → upload → validate → identify → confirm →
 * detect-scenes (Phase 4) → ClickHouse + MCP Toolbox query proof.
 *
 *   npm run sample:clips
 *   npm run db:clickhouse          # when ClickHouse is configured
 *   # optional: toolbox --config mcp/toolbox/tools.yaml --enable-api --port 5000
 *   npm run dev
 *   npm run test:pipeline
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  closeClickHouse,
  insertSampleAnalyticsRows,
} from "../services/src/clickhouse-schema.ts";
import { isConfigured as clickhouseConfigured } from "../services/src/clickhouse.ts";
import { env } from "../services/src/env.ts";
import {
  isToolboxReachable,
  queryScenesForClip,
  queryTopMoments,
} from "../services/src/mcp-toolbox.ts";
import { isConfigured as gcsConfigured } from "../services/src/storage.ts";

const BASE = process.env.WEB_URL ?? "http://localhost:3100";
const SAMPLES = path.resolve(path.dirname(new URL(import.meta.url).pathname), "sample-clips");
const E2E_SECRET = process.env.E2E_AUTH_SECRET ?? "marryo-e2e-secret";

/** Cookie jar for Auth.js E2E credentials (required for POST /api/projects). */
let authCookie = "";

async function ensureE2EAuth(): Promise<void> {
  if (authCookie) return;
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`csrf failed (${csrfRes.status}) — is the web server running with E2E_AUTH=1?`);
  }
  const csrfCookies = csrfRes.headers.getSetCookie?.() ?? [];
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const loginRes = await fetch(`${BASE}/api/auth/callback/e2e`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookies.map((c) => c.split(";")[0]).join("; "),
    },
    body: new URLSearchParams({
      csrfToken,
      secret: E2E_SECRET,
      callbackUrl: "/",
      json: "true",
    }),
    redirect: "manual",
  });
  const loginCookies = loginRes.headers.getSetCookie?.() ?? [];
  const jar = [...csrfCookies, ...loginCookies].map((c) => c.split(";")[0]!).filter(Boolean);
  authCookie = [...new Set(jar)].join("; ");
  if (!authCookie) {
    throw new Error(
      `e2e login produced no cookies (${loginRes.status}) — set E2E_AUTH=1 and E2E_AUTH_SECRET`,
    );
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await ensureE2EAuth();
  const headers = new Headers(init.headers);
  headers.set("cookie", authCookie);
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function mustOk(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function filePart(filename: string): Promise<File> {
  const full = path.join(SAMPLES, filename);
  await stat(full);
  const buffer = Buffer.from(await new Response(createReadStream(full)).arrayBuffer());
  return new File([buffer], filename, { type: "video/mp4" });
}

function asRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { rows?: unknown }).rows)) {
    return (payload as { rows: Array<Record<string, unknown>> }).rows;
  }
  throw new Error(`expected row array from MCP tool, got: ${JSON.stringify(payload)}`);
}

const created = (await mustOk(
  await apiFetch(`/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      couple_names: [
        { name: "Ada", role: "bride" },
        { name: "Alan", role: "groom" },
      ],
      mood: "warm",
      visual_tone: "cinematic",
      story: "Phase 5 pipeline test",
      max_duration: 20,
      orientation: "landscape",
    }),
  }),
  "create project",
)) as { project_id: string; orientation?: string };

const projectId = created.project_id;
console.log(`project: ${projectId} orientation=${created.orientation ?? "landscape"}`);

const form = new FormData();
for (const name of ["good-1.mp4", "good-2.mp4", "good-3.mp4", "cuts.mp4", "black.mp4"]) {
  form.append("files", await filePart(name));
}

const uploaded = (await mustOk(
  await apiFetch(`/api/projects/${projectId}/upload`, { method: "POST", body: form }),
  "upload",
)) as {
  clips: Array<{
    clip_id: string;
    filename: string;
    storage_uri: string | null;
    valid: boolean | null;
    validation_warnings: { warnings: string[]; metrics: Record<string, number> } | null;
  }>;
  errors: Array<{ filename: string; error: string }>;
};

console.log("\nupload errors:", uploaded.errors);
console.log("\nvalidation:");
for (const clip of uploaded.clips) {
  console.log(
    `  ${clip.filename.padEnd(12)} valid=${String(clip.valid).padEnd(5)} uri=${clip.storage_uri ?? "null"} warnings=${JSON.stringify(clip.validation_warnings?.warnings ?? [])}`,
  );
}

const status = (await mustOk(await apiFetch(`/api/projects/${projectId}/status`), "status")) as {
  status: string;
  current_stage: string;
};
console.log("\nstatus after upload:", status);
if (uploaded.clips.length > 0 && status.current_stage !== "validated") {
  throw new Error(`expected current_stage=validated after successful upload, got ${status.current_stage}`);
}

const project = (await mustOk(await apiFetch(`/api/projects/${projectId}`), "get project")) as {
  clips: typeof uploaded.clips;
  bride_person_id: string | null;
  groom_person_id: string | null;
};

const black = project.clips.find((c) => c.filename === "black.mp4");
if (!black) throw new Error("black.mp4 missing from project");
if (black.valid !== false) throw new Error("expected black.mp4 to be valid=false");
if (!black.validation_warnings?.warnings.includes("near_black")) {
  throw new Error(`expected near_black warning, got ${JSON.stringify(black.validation_warnings)}`);
}

const storageBackend = env().STORAGE_BACKEND.toLowerCase();
const expectGcs = storageBackend !== "local" && gcsConfigured();
if (expectGcs) {
  for (const clip of uploaded.clips) {
    if (!clip.storage_uri?.startsWith("gs://")) {
      throw new Error(`expected gs:// storage_uri when GCS configured, got ${clip.storage_uri}`);
    }
    if (!clip.storage_uri.includes(`/raw/${clip.clip_id}.`)) {
      throw new Error(`expected raw/{clip_id} object path, got ${clip.storage_uri}`);
    }
  }
  console.log("GCS storage_uri asserts ok");
} else {
  console.log(
    `skip GCS asserts (STORAGE_BACKEND=${storageBackend}, gcsConfigured=${gcsConfigured()})`,
  );
}

const identified = (await mustOk(
  await apiFetch(`/api/projects/${projectId}/identify`, { method: "POST" }),
  "identify",
)) as {
  persons: Array<{ person_id: string; clip_ids: string[]; face_count: number; thumbnail_uris: string[] }>;
  warnings: string[];
};

console.log("\nidentity clusters:");
for (const person of identified.persons) {
  console.log(
    `  ${person.person_id} faces=${person.face_count} clips=${person.clip_ids.length} thumbs=${person.thumbnail_uris.length}`,
  );
}
console.log("warnings:", identified.warnings);

if (identified.persons.length === 0) {
  console.log("no face clusters — continuing Phase 4 without identity confirm (allowed)");
} else {
  if (identified.persons.length < 2) {
    if (!identified.warnings.includes("couldnt_detect_two_distinct_people")) {
      throw new Error("expected couldnt_detect_two_distinct_people warning when <2 persons");
    }
  } else if (identified.warnings.includes("couldnt_detect_two_distinct_people")) {
    throw new Error("unexpected two-person warning when clusters >= 2");
  }

  const bride = identified.persons[0]!;
  const groom = identified.persons[1];
  const confirmBody =
    groom != null
      ? { bride_person_id: bride.person_id, groom_person_id: groom.person_id }
      : { bride_person_id: bride.person_id };

  if (bride.thumbnail_uris.length > 0) {
    const thumbRes = await fetch(
      `${BASE}/api/projects/${projectId}/persons/${bride.person_id}/thumbnails/0`,
    );
    const ctype = thumbRes.headers.get("content-type") ?? "";
    if (!thumbRes.ok || !ctype.includes("image/jpeg")) {
      throw new Error(
        `thumbnail GET failed (${thumbRes.status}, content-type=${ctype}): ${await thumbRes.text()}`,
      );
    }
    console.log("thumbnail GET ok: image/jpeg");
  }

  const confirmed = (await mustOk(
    await apiFetch(`/api/projects/${projectId}/identity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(confirmBody),
    }),
    "confirm identity",
  )) as {
    bride_person_id: string | null;
    groom_person_id: string | null;
    current_stage: string;
  };

  console.log("\nconfirmed:", confirmed);

  const after = (await mustOk(await apiFetch(`/api/projects/${projectId}`), "get project after identity")) as {
    bride_person_id: string | null;
    groom_person_id: string | null;
    current_stage: string;
  };

  if (after.bride_person_id !== bride.person_id) {
    throw new Error(`bride not stored: ${JSON.stringify(after)}`);
  }
  if (groom != null) {
    if (after.groom_person_id !== groom.person_id) {
      throw new Error(`groom not stored: ${JSON.stringify(after)}`);
    }
  } else if (after.groom_person_id !== null) {
    throw new Error(`expected groom_person_id=null for single-person confirm, got ${after.groom_person_id}`);
  }
  if (after.current_stage !== "identity") {
    throw new Error(`expected current_stage=identity, got ${after.current_stage}`);
  }

  const status2 = await mustOk(await apiFetch(`/api/projects/${projectId}/status`), "status after identity");
  console.log("status after identity:", status2);
}

// --- Phase 4: Scene Detection ---
console.log("\ndetecting scenes…");
const detectedScenes = (await mustOk(
  await apiFetch(`/api/projects/${projectId}/detect-scenes`, { method: "POST" }),
  "detect scenes",
)) as {
  project_id: string;
  clips: Array<{
    clip_id: string;
    filename: string;
    scene_count: number;
    scenes: Array<{ scene_id: string; start_time: number; end_time: number; duration: number }>;
    detector: string;
    warnings: string[];
  }>;
  total_scenes: number;
};

console.log(`detected scenes across ${detectedScenes.clips.length} clips (total=${detectedScenes.total_scenes}):`);
for (const clip of detectedScenes.clips) {
  console.log(
    `  ${clip.filename.padEnd(12)} (${clip.clip_id}) scenes=${clip.scene_count} detector=${clip.detector} bounds=${clip.scenes.map((s) => `[${s.start_time}-${s.end_time}]`).join(", ")}`,
  );
}

// Assertions on scene detection
const validUploadedClips = uploaded.clips.filter((c) => c.valid === true);
if (detectedScenes.clips.length !== validUploadedClips.length) {
  throw new Error(
    `expected scene detection for ${validUploadedClips.length} valid clips, got ${detectedScenes.clips.length}`,
  );
}

for (const clip of detectedScenes.clips) {
  if (clip.scene_count < 1) {
    throw new Error(`clip ${clip.filename} has ${clip.scene_count} scenes, expected >= 1`);
  }
}

const blackInScenes = detectedScenes.clips.find((c) => c.filename === "black.mp4");
if (blackInScenes) {
  throw new Error("black.mp4 should not be included in detect-scenes output");
}

const cutsClip = detectedScenes.clips.find((c) => c.filename === "cuts.mp4");
if (!cutsClip) {
  throw new Error("cuts.mp4 missing from detect-scenes output");
}
if (cutsClip.scene_count < 2) {
  throw new Error(`expected cuts.mp4 to have >= 2 scenes, got ${cutsClip.scene_count}`);
}
const firstSceneEnd = cutsClip.scenes[0]!.end_time;
if (Math.abs(firstSceneEnd - 2.0) > 0.5) {
  throw new Error(`expected cuts.mp4 first cut near 2.0s (+-0.5s), got ${firstSceneEnd}`);
}
console.log(`cuts.mp4 boundary check passed (first cut at ${firstSceneEnd}s)`);

const statusAfterScenes = (await mustOk(
  await apiFetch(`/api/projects/${projectId}/status`),
  "status after detect-scenes",
)) as { status: string; current_stage: string };
console.log("status after detect-scenes:", statusAfterScenes);
if (statusAfterScenes.current_stage !== "analysing" || statusAfterScenes.status !== "analysing") {
  throw new Error(
    `expected status/current_stage=analysing, got status=${statusAfterScenes.status}, stage=${statusAfterScenes.current_stage}`,
  );
}

// --- ClickHouse + MCP Toolbox verification ---
if (!clickhouseConfigured()) {
  console.log("\nskip ClickHouse/MCP (not configured: ClickHouse credentials missing)");
} else {
  console.log("\nverifying ClickHouse scenes & sample moments…");
  const toolboxUp = await isToolboxReachable();

  if (toolboxUp) {
    // 1. Verify real detected scenes for cuts.mp4 via MCP Toolbox
    const mcpCutsScenes = asRows(await queryScenesForClip(cutsClip.clip_id));
    console.log(`\nMCP query_scenes_for_clip (${cutsClip.clip_id}):`);
    for (const row of mcpCutsScenes) {
      console.log(`  scene=${row.scene_id} ${row.start_time}-${row.end_time}`);
    }
    if (mcpCutsScenes.length !== cutsClip.scene_count) {
      throw new Error(
        `MCP query_scenes_for_clip returned ${mcpCutsScenes.length} rows, expected ${cutsClip.scene_count}`,
      );
    }
    console.log("MCP query_scenes_for_clip on real detected clip ok");
  } else {
    console.log(
      `skip MCP proof (Toolbox not reachable at ${env().MCP_TOOLBOX_URL}). ` +
        "Start: toolbox --config mcp/toolbox/tools.yaml --enable-api --port 5000 — see mcp/toolbox/README.md",
    );
  }

  // 2. Insert synthetic moments on clp_mcp_sample for MCP top_moments proof
  let sample: Awaited<ReturnType<typeof insertSampleAnalyticsRows>> | undefined;
  try {
    sample = await insertSampleAnalyticsRows(projectId, "clp_mcp_sample");
    console.log("sample moments inserted on clp_mcp_sample:", sample.momentIds);
  } catch (error) {
    console.log(
      `skip ClickHouse sample moments: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (sample && toolboxUp) {
    const top = asRows(
      await queryTopMoments({
        project_id: projectId,
        emotion: "%",
        shot_type: "%",
        lighting: "%",
        limit: 10,
      }),
    );
    console.log("\nMCP query_top_moments:");
    for (const row of top) {
      console.log(`  score=${row.quality_score} moment=${row.moment_id} emotion=${row.emotion}`);
    }
    if (top.length === 0) {
      throw new Error("query_top_moments returned no rows");
    }
    for (let i = 1; i < top.length; i++) {
      const prev = Number(top[i - 1]!.quality_score);
      const cur = Number(top[i]!.quality_score);
      if (prev < cur) {
        throw new Error(`query_top_moments not ordered by quality_score DESC: ${prev} then ${cur}`);
      }
    }
    console.log("MCP Toolbox proof ok");
  }

  await closeClickHouse();
}

// --- Phase 5: Film Director ---
const useRealGemini = process.env.PIPELINE_USE_GEMINI === "1";
if (!useRealGemini) {
  process.env.MOCK_GEMINI = "1";
}
console.log(`\nrunning Film Director (${useRealGemini ? "Gemini" : "MOCK_GEMINI"})…`);
  const directed = (await mustOk(
    await apiFetch(`/api/projects/${projectId}/direct`, { method: "POST" }),
    "direct",
  )) as {
    project_id: string;
    valid: boolean;
    issues: string[];
    moments_analyzed: number;
    moments_scored: number;
    theme: string;
    edit_id: string;
    edl: { target_duration: number; scenes: Array<{ name: string; clips?: unknown[] }> };
    top_moments: Array<{ moment_id: string; quality_score: number; score_breakdown?: Record<string, number> }>;
    failed_scenes: Array<{ scene_id: string; reason: string }>;
  };

  console.log(`\nFilm Director: analyzed=${directed.moments_analyzed} scored=${directed.moments_scored} theme=${directed.theme}`);
  console.log(`EDL valid=${directed.valid} edit_id=${directed.edit_id} scenes=${directed.edl.scenes.length}`);
  for (const scene of directed.edl.scenes) {
    console.log(`  ${scene.name}: ${scene.clips?.length ?? 0} clip(s)`);
  }
  if (directed.failed_scenes.length > 0) {
    console.log("failed scenes:", directed.failed_scenes);
  }
  console.log("\ntop moments:");
  for (const m of directed.top_moments.slice(0, 3)) {
    console.log(`  score=${m.quality_score} moment=${m.moment_id} breakdown=${JSON.stringify(m.score_breakdown ?? {})}`);
  }

  if (directed.moments_analyzed < 1) {
    throw new Error("expected at least 1 analyzed moment");
  }
  if (directed.moments_scored < 1) {
    throw new Error("expected at least 1 scored moment");
  }
  if (!directed.valid) {
    console.log("EDL validation issues (soft):", directed.issues);
  }

  const statusAfterDirect = (await mustOk(
    await apiFetch(`/api/projects/${projectId}/status`),
    "status after direct",
  )) as { status: string; current_stage: string };
  console.log("status after direct:", statusAfterDirect);
  if (directed.valid && statusAfterDirect.current_stage !== "directing") {
    throw new Error(
      `expected current_stage=directing after valid EDL, got ${statusAfterDirect.current_stage}`,
    );
  }

  console.log("\nPhase 5 pipeline test passed.");

  // --- Phase 6: Render ---
  if (!directed.valid) {
    console.log("\nskipping Phase 6 render (EDL not valid)");
  } else {
    console.log("\nrunning render…");
    const rendered = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/render`, { method: "POST" }),
      "render",
    )) as {
      render_id: string;
      project_id: string;
      edit_id: string;
      storage_uri: string | null;
      duration: number | null;
      width: number | null;
      height: number | null;
      orientation: string;
      status: string;
      evaluation: {
        passed: boolean;
        checks: Array<{ name: string; passed: boolean; detail: string }>;
        metrics: Record<string, unknown>;
      } | null;
      playback_url?: string;
      error_text: string | null;
    };

    console.log(
      `\nRender: id=${rendered.render_id} status=${rendered.status} orientation=${rendered.orientation} duration=${rendered.duration} ${rendered.width}x${rendered.height}`,
    );
    console.log(`storage_uri=${rendered.storage_uri}`);
    if (rendered.evaluation) {
      console.log(`evaluation.passed=${rendered.evaluation.passed}`);
      for (const check of rendered.evaluation.checks) {
        console.log(`  [${check.passed ? "ok" : "FAIL"}] ${check.name}: ${check.detail}`);
      }
    }
    if (rendered.error_text) {
      console.log("error_text:", rendered.error_text);
    }

    if (!rendered.evaluation?.passed) {
      throw new Error("expected evaluation.passed=true");
    }
    if (rendered.status !== "ready") {
      throw new Error(`expected render status=ready, got ${rendered.status}`);
    }
    if (!rendered.storage_uri) {
      throw new Error("expected storage_uri on render");
    }
    if (rendered.orientation !== "landscape" || rendered.width !== 1920 || rendered.height !== 1080) {
      throw new Error(
        `expected landscape 1920x1080, got ${rendered.orientation} ${rendered.width}x${rendered.height}`,
      );
    }
    if (expectGcs) {
      if (!rendered.storage_uri.startsWith("gs://")) {
        throw new Error(`expected gs:// render URI, got ${rendered.storage_uri}`);
      }
      if (!rendered.storage_uri.includes(`/renders/${rendered.render_id}.mp4`)) {
        throw new Error(`expected renders/{render_id}.mp4 path, got ${rendered.storage_uri}`);
      }
      console.log("GCS render URI asserts ok");
    }

    const statusAfterRender = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/status`),
      "status after render",
    )) as { status: string; current_stage: string };
    console.log("status after render:", statusAfterRender);
    if (statusAfterRender.status !== "ready" || statusAfterRender.current_stage !== "soundtrack") {
      throw new Error(
        `expected status=ready current_stage=soundtrack, got ${JSON.stringify(statusAfterRender)}`,
      );
    }

    console.log("\ngenerating soundtrack versions…");
    const soundtrack = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/soundtrack`, { method: "POST" }),
      "soundtrack",
    )) as {
      session_id: string;
      status: string;
      versions: Array<{ version_id: string; status: string; playback_url?: string; rank: number }>;
    };
    console.log(
      `Soundtrack: session=${soundtrack.session_id} status=${soundtrack.status} versions=${soundtrack.versions.length}`,
    );
    const readyVersions = soundtrack.versions.filter((v) => v.status === "ready");
    if (soundtrack.status !== "ready" || readyVersions.length < 1) {
      throw new Error(`expected ready soundtrack versions, got ${JSON.stringify(soundtrack)}`);
    }
    const pick = readyVersions[0]!;
    const selected = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/soundtrack/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "catalog", version_id: pick.version_id }),
      }),
      "soundtrack select",
    )) as { selected_version_id: string | null; selected_mode: string | null };
    if (selected.selected_version_id !== pick.version_id || selected.selected_mode !== "catalog") {
      throw new Error(`select mismatch: ${JSON.stringify(selected)}`);
    }
    const statusAfterMusic = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/status`),
      "status after soundtrack",
    )) as { status: string; current_stage: string };
    if (statusAfterMusic.status !== "ready" || statusAfterMusic.current_stage !== "complete") {
      throw new Error(
        `expected status=ready current_stage=complete after select, got ${JSON.stringify(statusAfterMusic)}`,
      );
    }

    const latest = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/render`),
      "get latest render",
    )) as { render_id: string };
    if (latest.render_id !== rendered.render_id) {
      throw new Error(`GET /render mismatch: ${latest.render_id} vs ${rendered.render_id}`);
    }

    console.log("\nre-rendering as portrait…");
    const portrait = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orientation: "portrait" }),
      }),
      "render portrait",
    )) as {
      render_id: string;
      orientation: string;
      width: number | null;
      height: number | null;
      status: string;
      evaluation: { passed: boolean } | null;
    };
    console.log(
      `Portrait render: id=${portrait.render_id} ${portrait.width}x${portrait.height} status=${portrait.status}`,
    );
    if (!portrait.evaluation?.passed) {
      throw new Error("expected portrait evaluation.passed=true");
    }
    if (portrait.orientation !== "portrait" || portrait.width !== 1080 || portrait.height !== 1920) {
      throw new Error(
        `expected portrait 1080x1920, got ${portrait.orientation} ${portrait.width}x${portrait.height}`,
      );
    }
    if (portrait.render_id === rendered.render_id) {
      throw new Error("portrait render should create a new render_id");
    }

    const latestAfterPortrait = (await mustOk(
      await apiFetch(`/api/projects/${projectId}/render`),
      "get latest render after portrait",
    )) as {
      render_id: string;
      orientation: string;
      typography: {
        title?: { font_family_id?: string; position_id?: string };
        ending?: { font_family_id?: string; position_id?: string };
      } | null;
    };
    if (!latestAfterPortrait.typography?.title?.font_family_id) {
      throw new Error("expected typography.title.font_family_id on render");
    }
    const catalog = new Set(["serif_editorial", "sans_clean", "script_soft", "display_bold"]);
    if (!catalog.has(latestAfterPortrait.typography.title.font_family_id)) {
      throw new Error(
        `unexpected font_family_id: ${latestAfterPortrait.typography.title.font_family_id}`,
      );
    }
    if (latestAfterPortrait.orientation === "portrait") {
      const pos = latestAfterPortrait.typography.title.position_id;
      if (pos === "lower_third") {
        throw new Error("portrait render should not use lower_third title layout");
      }
    }
    console.log(
      `typography: title=${latestAfterPortrait.typography.title.font_family_id}/${latestAfterPortrait.typography.title.position_id}`,
    );

    console.log("\nPhase 6 pipeline test passed.");
  }
