/**
 * Option B soundtrack: score top-5 catalog tracks, remux each onto the
 * picture-locked render so the user can compare five full video versions.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { fetchMomentsByIds } from "./clickhouse-schema.ts";
import { prisma } from "./db.ts";
import { env } from "./env.ts";
import { upsertProjectFilm } from "./films.ts";
import { getProject, setProjectStatus } from "./projects.ts";
import { soundtrackVersionPath } from "./storage.ts";
import { StorageNotConfiguredError, storageService } from "./storage-service.ts";
import { ffprobe } from "./tech-validation.ts";

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

function pythonBin(): string {
  const configured = env().PYTHON_BIN;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

function ffmpegBin(): string {
  return env().FFMPEG_BIN || "ffmpeg";
}

function musicDir(): string {
  return path.join(repoRoot(), "agent", "assets", "music");
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export class SoundtrackError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "SoundtrackError";
    this.status = status;
  }
}

const recommendationSchema = z.object({
  track_id: z.string(),
  title: z.string(),
  artist: z.string().nullable().optional(),
  file: z.string(),
  score: z.number(),
  moods: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  breakdown: z.record(z.string(), z.number()).optional(),
});

type Recommendation = z.infer<typeof recommendationSchema>;

export type ApiSoundtrackVersion = {
  version_id: string;
  rank: number;
  track_id: string;
  title: string;
  artist: string | null;
  score: number | null;
  tags: string[];
  status: string;
  storage_uri: string | null;
  playback_url?: string;
  error_text: string | null;
};

export type ApiSoundtrackSession = {
  session_id: string;
  project_id: string;
  picture_render_id: string;
  status: string;
  selected_version_id: string | null;
  selected_mode: string | null;
  recommendations: Recommendation[];
  versions: ApiSoundtrackVersion[];
  modes: Array<{ mode: "mute" | "original"; label: string; available: boolean }>;
  error_text: string | null;
  created_at: string;
};

async function runCommand(bin: string, args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(new SoundtrackError(`${label} failed to start: ${error.message}`, 500));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new SoundtrackError(
            `${label} exited ${code}: ${stderr.slice(-800) || "no stderr"}`,
            500,
          ),
        );
      }
    });
  });
}

async function setStageMessage(projectId: string, message: string): Promise<void> {
  await prisma().project.update({
    where: { projectId },
    data: { stageMessage: message },
  });
}

async function recommendTopTracks(input: {
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  projectId: string;
  workDir: string;
  topN: number;
}): Promise<{ recommendations: Recommendation[]; raw: Record<string, unknown> }> {
  const edit = await prisma().editDecision.findFirst({
    where: { projectId: input.projectId, valid: true },
    orderBy: { createdAt: "desc" },
  });

  let moments: unknown[] = [];
  let targetDuration: number | undefined = input.project.max_duration;
  if (edit) {
    try {
      const edl = JSON.parse(edit.edlJson) as {
        target_duration?: number;
        scenes?: Array<{ clips?: Array<{ moment_id: string }> }>;
      };
      targetDuration = edl.target_duration ?? targetDuration;
      const momentIds = (edl.scenes ?? []).flatMap((s) =>
        (s.clips ?? []).map((c) => c.moment_id),
      );
      if (momentIds.length > 0) {
        moments = await fetchMomentsByIds(input.projectId, momentIds);
      }
    } catch {
      moments = [];
    }
  }

  const manifestPath = path.join(input.workDir, "music-manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      project: {
        mood: input.project.mood,
        visual_tone: input.project.visual_tone,
        max_duration: input.project.max_duration,
      },
      target_duration: targetDuration,
      moments,
    }),
    "utf8",
  );

  const rawOut = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      pythonBin(),
      ["-m", "marryo_agent.music_cli", "--manifest", manifestPath, "--top-n", String(input.topN)],
      {
        cwd: path.join(repoRoot(), "agent"),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`music_cli exited ${code}: ${stderr.slice(-500) || stdout.slice(-500)}`));
    });
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawOut) as Record<string, unknown>;
  } catch {
    throw new SoundtrackError(`music_cli returned invalid JSON: ${rawOut.slice(0, 200)}`, 500);
  }
  if (parsed.error) {
    throw new SoundtrackError(String(parsed.error), 500);
  }

  const list = z.array(recommendationSchema).parse(parsed.recommendations ?? []);
  if (list.length === 0) {
    throw new SoundtrackError("no soundtrack recommendations produced", 500);
  }
  return { recommendations: list, raw: parsed };
}

async function remuxTrackOntoPicture(input: {
  picturePath: string;
  musicPath: string;
  outPath: string;
  durationSec: number;
}): Promise<void> {
  const dur = Math.max(0.5, input.durationSec);
  const fadeIn = Math.min(1.5, dur / 4);
  const fadeOut = Math.min(2.5, dur / 3);
  const fadeOutStart = Math.max(0, dur - fadeOut);

  await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-i",
      input.picturePath,
      "-stream_loop",
      "-1",
      "-i",
      input.musicPath,
      "-filter_complex",
      `[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,afade=t=in:st=0:d=${fadeIn.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOut.toFixed(2)}[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-t",
      dur.toFixed(3),
      "-movflags",
      "+faststart",
      input.outPath,
    ],
    "soundtrack remux",
  );
}

/**
 * Build original clip audio along the EDL timeline and mux onto the silent picture
 * with `-c:v copy` (no full re-render).
 */
