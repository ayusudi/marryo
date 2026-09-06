/**
 * Phase 6 renderer: turn a validated EditDecision into a 1080p MP4.
 *
 * Clip audio is muted; a silent AAC track is muxed so music can swap in later
 * by replacing the anullsrc input.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { fetchMomentsByIds, type MomentLookupRow } from "./clickhouse-schema.ts";
import { prisma } from "./db.ts";
import { env } from "./env.ts";
import {
  getProject,
  setProjectStatus,
  type FilmOrientation,
} from "./projects.ts";
import { evaluateRender, type RenderEvaluation } from "./render-eval.ts";
import { materializeCachedClip } from "./clip-cache.ts";
import { renderPath, ungradedRenderPath } from "./storage.ts";
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

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

const edlSchema = z.object({
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
});

export type EditDecisionList = z.infer<typeof edlSchema>;

type RenderPresets = {
  tones: Record<string, { vf?: string }>;
  moods: Record<string, { vf?: string; card_bg?: string; card_fg?: string }>;
  defaults: { card_bg: string; card_fg: string };
  transition: { type: string; duration: number };
};

export class RenderError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "RenderError";
    this.status = status;
  }
}

export type ApiRender = {
  render_id: string;
  project_id: string;
  edit_id: string;
  storage_uri: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  orientation: FilmOrientation;
  typography: Record<string, unknown> | null;
  status: string;
  evaluation: RenderEvaluation | null;
  error_text: string | null;
  created_at: string;
  playback_url?: string;
  /** Same cut without color grade (when available). */
  ungraded_playback_url?: string;
};

function toApiRender(
  row: {
    renderId: string;
    projectId: string;
    editId: string;
    storageUri: string | null;
    duration: number | null;
    width: number | null;
    height: number | null;
    orientation?: string | null;
    typographyJson?: string | null;
    status: string;
    evaluation: string | null;
    errorText: string | null;
    createdAt: Date;
  },
  playbackUrl?: string,
  ungradedPlaybackUrl?: string,
): ApiRender {
  let evaluation: RenderEvaluation | null = null;
  if (row.evaluation) {
    try {
      evaluation = JSON.parse(row.evaluation) as RenderEvaluation;
    } catch {
      evaluation = null;
    }
  }
  let typography: Record<string, unknown> | null = null;
  if (row.typographyJson) {
    try {
      typography = JSON.parse(row.typographyJson) as Record<string, unknown>;
    } catch {
      typography = null;
    }
  }
  return {
    render_id: row.renderId,
    project_id: row.projectId,
    edit_id: row.editId,
    storage_uri: row.storageUri,
    duration: row.duration,
    width: row.width,
    height: row.height,
    orientation: row.orientation === "portrait" ? "portrait" : "landscape",
    typography,
    status: row.status,
    evaluation,
    error_text: row.errorText,
    created_at: row.createdAt.toISOString(),
    ...(playbackUrl ? { playback_url: playbackUrl } : {}),
    ...(ungradedPlaybackUrl ? { ungraded_playback_url: ungradedPlaybackUrl } : {}),
  };
}

/** Map film orientation to output canvas size. Env RENDER_* are landscape defaults. */
export function dimensionsForOrientation(orientation: FilmOrientation): {
  width: number;
  height: number;
} {
  const config = env();
  if (orientation === "portrait") {
    return { width: 1080, height: 1920 };
  }
  return { width: config.RENDER_WIDTH, height: config.RENDER_HEIGHT };
}

async function setStageMessage(projectId: string, message: string): Promise<void> {
  await prisma().project.update({
    where: { projectId },
    data: { stageMessage: message },
  });
}

