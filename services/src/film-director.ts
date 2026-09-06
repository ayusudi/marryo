/**
 * Film Director bridge: spawn Python orchestrator, persist EDL, update project stage.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { z } from "zod";

import { prisma } from "./db.ts";
import { env } from "./env.ts";
import { getProject, setProjectStatus } from "./projects.ts";

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

function pythonBin(): string {
  const configured = env().PYTHON_BIN;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

const directorResultSchema = z.object({
  project_id: z.string(),
  edl: z.object({
    project_id: z.string(),
    target_duration: z.number(),
    scenes: z.array(
      z.object({
        name: z.string(),
        clips: z
          .array(z.object({ moment_id: z.string(), start: z.number(), end: z.number() }))
          .optional()
          .default([]),
        text: z.string().nullable().optional(),
        duration: z.number().nullable().optional(),
      }),
    ),
  }),
  valid: z.boolean(),
  issues: z.array(z.string()).default([]),
  failed_scenes: z
    .array(z.object({ scene_id: z.string(), clip_id: z.string(), reason: z.string() }))
    .default([]),
  moments_analyzed: z.number().default(0),
  moments_scored: z.number().default(0),
  theme: z.string().default("romantic"),
  top_moments: z.array(z.record(z.string(), z.unknown())).default([]),
  error: z.string().optional(),
});

export class DirectorError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "DirectorError";
    this.status = status;
  }
}

function pythonSpawnEnv(projectId?: string): NodeJS.ProcessEnv {
  const root = repoRoot();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: path.join(root, "agent"),
    MOCK_GEMINI:
      process.env.MOCK_GEMINI ??
      (process.env.PIPELINE_USE_GEMINI === "1" ? "0" : "1"),
    MARRYO_CLIP_CACHE_ROOT: path.join(root, "tmp", "marryo-cache"),
  };
  if (projectId) {
    env.MARRYO_PROJECT_ID = projectId;
  }
  const creds = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (creds && !path.isAbsolute(creds)) {
    env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(root, creds);
  }
  return env;
}

async function runDirectorCli(
  manifestPath: string,
  projectId: string,
): Promise<z.infer<typeof directorResultSchema>> {
  const python = pythonBin();
  const args = ["-m", "marryo_agent.orchestrator_cli", "--manifest", manifestPath];

  const { stdout, stderr, code } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: path.join(repoRoot(), "agent"),
      env: pythonSpawnEnv(projectId),
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
    throw new DirectorError(
      `film director failed (exit ${code}): ${stderr.trim() || stdout.trim() || "no output"}`,
      500,
    );
  }

  const parsed = JSON.parse(stdout) as unknown;
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    throw new DirectorError(String((parsed as { error: string }).error), 500);
  }
  return directorResultSchema.parse(parsed);
}

async function setStageMessage(projectId: string, message: string): Promise<void> {
  await prisma().project.update({
    where: { projectId },
    data: { stageMessage: message },
  });
}

export async function runFilmDirector(projectId: string): Promise<{
  project_id: string;
  edl: z.infer<typeof directorResultSchema>["edl"];
  valid: boolean;
  issues: string[];
  failed_scenes: Array<{ scene_id: string; clip_id: string; reason: string }>;
  moments_analyzed: number;
  moments_scored: number;
  theme: string;
  top_moments: Array<Record<string, unknown>>;
  edit_id: string;
}> {
  const project = await getProject(projectId);
  if (!project) {
    throw new DirectorError("project not found", 404);
  }

  const validClips = project.clips.filter((c) => c.valid === true && c.storage_uri);
  if (validClips.length === 0) {
    throw new DirectorError("no valid clips to direct — upload and detect scenes first", 400);
  }

  const clipPersons = await prisma().clipPerson.findMany({
    where: { clipId: { in: validClips.map((c) => c.clip_id) } },
    select: { clipId: true, personId: true },
  });

  await setProjectStatus(projectId, "directing", "directing");
  await setStageMessage(projectId, "Analyzing your clips");

  const workDir = await mkdtemp(path.join(tmpdir(), "marryo-director-"));
  const manifestPath = path.join(workDir, "manifest.json");

  try {
    const manifest = {
      project: {
        project_id: project.project_id,
        couple_names: project.couple_names,
        wedding_date: project.wedding_date,
        story: project.story,
        max_duration: project.max_duration,
        mood: project.mood,
        visual_tone: project.visual_tone,
        ending_message: project.ending_message,
        bride_person_id: project.bride_person_id,
        groom_person_id: project.groom_person_id,
      },
      clips: validClips.map((c) => ({
        clip_id: c.clip_id,
        storage_uri: c.storage_uri,
        valid: c.valid,
        duration: c.duration,
      })),
      clip_persons: clipPersons.map((cp) => ({
        clip_id: cp.clipId,
        person_id: cp.personId,
      })),
    };

    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await setStageMessage(projectId, "Scoring your best moments");

    const result = await runDirectorCli(manifestPath, projectId);

    await setStageMessage(projectId, "Checking film duration");

    const editId = newId("edl");
    await prisma().editDecision.create({
      data: {
        editId,
        projectId,
        version: 1,
        targetDuration: Math.round(result.edl.target_duration),
        edlJson: JSON.stringify(result.edl),
        valid: result.valid,
        issues: result.issues.length > 0 ? JSON.stringify(result.issues) : null,
      },
    });

    if (result.valid) {
      // Stay on directing until Phase 6 /render produces the MP4 (then ready/complete).
      await setProjectStatus(projectId, "directing", "directing");
      await setStageMessage(projectId, "Film plan ready — render next");
    } else {
      await setProjectStatus(projectId, "failed", "directing");
      await setStageMessage(projectId, `Validation failed: ${result.issues.join("; ")}`);
    }

    // Mark clips as analysed
    for (const clip of validClips) {
      await prisma().clip.update({
        where: { clipId: clip.clip_id },
        data: { status: "analysed" },
      });
    }

    return {
      project_id: projectId,
      edl: result.edl,
      valid: result.valid,
      issues: result.issues,
      failed_scenes: result.failed_scenes,
      moments_analyzed: result.moments_analyzed,
      moments_scored: result.moments_scored,
      theme: result.theme,
      top_moments: result.top_moments,
      edit_id: editId,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
