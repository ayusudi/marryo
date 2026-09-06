/**
 * Scene detection bridge: spawn Python CV, persist scenes to ClickHouse, update stage.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { z } from "zod";

import {
  ClickHouseNotConfiguredError,
  replaceScenesForProject,
  type SceneRecordInput,
} from "./clickhouse-schema.ts";
import { prisma } from "./db.ts";
import { env } from "./env.ts";
import { setProjectStatus } from "./projects.ts";
import { materializeCachedClip } from "./clip-cache.ts";
import { StorageNotConfiguredError, storageService } from "./storage-service.ts";

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

function pythonBin(): string {
  const configured = env().PYTHON_BIN;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

const sceneSpanSchema = z.object({
  start_time: z.number(),
  end_time: z.number(),
  duration: z.number(),
});

const clipScenesResultSchema = z.object({
  clip_id: z.string(),
  scenes: z.array(sceneSpanSchema),
  detector: z.string(),
  warnings: z.array(z.string()).default([]),
});

const scenesCliSchema = z.object({
  clips: z.array(clipScenesResultSchema),
  error: z.string().optional(),
});

export class ScenesError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "ScenesError";
    this.status = status;
  }
}

export interface ApiScene {
  scene_id: string;
  start_time: number;
  end_time: number;
  duration: number;
}

export interface ApiClipScenes {
  clip_id: string;
  filename: string;
  scene_count: number;
  scenes: ApiScene[];
  detector: string;
  warnings: string[];
}

export interface DetectScenesResult {
  project_id: string;
  clips: ApiClipScenes[];
  total_scenes: number;
}

async function runScenesCli(manifestPath: string): Promise<z.infer<typeof scenesCliSchema>> {
  const python = pythonBin();
  const args = ["-m", "cv.scenes_cli", "--manifest", manifestPath];

  const { stdout, stderr, code } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: path.join(repoRoot(), "agent"),
      env: { ...process.env, PYTHONPATH: path.join(repoRoot(), "agent") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ stdout: out, stderr: err, code: exitCode }));
  });

  if (code !== 0) {
    throw new ScenesError(
      `scene detection failed (exit ${code}): ${stderr.trim() || stdout.trim() || "no output"}`,
      500,
    );
  }

  return scenesCliSchema.parse(JSON.parse(stdout));
}

/**
 * Detect shot/scene boundaries across all valid clips in a project,
 * persist to ClickHouse `scenes` table, advance project stage to `analysing`.
 */
export async function detectScenesForProject(projectId: string): Promise<DetectScenesResult> {
  const project = await prisma().project.findUnique({
    where: { projectId },
    include: { clips: true },
  });
  if (!project) {
    throw new ScenesError("project not found", 404);
  }

  const validClips = project.clips.filter((c) => c.valid === true && c.storageUri);
  if (validClips.length === 0) {
    throw new ScenesError("no valid clips to detect scenes — upload and validate footage first", 400);
  }

  let storage;
  try {
    storage = storageService();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      throw new ScenesError(error.message, 503);
    }
    throw error;
  }

  await setProjectStatus(projectId, "analysing", "analysing");

  const workDir = await mkdtemp(path.join(tmpdir(), "marryo-scenes-"));
  const manifestPath = path.join(workDir, "manifest.json");

  try {
    const clipsToProcess = await Promise.all(
      validClips.map(async (c) => ({
        clip_id: c.clipId,
        path: await materializeCachedClip(storage, projectId, c.storageUri!, c.clipId),
        duration: c.duration ?? undefined,
      })),
    );

    await writeFile(manifestPath, JSON.stringify({ clips: clipsToProcess }), "utf8");
    const result = await runScenesCli(manifestPath);

    const filenameMap = new Map(validClips.map((c) => [c.clipId, c.filename]));
    const clipScenesList: ApiClipScenes[] = [];
    const chBatchList: Array<{ clip_id: string; scenes: SceneRecordInput[] }> = [];
    let totalScenes = 0;

    for (const clipRes of result.clips) {
      const clipId = clipRes.clip_id;
      const filename = filenameMap.get(clipId) || "clip.mp4";

      const formattedScenes: ApiScene[] = clipRes.scenes.map((s, idx) => ({
        scene_id: `scn_${clipId}_${idx}`,
        start_time: s.start_time,
        end_time: s.end_time,
        duration: s.duration,
      }));

      const chRows: SceneRecordInput[] = formattedScenes.map((s) => ({
        scene_id: s.scene_id,
        start_time: s.start_time,
        end_time: s.end_time,
        duration: s.duration,
      }));

      chBatchList.push({ clip_id: clipId, scenes: chRows });

      clipScenesList.push({
        clip_id: clipId,
        filename,
        scene_count: formattedScenes.length,
        scenes: formattedScenes,
        detector: clipRes.detector,
        warnings: clipRes.warnings,
      });

      totalScenes += formattedScenes.length;
    }

    try {
      // ensureAlive + timeout retry live inside replaceScenesForProject (after Python idle).
      await replaceScenesForProject(projectId, chBatchList);
    } catch (error) {
      if (error instanceof ClickHouseNotConfiguredError) {
        throw new ScenesError(error.message, 503);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout/i.test(message)) {
        throw new ScenesError(
          `ClickHouse timed out while saving scenes — retry Direct. (${message})`,
          504,
        );
      }
      throw error;
    }

    return {
      project_id: projectId,
      clips: clipScenesList,
      total_scenes: totalScenes,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
