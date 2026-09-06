/**
 * Extract a mid-clip JPEG poster for studio clip cards.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { clipPosterPath } from "./storage";
import { storageService } from "./storage-service";

async function runFfmpeg(args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (exit ${code}): ${stderr.trim().slice(-500)}`));
    });
  });
}

/** Best-effort poster; returns storage URI or null. */
export async function extractClipPoster(input: {
  projectId: string;
  clipId: string;
  localVideoPath: string;
  duration: number | null;
}): Promise<string | null> {
  const workDir = await mkdtemp(path.join(tmpdir(), "marryo-clip-poster-"));
  try {
    const seek =
      input.duration && input.duration > 4
        ? Math.min(input.duration * 0.25, input.duration - 0.5)
        : 0.8;
    const outPath = path.join(workDir, "poster.jpg");
    await runFfmpeg(
      [
        "-y",
        "-ss",
        seek.toFixed(2),
        "-i",
        input.localVideoPath,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        "-vf",
        "scale=640:-2:force_original_aspect_ratio=decrease",
        outPath,
      ],
      "clip poster",
    );
    const body = await readFile(outPath);
    if (body.length < 800) return null;

    const uploaded = await storageService().upload({
      objectPath: clipPosterPath(input.projectId, input.clipId),
      body,
      contentType: "image/jpeg",
    });
    return uploaded.storageUri;
  } catch (error) {
    console.warn(
      `[clip-media] poster failed for ${input.clipId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