async function remuxOriginalAudioOntoPicture(input: {
  projectId: string;
  picturePath: string;
  outPath: string;
  workDir: string;
  durationSec: number;
}): Promise<void> {
  const edit = await prisma().editDecision.findFirst({
    where: { projectId: input.projectId, valid: true },
    orderBy: { createdAt: "desc" },
  });
  if (!edit) {
    throw new SoundtrackError("no valid EditDecision for original sound", 409);
  }

  let edl: {
    scenes: Array<{
      type?: string;
      clips?: Array<{ moment_id: string; start: number; end: number }>;
      duration?: number;
    }>;
  };
  try {
    edl = JSON.parse(edit.edlJson) as typeof edl;
  } catch {
    throw new SoundtrackError("corrupt EDL for original sound", 500);
  }

  const momentIds = edl.scenes.flatMap((s) => (s.clips ?? []).map((c) => c.moment_id));
  const moments = momentIds.length
    ? await fetchMomentsByIds(input.projectId, momentIds)
    : [];
  const momentMap = new Map(moments.map((m) => [m.moment_id, m]));
  const storage = storageService();
  const { materializeCachedClip } = await import("./clip-cache.ts");

  const audioParts: string[] = [];
  let partIndex = 0;
  for (const scene of edl.scenes) {
    const clips = scene.clips ?? [];
    if (clips.length === 0) {
      const dur = Math.max(0.1, Number(scene.duration) || 2);
      const silent = path.join(input.workDir, `silent_${partIndex++}.aac`);
      await runCommand(
        ffmpegBin(),
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-t",
          String(dur),
          "-c:a",
          "aac",
          silent,
        ],
        "silent audio pad",
      );
      audioParts.push(silent);
      continue;
    }
    for (const clip of clips) {
      const moment = momentMap.get(clip.moment_id);
      if (!moment) continue;
      const local = await materializeCachedClip(
        storage,
        input.projectId,
        moment.storage_uri,
        moment.clip_id,
      );
      const dur = Math.max(0.1, clip.end - clip.start);
      const start = moment.start_time + clip.start;
      const part = path.join(input.workDir, `aud_${partIndex++}.aac`);
      try {
        await runCommand(
          ffmpegBin(),
          [
            "-y",
            "-ss",
            String(Math.max(0, start)),
            "-i",
            local,
            "-t",
            String(dur),
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            part,
          ],
          "extract source audio",
        );
        audioParts.push(part);
      } catch {
        const silent = path.join(input.workDir, `silent_${partIndex}.aac`);
        await runCommand(
          ffmpegBin(),
          [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-t",
            String(dur),
            "-c:a",
            "aac",
            silent,
          ],
          "silent audio fallback",
        );
        audioParts.push(silent);
      }
    }
  }

  if (audioParts.length === 0) {
    throw new SoundtrackError("no audio segments for original sound", 500);
  }

  const listPath = path.join(input.workDir, "audio.txt");
  await writeFile(
    listPath,
    audioParts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  const concatAudio = path.join(input.workDir, "original-audio.aac");
  await runCommand(
    ffmpegBin(),
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatAudio],
    "concat source audio",
  );

  await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-i",
      input.picturePath,
      "-i",
      concatAudio,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      input.outPath,
    ],
    "mux original audio onto picture",
  );
}