async function runCommand(
  bin: string,
  args: string[],
  label: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
      env: options.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(new RenderError(`${label} failed to start: ${error.message}`, 500));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new RenderError(
            `${label} failed (exit ${code}): ${stderr.trim().slice(-800) || stdout.trim().slice(-800) || "no output"}`,
            500,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function loadPresets(): Promise<RenderPresets> {
  const presetPath = path.join(repoRoot(), "agent", "config", "render_presets.json");
  const raw = await readFile(presetPath, "utf8");
  return JSON.parse(raw) as RenderPresets;
}

function gradeFilter(presets: RenderPresets, mood: string | null, visualTone: string | null): string {
  const parts: string[] = [];
  const toneKey = (visualTone ?? "").toLowerCase();
  const moodKey = (mood ?? "").toLowerCase();
  const toneVf = presets.tones[toneKey]?.vf?.trim();
  const moodVf = presets.moods[moodKey]?.vf?.trim();
  if (toneVf) parts.push(toneVf);
  if (moodVf) parts.push(moodVf);
  return parts.join(",");
}

function cardColors(
  presets: RenderPresets,
  mood: string | null,
): { bg: string; fg: string } {
  const moodKey = (mood ?? "").toLowerCase();
  const moodPreset = presets.moods[moodKey];
  return {
    bg: moodPreset?.card_bg ?? presets.defaults.card_bg,
    fg: moodPreset?.card_fg ?? presets.defaults.card_fg,
  };
}

function isCardScene(scene: EditDecisionList["scenes"][number]): boolean {
  return Boolean(scene.text && scene.duration && scene.duration > 0 && (scene.clips ?? []).length === 0);
}

function isClipScene(scene: EditDecisionList["scenes"][number]): boolean {
  return (scene.clips ?? []).length > 0;
}

function isRenderableScene(scene: EditDecisionList["scenes"][number]): boolean {
  return isCardScene(scene) || isClipScene(scene);
}

type CardStyle = {
  bg: string;
  fg: string;
  font_path?: string;
  size_name_px?: number;
  size_sub_px?: number;
  tracking?: number;
  line_gap?: number;
  position_id?: string;
  scrim_opacity?: number;
  animation_id?: string;
  animation_duration_s?: number;
};

type TypographyDecisionBundle = {
  title?: CardStyle & { font_family_id?: string; contrast_ratio?: number; animation_id?: string; animation_duration_s?: number; role?: string };
  ending?: CardStyle & { font_family_id?: string; contrast_ratio?: number; animation_id?: string; animation_duration_s?: number; role?: string };
  title_lines?: string[];
  ending_lines?: string[];
  features_summary?: Record<string, unknown>;
  [key: string]: unknown;
};

async function decideTypography(input: {
  project: Awaited<ReturnType<typeof getProject>>;
  orientation: FilmOrientation;
  width: number;
  height: number;
  moments: MomentLookupRow[];
  localVideoPaths: string[];
  titleDuration: number;
  endingDuration: number;
  workDir: string;
}): Promise<TypographyDecisionBundle | null> {
  if (!input.project) return null;
  const manifestPath = path.join(input.workDir, "typography-manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      project: {
        couple_names: input.project.couple_names,
        wedding_date: input.project.wedding_date,
        ending_message: input.project.ending_message,
        mood: input.project.mood,
        visual_tone: input.project.visual_tone,
        orientation: input.orientation,
      },
      orientation: input.orientation,
      width: input.width,
      height: input.height,
      title_duration: input.titleDuration,
      ending_duration: input.endingDuration,
      moments: input.moments.map((m) => ({
        moment_id: m.moment_id,
        emotion: m.emotion,
        lighting: m.lighting,
        shot_type: m.shot_type,
        visual_quality: m.visual_quality,
        bride_present: m.bride_present,
        groom_present: m.groom_present,
        duration: m.duration,
      })),
      local_video_paths: input.localVideoPaths,
    }),
    "utf8",
  );

  const python = pythonBin();
  const agentDir = path.join(repoRoot(), "agent");
  try {
    const { stdout } = await runCommand(
      python,
      ["-m", "marryo_agent.typography_cli", "--manifest", manifestPath],
      "typography_cli",
      {
        cwd: agentDir,
        env: { ...process.env, PYTHONPATH: agentDir },
      },
    );
    const parsed = JSON.parse(stdout) as TypographyDecisionBundle & { error?: string };
    if (parsed.error) {
      console.warn(`typography_cli warning: ${parsed.error}`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn(
      `typography_cli failed, using mood colors only: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function styleFromDecision(
  decision: (CardStyle & { color_bg?: string; color_fg?: string; position_id?: string }) | undefined,
  fallback: { bg: string; fg: string },
): CardStyle {
  if (!decision) return { bg: fallback.bg, fg: fallback.fg };
  return {
    bg: decision.color_bg ?? decision.bg ?? fallback.bg,
    fg: decision.color_fg ?? decision.fg ?? fallback.fg,
    font_path: decision.font_path,
    size_name_px: decision.size_name_px,
    size_sub_px: decision.size_sub_px,
    tracking: decision.tracking,
    line_gap: decision.line_gap,
    position_id: decision.position_id,
    scrim_opacity: decision.scrim_opacity,
    animation_id: decision.animation_id,
    animation_duration_s: decision.animation_duration_s,
  };
}

async function renderTextCards(
  cards: Array<{ id: string; lines: string[]; style: CardStyle }>,
  width: number,
  height: number,
  outDir: string,
): Promise<Map<string, string>> {
  if (cards.length === 0) return new Map();

  const specPath = path.join(outDir, "cards-spec.json");
  const cardsDir = path.join(outDir, "cards");
  await writeFile(
    specPath,
    JSON.stringify({
      width,
      height,
      out_dir: cardsDir,
      cards: cards.map((c) => ({
        id: c.id,
        lines: c.lines,
        style: c.style,
      })),
    }),
    "utf8",
  );

  const python = pythonBin();
  const agentDir = path.join(repoRoot(), "agent");
  const { stdout } = await runCommand(
    python,
    ["-m", "cv.textcard_cli", "--spec", specPath],
    "textcard_cli",
    {
      cwd: agentDir,
      env: { ...process.env, PYTHONPATH: agentDir },
    },
  );

  const parsed = JSON.parse(stdout) as {
    cards?: Array<{ id: string; png_path: string }>;
    error?: string;
  };
  if (parsed.error) {
    throw new RenderError(`text card render failed: ${parsed.error}`, 500);
  }

  const map = new Map<string, string>();
  for (const card of parsed.cards ?? []) {
    map.set(card.id, card.png_path);
  }
  return map;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function normalizeClipSegment(input: {
  localClip: string;
  absoluteStart: number;
  duration: number;
  outPath: string;
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: string;
  /** Keep source audio (for original-sound renders). Default mute. */
  keepAudio?: boolean;
}): Promise<void> {
  // force_original_aspect_ratio=decrease + pad → letterbox/pillarbox into canvas
  // (portrait canvas + landscape clip = black bars top/bottom; reverse = side bars).
  const scalePad = `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${input.fps}`;

  const args = [
    "-y",
    "-ss",
    String(Math.max(0, input.absoluteStart)),
    "-i",
    input.localClip,
    "-t",
    String(Math.max(0.1, input.duration)),
    "-vf",
    scalePad,
  ];

  if (input.keepAudio) {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      input.preset,
      "-crf",
      String(input.crf),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
    );
  } else {
    args.push(
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      input.preset,
      "-crf",
      String(input.crf),
      "-pix_fmt",
      "yuv420p",
    );
  }
  args.push(input.outPath);

  await runCommand(ffmpegBin(), args, `normalize clip segment`);
}

/** Apply color grade to a finished silent (or audio) MP4 without re-cutting. */
async function applyGradeToFile(input: {
  inPath: string;
  outPath: string;
  grade: string;
  crf: number;
  preset: string;
}): Promise<void> {
  if (!input.grade.trim()) {
    await runCommand(
      ffmpegBin(),
      ["-y", "-i", input.inPath, "-c", "copy", input.outPath],
      "copy ungraded as graded",
    );
    return;
  }
  await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-i",
      input.inPath,
      "-vf",
      input.grade,
      "-c:v",
      "libx264",
      "-preset",
      input.preset,
      "-crf",
      String(input.crf),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      input.outPath,
    ],
    "apply color grade",
  );
}

async function normalizeCardSegment(input: {
  pngPath: string;
  duration: number;
  outPath: string;
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: string;
  animationId?: string;
  animationDurationS?: number;
}): Promise<void> {
  const dur = Math.max(0.1, input.duration);
  const animDur = Math.min(
    Math.max(0, input.animationDurationS ?? 0),
    Math.max(0, dur - 0.15),
  );
  const anim = input.animationId ?? "none";
  const base = `scale=${input.width}:${input.height},setsar=1,fps=${input.fps}`;

  let vf = base;
  if (anim === "fade_in" && animDur > 0.05) {
    vf = `${base},fade=t=in:st=0:d=${animDur.toFixed(3)}`;
  } else if (anim === "scale_in" && animDur > 0.05) {
    const frames = Math.max(1, Math.round(dur * input.fps));
    const animFrames = Math.max(1, Math.round(animDur * input.fps));
    vf = `${base},zoompan=z='min(1+0.06*on/${animFrames}\\,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${input.width}x${input.height}:fps=${input.fps}`;
  } else if (anim === "rise_fade" && animDur > 0.05) {
    // Fade in + slight upward settle via zoompan y offset (avoids fragile crop exprs).
    const frames = Math.max(1, Math.round(dur * input.fps));
    const animFrames = Math.max(1, Math.round(animDur * input.fps));
    vf = `${base},zoompan=z=1:x=0:y='(ih*0.04)*(1-min(1\\,on/${animFrames}))':d=${frames}:s=${input.width}x${input.height}:fps=${input.fps},fade=t=in:st=0:d=${animDur.toFixed(3)}`;
  }

  await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-loop",
      "1",
      "-i",
      input.pngPath,
      "-t",
      String(dur),
      "-vf",
      vf,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      input.preset,
      "-crf",
      String(input.crf),
      "-pix_fmt",
      "yuv420p",
      input.outPath,
    ],
    `normalize card segment`,
  );
}

