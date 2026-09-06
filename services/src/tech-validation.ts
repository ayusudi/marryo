/**
 * Technical upload validation: size, MIME/extension, and ffprobe container checks.
 * Visual checks live in agent/cv (Python) and are invoked separately.
 */

import { spawn } from "node:child_process";
import path from "node:path";

import { uploadLimits } from "./projects.ts";

export const ACCEPTED_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export const ACCEPTED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/octet-stream", // browsers sometimes omit a precise type; extension still required
]);

export class TechValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TechValidationError";
  }
}

export function assertExtensionAndMime(filename: string, mimeType: string | undefined): string {
  const ext = path.extname(filename).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    throw new TechValidationError(
      `unsupported extension "${ext || "(none)"}" — accepted: mp4, mov, webm`,
    );
  }
  const mime = (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime && !ACCEPTED_MIME_TYPES.has(mime)) {
    throw new TechValidationError(
      `unsupported MIME type "${mime}" — accepted: video/mp4, video/quicktime, video/webm`,
    );
  }
  // Extension/MIME pairing when both are present and specific
  if (mime === "video/mp4" && ext !== ".mp4") {
    throw new TechValidationError(`MIME video/mp4 does not match extension ${ext}`);
  }
  if (mime === "video/quicktime" && ext !== ".mov") {
    throw new TechValidationError(`MIME video/quicktime does not match extension ${ext}`);
  }
  if (mime === "video/webm" && ext !== ".webm") {
    throw new TechValidationError(`MIME video/webm does not match extension ${ext}`);
  }
  return ext;
}

export function assertFileSize(sizeBytes: number): void {
  const { maxClipBytes, maxClipSizeMb } = uploadLimits();
  if (sizeBytes <= 0) {
    throw new TechValidationError("empty file");
  }
  if (sizeBytes > maxClipBytes) {
    throw new TechValidationError(`file exceeds MAX_CLIP_SIZE_MB (${maxClipSizeMb})`);
  }
}

export function assertClipQuota(existingCount: number, incomingCount: number): void {
  const { maxClipsPerProject } = uploadLimits();
  if (existingCount + incomingCount > maxClipsPerProject) {
    throw new TechValidationError(
      `project would exceed MAX_CLIPS_PER_PROJECT (${maxClipsPerProject}): have ${existingCount}, uploading ${incomingCount}`,
    );
  }
}

export type FfprobeResult = {
  duration: number;
  width: number;
  height: number;
  codec: string;
};

export type FfprobeMediaResult = FfprobeResult & {
  hasAudio: boolean;
  audioCodec: string | null;
};

export async function ffprobe(filePath: string): Promise<FfprobeResult> {
  const media = await ffprobeMedia(filePath);
  return {
    duration: media.duration,
    width: media.width,
    height: media.height,
    codec: media.codec,
  };
}

/** Full container probe including whether an audio stream is present. */
export async function ffprobeMedia(filePath: string): Promise<FfprobeMediaResult> {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height:format=duration",
    "-of",
    "json",
    filePath,
  ];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(new TechValidationError(`ffprobe failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new TechValidationError(
            `corrupted or unreadable video (ffprobe exit ${code}): ${err.trim() || "no details"}`,
          ),
        );
        return;
      }
      resolve(out);
    });
  });

  let parsed: {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }>;
    format?: { duration?: string };
  };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    throw new TechValidationError("ffprobe returned invalid JSON");
  }

  const video = (parsed.streams ?? []).find((s) => s.codec_type === "video");
  if (!video?.width || !video?.height || !video.codec_name) {
    throw new TechValidationError("no video stream found — file may be audio-only or corrupted");
  }

  const audio = (parsed.streams ?? []).find((s) => s.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new TechValidationError("could not determine video duration");
  }

  return {
    duration,
    width: video.width,
    height: video.height,
    codec: video.codec_name,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? null,
  };
}