async function toApiSession(
  sessionId: string,
  playback = true,
): Promise<ApiSoundtrackSession | null> {
  const session = await prisma().soundtrackSession.findUnique({
    where: { sessionId },
    include: { versions: { orderBy: { rank: "asc" } } },
  });
  if (!session) return null;

  let recommendations: Recommendation[] = [];
  try {
    const raw = JSON.parse(session.recommendationsJson) as { recommendations?: unknown };
    recommendations = z.array(recommendationSchema).parse(raw.recommendations ?? raw);
  } catch {
    recommendations = [];
  }

  const storage = storageService();
  const versions: ApiSoundtrackVersion[] = [];
  for (const v of session.versions) {
    let tags: string[] = [];
    if (v.tagsJson) {
      try {
        tags = JSON.parse(v.tagsJson) as string[];
      } catch {
        tags = [];
      }
    }
    let playbackUrl: string | undefined;
    if (playback && v.storageUri && v.status === "ready") {
      try {
        playbackUrl = await storage.getSignedUrl(v.storageUri);
      } catch {
        playbackUrl = undefined;
      }
    }
    versions.push({
      version_id: v.versionId,
      rank: v.rank,
      track_id: v.trackId,
      title: v.title,
      artist: v.artist,
      score: v.score,
      tags,
      status: v.status,
      storage_uri: v.storageUri,
      playback_url: playbackUrl,
      error_text: v.errorText,
    });
  }

  return {
    session_id: session.sessionId,
    project_id: session.projectId,
    picture_render_id: session.pictureRenderId,
    status: session.status,
    selected_version_id: session.selectedVersionId,
    selected_mode: session.selectedMode,
    recommendations,
    versions,
    modes: [
      { mode: "mute", label: "Mute (no music)", available: true },
      { mode: "original", label: "Original sound", available: true },
    ],
    error_text: session.errorText,
    created_at: session.createdAt.toISOString(),
  };
}

export type GenerateSoundtrackOptions = {
  /** Force a new session even if one exists for this picture render. */
  force?: boolean;
  topN?: number;
};

/**
 * Score top-N tracks and remux each onto the latest ready picture render.
 */