async function stitchWithXfade(input: {
  segments: Array<{ path: string; duration: number }>;
  outPath: string;
  transitionDuration: number;
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: string;
  /** Optional color-grade VF chained after the timeline fades. */
  gradeVf?: string;
}): Promise<void> {
  const { segments, transitionDuration } = input;
  if (segments.length === 0) {
    throw new RenderError("no segments to stitch", 500);
  }

  if (segments.length === 1) {
    const graded = Boolean(input.gradeVf?.trim());
    if (graded) {
      const tmp = `${input.outPath}.pregrade.mp4`;
      await muxSilentAudio({
        videoPath: segments[0]!.path,
        outPath: tmp,
        crf: input.crf,
        preset: input.preset,
      });
      await applyGradeToFile({
        inPath: tmp,
        outPath: input.outPath,
        grade: input.gradeVf!,
        crf: input.crf,
        preset: input.preset,
      });
      return;
    }
    await muxSilentAudio({
      videoPath: segments[0]!.path,
      outPath: input.outPath,
      crf: input.crf,
      preset: input.preset,
    });
    return;
  }

  // Build pairwise xfade filter graph.
  const args: string[] = ["-y"];
  for (const seg of segments) {
    args.push("-i", seg.path);
  }

  const filters: string[] = [];
  filters.push(`[0:v]fade=t=in:st=0:d=0.4[v0]`);
  let lastLabel = "v0";

  let cumulative = segments[0]!.duration;
  for (let i = 1; i < segments.length; i++) {
    const offset = Math.max(0, cumulative - transitionDuration);
    const outLabel = i === segments.length - 1 ? "vxlast" : `vx${i}`;
    filters.push(
      `[${lastLabel}][${i}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${offset.toFixed(3)}[${outLabel}]`,
    );
    lastLabel = outLabel;
    cumulative += segments[i]!.duration - transitionDuration;
  }

  const totalDuration = Math.max(0.1, cumulative);
  const fadeOutStart = Math.max(0, totalDuration - 0.5);
  const grade = input.gradeVf?.trim();
  if (grade) {
    filters.push(`[${lastLabel}]fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.5,${grade}[vfinal]`);
  } else {
    filters.push(`[${lastLabel}]fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.5[vfinal]`);
  }

  // Silent audio — music seam: replace anullsrc with a music file later.
  args.push(
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vfinal]",
    "-map",
    `${segments.length}:a`,
    "-c:v",
    "libx264",
    "-preset",
    input.preset,
    "-crf",
    String(input.crf),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-t",
    String(totalDuration),
    input.outPath,
  );

  await runCommand(ffmpegBin(), args, grade ? "xfade stitch + grade" : "xfade stitch");
}

async function stitchWithConcat(input: {
  segments: Array<{ path: string; duration: number }>;
  outPath: string;
  workDir: string;
  crf: number;
  preset: string;
  keepAudio?: boolean;
}): Promise<void> {
  const listPath = path.join(input.workDir, "concat.txt");
  const listBody = input.segments
    .map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, listBody, "utf8");

  if (input.keepAudio) {
    await runCommand(
      ffmpegBin(),
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        input.preset,
        "-crf",
        String(input.crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        input.outPath,
      ],
      "concat demuxer with audio",
    );
    return;
  }

  const silentVideo = path.join(input.workDir, "concat-video.mp4");
  // Segments already share fps/size/pix_fmt from normalize — stream-copy when silent.
  await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-an",
      "-c",
      "copy",
      silentVideo,
    ],
    "concat demuxer copy",
  );

  await muxSilentAudio({
    videoPath: silentVideo,
    outPath: input.outPath,
    crf: input.crf,
    preset: input.preset,
  });
}

async function muxSilentAudio(input: {
  videoPath: string;
  outPath: string;
  crf: number;
  preset: string;
}): Promise<void> {
  await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-i",
      input.videoPath,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      input.outPath,
    ],
    "mux silent audio",
  );
}

export type RenderOptions = {
  /** Reserved for a later music phase — currently unused. */
  musicUri?: string;
  /** Override project.orientation for this render only. */
  orientation?: FilmOrientation;
  /** Keep clip audio (original sound). Uses hard-cut stitch. */
  withSourceAudio?: boolean;
  /** Do not move project to soundtrack stage (e.g. original-sound after soundtrack pick). */
  skipStageAdvance?: boolean;
};