export async function generateSoundtrackVersions(
  projectId: string,
  opts: GenerateSoundtrackOptions = {},
): Promise<ApiSoundtrackSession> {
  const project = await getProject(projectId);
  if (!project) {
    throw new SoundtrackError("project not found", 404);
  }

  const picture = await prisma().render.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { createdAt: "desc" },
  });
  if (!picture?.storageUri) {
    throw new SoundtrackError("no ready picture render — run POST /render first", 409);
  }

  if (!opts.force) {
    const existing = await prisma().soundtrackSession.findFirst({
      where: {
        projectId,
        pictureRenderId: picture.renderId,
        status: "ready",
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const api = await toApiSession(existing.sessionId);
      if (api) return api;
    }
  }

  let storage;
  try {
    storage = storageService();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      throw new SoundtrackError(error.message, 503);
    }
    throw error;
  }

  const topN = opts.topN ?? 5;
  const sessionId = newId("sts");
  await prisma().soundtrackSession.create({
    data: {
      sessionId,
      projectId,
      pictureRenderId: picture.renderId,
      recommendationsJson: JSON.stringify({ recommendations: [] }),
      status: "generating",
    },
  });

  await setProjectStatus(projectId, "ready", "soundtrack");
  await setStageMessage(projectId, "Creating soundtrack versions…");

  const workDir = await mkdtemp(path.join(tmpdir(), "marryo-soundtrack-"));

  try {
    const { recommendations, raw } = await recommendTopTracks({
      project,
      projectId,
      workDir,
      topN,
    });

    await prisma().soundtrackSession.update({
      where: { sessionId },
      data: { recommendationsJson: JSON.stringify(raw) },
    });

    const pictureLocal = await storage.materializeLocal(picture.storageUri, workDir);
    const probe = await ffprobe(pictureLocal);
    const durationSec = probe.duration || picture.duration || 60;

    await Promise.all(
      recommendations.map(async (rec, i) => {
        const versionId = newId("stv");
        const rank = i + 1;
        const musicPath = path.join(musicDir(), rec.file);

        try {
          await access(musicPath);
        } catch {
          await prisma().soundtrackVersion.create({
            data: {
              versionId,
              sessionId,
              rank,
              trackId: rec.track_id,
              title: rec.title,
              artist: rec.artist ?? null,
              score: rec.score,
              tagsJson: JSON.stringify([...(rec.moods ?? []), ...(rec.tags ?? [])]),
              status: "failed",
              errorText: `missing catalog file: ${rec.file} (run npm run sample:music)`,
            },
          });
          return;
        }

        await prisma().soundtrackVersion.create({
          data: {
            versionId,
            sessionId,
            rank,
            trackId: rec.track_id,
            title: rec.title,
            artist: rec.artist ?? null,
            score: rec.score,
            tagsJson: JSON.stringify([...(rec.moods ?? []), ...(rec.tags ?? [])]),
            status: "pending",
          },
        });

        const outPath = path.join(workDir, `${versionId}.mp4`);
        try {
          await remuxTrackOntoPicture({
            picturePath: pictureLocal,
            musicPath,
            outPath,
            durationSec,
          });
          const body = await readFile(outPath);
          const uploaded = await storage.upload({
            objectPath: soundtrackVersionPath(projectId, sessionId, versionId),
            body,
            contentType: "video/mp4",
          });
          await prisma().soundtrackVersion.update({
            where: { versionId },
            data: { storageUri: uploaded.storageUri, status: "ready", errorText: null },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await prisma().soundtrackVersion.update({
            where: { versionId },
            data: { status: "failed", errorText: message.slice(0, 500) },
          });
        }
      }),
    );

    const readyCount = await prisma().soundtrackVersion.count({
      where: { sessionId, status: "ready" },
    });
    if (readyCount === 0) {
      await prisma().soundtrackSession.update({
        where: { sessionId },
        data: { status: "failed", errorText: "all soundtrack remuxes failed" },
      });
      throw new SoundtrackError("all soundtrack remuxes failed", 500);
    }

    await prisma().soundtrackSession.update({
      where: { sessionId },
      data: { status: "ready", errorText: null },
    });
    await setStageMessage(
      projectId,
      `${readyCount} soundtrack versions ready — pick one`,
    );

    const api = await toApiSession(sessionId);
    if (!api) throw new SoundtrackError("session missing after generate", 500);
    return api;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma().soundtrackSession.update({
      where: { sessionId },
      data: { status: "failed", errorText: message.slice(0, 500) },
    });
    await setStageMessage(projectId, `Soundtrack failed: ${message.slice(0, 160)}`);
    if (error instanceof SoundtrackError) throw error;
    throw new SoundtrackError(message, 500);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function getLatestSoundtrackSession(
  projectId: string,
): Promise<ApiSoundtrackSession | null> {
  const row = await prisma().soundtrackSession.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return toApiSession(row.sessionId);
}

export type SelectSoundtrackInput =
  | { mode: "catalog"; version_id: string }
  | { mode: "mute" }
  | { mode: "original" };

/**
 * Persist the user's choice. Catalog picks reuse an existing remuxed version
 * (change-song is free). Mute points at the silent picture render.
 */
export async function selectSoundtrack(
  projectId: string,
  input: SelectSoundtrackInput,
): Promise<ApiSoundtrackSession> {
  const session = await prisma().soundtrackSession.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { createdAt: "desc" },
    include: { versions: true },
  });
  if (!session) {
    throw new SoundtrackError("no ready soundtrack session — POST /soundtrack first", 409);
  }

  if (input.mode === "original") {
    const picture = await prisma().render.findUnique({
      where: { renderId: session.pictureRenderId },
    });
    if (!picture?.storageUri) {
      throw new SoundtrackError("picture render missing for original sound", 409);
    }

    await setStageMessage(projectId, "Mixing original clip audio onto picture…");
    const workDir = await mkdtemp(path.join(tmpdir(), "marryo-original-"));
    try {
      const storage = storageService();
      const pictureLocal = await storage.materializeLocal(picture.storageUri, workDir);
      const outPath = path.join(workDir, "original.mp4");
      await remuxOriginalAudioOntoPicture({
        projectId,
        picturePath: pictureLocal,
        outPath,
        workDir,
        durationSec: picture.duration || 60,
      });
      const body = await readFile(outPath);
      const uploaded = await storage.upload({
        objectPath: soundtrackVersionPath(projectId, session.sessionId, `original_${Date.now()}`),
        body,
        contentType: "video/mp4",
      });

      await prisma().soundtrackSession.update({
        where: { sessionId: session.sessionId },
        data: {
          selectedMode: "original",
          selectedVersionId: null,
        },
      });

      await upsertProjectFilm({
        projectId,
        storageUri: uploaded.storageUri,
        title: null,
        trackId: null,
        trackTitle: "Original sound",
        orientation: picture.orientation,
        duration: picture.duration,
        width: picture.width,
        height: picture.height,
        soundtrackSessionId: session.sessionId,
        soundtrackVersionId: null,
        pictureRenderId: session.pictureRenderId,
      });

      await setProjectStatus(projectId, "ready", "grading");
      await setStageMessage(projectId, "Film ready — compare color grade next");
      const api = await toApiSession(session.sessionId);
      if (!api) throw new SoundtrackError("session missing", 500);
      return api;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SoundtrackError(`original-sound remux failed: ${message}`, 500);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  if (input.mode === "mute") {
    const picture = await prisma().render.findUnique({
      where: { renderId: session.pictureRenderId },
    });
    if (!picture?.storageUri) {
      throw new SoundtrackError("picture render missing for mute selection", 409);
    }

    await prisma().soundtrackSession.update({
      where: { sessionId: session.sessionId },
      data: {
        selectedMode: "mute",
        selectedVersionId: null,
      },
    });

    await upsertProjectFilm({
      projectId,
      storageUri: picture.storageUri,
      title: null,
      trackId: null,
      trackTitle: null,
      orientation: picture.orientation,
      duration: picture.duration,
      width: picture.width,
      height: picture.height,
      soundtrackSessionId: session.sessionId,
      soundtrackVersionId: null,
      pictureRenderId: session.pictureRenderId,
    });

    await setProjectStatus(projectId, "ready", "grading");
    await setStageMessage(projectId, "Film ready — compare color grade next");
    const api = await toApiSession(session.sessionId);
    if (!api) throw new SoundtrackError("session missing", 500);
    return api;
  }

  const version = session.versions.find((v) => v.versionId === input.version_id);
  if (!version) {
    throw new SoundtrackError("version not found in this session", 404);
  }
  if (version.status !== "ready" || !version.storageUri) {
    throw new SoundtrackError("version is not ready", 409);
  }

  const picture = await prisma().render.findUnique({
    where: { renderId: session.pictureRenderId },
  });

  await prisma().soundtrackSession.update({
    where: { sessionId: session.sessionId },
    data: {
      selectedMode: "catalog",
      selectedVersionId: version.versionId,
    },
  });

  await upsertProjectFilm({
    projectId,
    storageUri: version.storageUri,
    trackId: version.trackId,
    trackTitle: version.title,
    orientation: picture?.orientation ?? null,
    duration: picture?.duration ?? null,
    width: picture?.width ?? null,
    height: picture?.height ?? null,
    soundtrackSessionId: session.sessionId,
    soundtrackVersionId: version.versionId,
    pictureRenderId: session.pictureRenderId,
  });

  await setProjectStatus(projectId, "ready", "grading");
  await setStageMessage(projectId, `Soundtrack locked — ${version.title}. Compare grade next`);

  const api = await toApiSession(session.sessionId);
  if (!api) throw new SoundtrackError("session missing", 500);
  return api;
}