export async function renderProject(
  projectId: string,
  opts: RenderOptions = {},
): Promise<ApiRender> {
  const project = await getProject(projectId);
  if (!project) {
    throw new RenderError("project not found", 404);
  }

  const edit = await prisma().editDecision.findFirst({
    where: { projectId, valid: true },
    orderBy: { createdAt: "desc" },
  });
  if (!edit) {
    throw new RenderError("no valid EditDecision — run /direct first", 409);
  }

  let edl: EditDecisionList;
  try {
    edl = edlSchema.parse(JSON.parse(edit.edlJson));
  } catch (error) {
    throw new RenderError(
      `corrupt EDL JSON: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }

  const renderableScenes = edl.scenes.filter(isRenderableScene);
  if (renderableScenes.length === 0) {
    throw new RenderError("EDL has no renderable scenes", 400);
  }

  const orientation: FilmOrientation =
    opts.orientation ?? project.orientation ?? "landscape";
  const { width, height } = dimensionsForOrientation(orientation);

  const config = env();
  const fps = config.RENDER_FPS;
  const crf = config.RENDER_CRF;
  const preset = config.RENDER_PRESET;

  let storage;
  try {
    storage = storageService();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      throw new RenderError(error.message, 503);
    }
    throw error;
  }

  const renderId = newId("rnd");
  await prisma().render.create({
    data: {
      renderId,
      projectId,
      editId: edit.editId,
      orientation,
      status: "rendering",
    },
  });

  await setProjectStatus(projectId, "rendering", "rendering");
  await setStageMessage(projectId, `Rendering your film (${orientation})`);

  const workDir = await mkdtemp(path.join(tmpdir(), "marryo-render-"));
  const skippedScenes: string[] = [];

  try {
    const presets = await loadPresets();
    const transitionDuration = presets.transition?.duration ?? 0.5;
    const grade = gradeFilter(presets, project.mood, project.visual_tone);
    const colors = cardColors(presets, project.mood);

    // Resolve moments for clip scenes.
    const momentIds = renderableScenes.flatMap((s) => (s.clips ?? []).map((c) => c.moment_id));
    const moments = await fetchMomentsByIds(projectId, momentIds);
    const momentMap = new Map<string, MomentLookupRow>(moments.map((m) => [m.moment_id, m]));

    // Materialize unique source clips (shared project cache).
    const localClipByUri = new Map<string, string>();
    const clipIdByUri = new Map(moments.map((m) => [m.storage_uri, m.clip_id]));
    await Promise.all(
      [...new Set(moments.map((m) => m.storage_uri))].map(async (uri) => {
        const local = await materializeCachedClip(
          storage,
          projectId,
          uri,
          clipIdByUri.get(uri),
        );
        localClipByUri.set(uri, local);
      }),
    );

    // Card durations from EDL (for typography animation budget).
    let titleDuration = 2.0;
    let endingDuration = 3.0;
    for (const scene of edl.scenes) {
      if (!isCardScene(scene)) continue;
      const name = scene.name.toLowerCase();
      if (name.includes("end") || name.includes("closing")) {
        endingDuration = Number(scene.duration) || endingDuration;
      } else {
        titleDuration = Number(scene.duration) || titleDuration;
      }
    }

    const typography = await decideTypography({
      project,
      orientation,
      width,
      height,
      moments,
      localVideoPaths: [...localClipByUri.values()],
      titleDuration,
      endingDuration,
      workDir,
    });

    const titleStyle = styleFromDecision(
      typography?.title as Parameters<typeof styleFromDecision>[0],
      colors,
    );
    const endingStyle = styleFromDecision(
      typography?.ending as Parameters<typeof styleFromDecision>[0],
      colors,
    );

    // Build text cards with decided typography.
    const cardSpecs: Array<{ id: string; lines: string[]; style: CardStyle; role: "title" | "ending" }> =
      [];
    for (let i = 0; i < edl.scenes.length; i++) {
      const scene = edl.scenes[i]!;
      if (!isCardScene(scene)) continue;
      const name = scene.name.toLowerCase();
      const isEnding = name.includes("end") || name.includes("closing");
      const role = isEnding ? "ending" : "title";
      const style = role === "ending" ? endingStyle : titleStyle;
      const decidedLines =
        role === "ending"
          ? typography?.ending_lines
          : typography?.title_lines;
      cardSpecs.push({
        id: `card_${i}`,
        lines:
          decidedLines && decidedLines.length > 0
            ? decidedLines
            : String(scene.text)
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
        style,
        role,
      });
    }
    const cardPngs = await renderTextCards(
      cardSpecs.map(({ id, lines, style }) => ({ id, lines, style })),
      width,
      height,
      workDir,
    );
    const cardAnimById = new Map(
      cardSpecs.map((c) => [
        c.id,
        {
          animationId: c.style.animation_id ?? "none",
          animationDurationS: c.style.animation_duration_s ?? 0,
        },
      ]),
    );

    await setStageMessage(projectId, "Assembling scenes");

    // Build normalize jobs, then encode segments in parallel.
    type SegJob =
      | {
          kind: "card";
          index: number;
          name: string;
          segPath: string;
          png: string;
          duration: number;
          animationId?: string;
          animationDurationS?: number;
        }
      | {
          kind: "clip";
          index: number;
          name: string;
          segPath: string;
          parts: Array<{
            partPath: string;
            localClip: string;
            absoluteStart: number;
            duration: number;
          }>;
        };

    const jobs: SegJob[] = [];
    for (let i = 0; i < edl.scenes.length; i++) {
      const scene = edl.scenes[i]!;
      if (!isRenderableScene(scene)) {
        skippedScenes.push(scene.name);
        continue;
      }
      const segPath = path.join(workDir, `seg_${String(i).padStart(3, "0")}.mp4`);

      if (isCardScene(scene)) {
        const png = cardPngs.get(`card_${i}`);
        if (!png) {
          skippedScenes.push(scene.name);
          continue;
        }
        const anim = cardAnimById.get(`card_${i}`);
        jobs.push({
          kind: "card",
          index: i,
          name: scene.name,
          segPath,
          png,
          duration: Number(scene.duration),
          animationId: anim?.animationId,
          animationDurationS: anim?.animationDurationS,
        });
        continue;
      }

      const clips = scene.clips ?? [];
      const parts: Array<{
        partPath: string;
        localClip: string;
        absoluteStart: number;
        duration: number;
      }> = [];
      for (let ci = 0; ci < clips.length; ci++) {
        const clip = clips[ci]!;
        const moment = momentMap.get(clip.moment_id);
        if (!moment) {
          skippedScenes.push(`${scene.name} (missing moment ${clip.moment_id})`);
          continue;
        }
        const localClip = localClipByUri.get(moment.storage_uri);
        if (!localClip) {
          skippedScenes.push(`${scene.name} (missing source)`);
          continue;
        }
        const partPath =
          clips.length === 1 ? segPath : path.join(workDir, `seg_${String(i).padStart(3, "0")}_${ci}.mp4`);
        parts.push({
          partPath,
          localClip,
          absoluteStart: moment.start_time + clip.start,
          duration: Math.max(0.1, clip.end - clip.start),
        });
      }
      if (parts.length === 0) continue;
      jobs.push({ kind: "clip", index: i, name: scene.name, segPath, parts });
    }

    const segments: Array<{ path: string; duration: number; name: string; index: number }> = [];
    await mapPool(jobs, 4, async (job) => {
      if (job.kind === "card") {
        await normalizeCardSegment({
          pngPath: job.png,
          duration: job.duration,
          outPath: job.segPath,
          width,
          height,
          fps,
          crf,
          preset,
          animationId: job.animationId,
          animationDurationS: job.animationDurationS,
        });
        if (opts.withSourceAudio) {
          const withAudio = path.join(workDir, `seg_${String(job.index).padStart(3, "0")}_a.mp4`);
          await muxSilentAudio({
            videoPath: job.segPath,
            outPath: withAudio,
            crf,
            preset,
          });
          segments.push({ path: withAudio, duration: job.duration, name: job.name, index: job.index });
        } else {
          segments.push({ path: job.segPath, duration: job.duration, name: job.name, index: job.index });
        }
        return;
      }

      await mapPool(job.parts, 4, async (part) => {
        await normalizeClipSegment({
          localClip: part.localClip,
          absoluteStart: part.absoluteStart,
          duration: part.duration,
          outPath: part.partPath,
          width,
          height,
          fps,
          crf,
          preset,
          keepAudio: Boolean(opts.withSourceAudio),
        });
      });
      const duration = job.parts.reduce((sum, part) => sum + part.duration, 0);
      if (job.parts.length === 1) {
        segments.push({ path: job.parts[0]!.partPath, duration, name: job.name, index: job.index });
      } else {
        const concatDir = path.join(workDir, `scene_${String(job.index).padStart(3, "0")}`);
        await mkdir(concatDir, { recursive: true });
        await stitchWithConcat({
          segments: job.parts.map((p) => ({ path: p.partPath, duration: p.duration })),
          outPath: job.segPath,
          workDir: concatDir,
          crf,
          preset,
        });
        segments.push({ path: job.segPath, duration, name: job.name, index: job.index });
      }
    });

    segments.sort((a, b) => a.index - b.index);

    if (segments.length === 0) {
      throw new RenderError("no segments produced from EDL", 500);
    }

    await setStageMessage(projectId, "Stitching final cut");

    const ungradedPath = path.join(workDir, "ungraded.mp4");
    const finalPath = path.join(workDir, "final.mp4");
    const useAudio = Boolean(opts.withSourceAudio);
    const hasGrade = Boolean(grade.trim());

    const stitchOnce = async (outPath: string, gradeVf?: string) => {
      try {
        if (useAudio) {
          await stitchWithConcat({
            segments,
            outPath,
            workDir,
            crf,
            preset,
            keepAudio: true,
          });
          if (gradeVf?.trim()) {
            const tmp = `${outPath}.pregrade.mp4`;
            await runCommand(ffmpegBin(), ["-y", "-i", outPath, "-c", "copy", tmp], "park for grade");
            await applyGradeToFile({
              inPath: tmp,
              outPath,
              grade: gradeVf,
              crf,
              preset,
            });
          }
        } else {
          await stitchWithXfade({
            segments,
            outPath,
            transitionDuration,
            width,
            height,
            fps,
            crf,
            preset,
            gradeVf,
          });
        }
      } catch {
        await stitchWithConcat({
          segments,
          outPath,
          workDir,
          crf,
          preset,
          keepAudio: useAudio,
        });
        if (gradeVf?.trim()) {
          const tmp = `${outPath}.pregrade.mp4`;
          await runCommand(ffmpegBin(), ["-y", "-i", outPath, "-c", "copy", tmp], "park for grade");
          await applyGradeToFile({
            inPath: tmp,
            outPath,
            grade: gradeVf,
            crf,
            preset,
          });
        }
      }
    };

    if (hasGrade && !useAudio) {
      // Parallel: ungraded timeline + graded (grade folded into xfade VF).
      await Promise.all([stitchOnce(ungradedPath), stitchOnce(finalPath, grade)]);
    } else {
      await stitchOnce(ungradedPath);
      await applyGradeToFile({
        inPath: ungradedPath,
        outPath: finalPath,
        grade,
        crf,
        preset,
      });
    }

    await setStageMessage(projectId, "Evaluating render");

    const evaluation = await evaluateRender({
      outputPath: finalPath,
      edl,
      maxDuration: project.max_duration,
      width,
      height,
      sceneCountRendered: segments.length,
      transitionDuration: useAudio ? 0 : transitionDuration,
      typography: typography
        ? {
            title: typography.title as {
              contrast_ratio?: number;
              animation_id?: string;
              animation_duration_s?: number;
              position_id?: string;
            },
            ending: typography.ending as {
              contrast_ratio?: number;
              animation_id?: string;
              animation_duration_s?: number;
              position_id?: string;
            },
            title_duration: titleDuration,
            ending_duration: endingDuration,
            orientation,
          }
        : undefined,
    });

    if (skippedScenes.length > 0) {
      evaluation.checks.push({
        name: "skipped_scenes",
        passed: true,
        detail: `skipped: ${skippedScenes.join("; ")}`,
      });
    }

    const probe = await ffprobe(finalPath);
    const objectPath = renderPath(projectId, renderId);
    const ungradedObjectPath = ungradedRenderPath(projectId, renderId);
    const body = await readFile(finalPath);
    const ungradedBody = await readFile(ungradedPath);
    const uploaded = await storage.upload({
      objectPath,
      body,
      contentType: "video/mp4",
    });
    const uploadedUngraded = await storage.upload({
      objectPath: ungradedObjectPath,
      body: ungradedBody,
      contentType: "video/mp4",
    });

    const status = evaluation.passed ? "ready" : "failed";
    const updated = await prisma().render.update({
      where: { renderId },
      data: {
        storageUri: uploaded.storageUri,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        orientation,
        typographyJson: typography ? JSON.stringify(typography) : null,
        status,
        evaluation: JSON.stringify(evaluation),
        errorText: evaluation.passed
          ? null
          : evaluation.checks
              .filter((c) => !c.passed)
              .map((c) => `${c.name}: ${c.detail}`)
              .join("; "),
      },
    });

    if (evaluation.passed) {
      if (!opts.skipStageAdvance) {
        await setProjectStatus(projectId, "ready", "soundtrack");
        await setStageMessage(projectId, "Picture ready — choose a soundtrack next");
      }
    } else {
      await setProjectStatus(projectId, "failed", "rendering");
      await setStageMessage(
        projectId,
        `Render evaluation failed: ${evaluation.checks
          .filter((c) => !c.passed)
          .map((c) => c.name)
          .join(", ")}`,
      );
    }

    let playbackUrl: string | undefined;
    let ungradedPlaybackUrl: string | undefined;
    try {
      playbackUrl = await storage.getSignedUrl(uploaded.storageUri);
    } catch {
      playbackUrl = undefined;
    }
    try {
      ungradedPlaybackUrl = await storage.getSignedUrl(uploadedUngraded.storageUri);
    } catch {
      ungradedPlaybackUrl = undefined;
    }

    return toApiRender(updated, playbackUrl, ungradedPlaybackUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma().render.update({
      where: { renderId },
      data: { status: "failed", errorText: message },
    });
    await setProjectStatus(projectId, "failed", "rendering");
    await setStageMessage(projectId, `Render failed: ${message.slice(0, 200)}`);
    if (error instanceof RenderError) throw error;
    throw new RenderError(message, 500);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function getLatestRender(projectId: string): Promise<ApiRender | null> {
  const row = await prisma().render.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;

  const storage = storageService();
  let playbackUrl: string | undefined;
  let ungradedPlaybackUrl: string | undefined;
  if (row.storageUri) {
    try {
      playbackUrl = await storage.getSignedUrl(row.storageUri);
    } catch {
      playbackUrl = undefined;
    }
    try {
      const ungradedUri = row.storageUri.replace(/\.mp4$/i, ".ungraded.mp4");
      if (ungradedUri !== row.storageUri) {
        ungradedPlaybackUrl = await storage.getSignedUrl(ungradedUri);
      }
    } catch {
      ungradedPlaybackUrl = undefined;
    }
  }
  return toApiRender(row, playbackUrl, ungradedPlaybackUrl);
}

export async function getRender(
  projectId: string,
  renderId: string,
): Promise<ApiRender | null> {
  const row = await prisma().render.findFirst({
    where: { projectId, renderId },
  });
  if (!row) return null;

  const storage = storageService();
  let playbackUrl: string | undefined;
  let ungradedPlaybackUrl: string | undefined;
  if (row.storageUri) {
    try {
      playbackUrl = await storage.getSignedUrl(row.storageUri);
    } catch {
      playbackUrl = undefined;
    }
    try {
      const ungradedUri = row.storageUri.replace(/\.mp4$/i, ".ungraded.mp4");
      if (ungradedUri !== row.storageUri) {
        ungradedPlaybackUrl = await storage.getSignedUrl(ungradedUri);
      }
    } catch {
      ungradedPlaybackUrl = undefined;
    }
  }
  return toApiRender(row, playbackUrl, ungradedPlaybackUrl);
}
