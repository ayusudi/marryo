import { rm } from "node:fs/promises";
import path from "node:path";

import { extractClipPoster } from "./clip-media.ts";
import { createClip, type ApiClip } from "./projects.ts";
import { storageService } from "./storage-service.ts";
import { ffprobe } from "./tech-validation.ts";
import { runVisualValidation } from "./visual-validation.ts";

export async function finalizeUploadedClip(input: {
  projectId: string;
  clipId: string;
  filename: string;
  storageUri: string;
}): Promise<ApiClip> {
  const storage = storageService();
  const localPath = await storage.materializeLocal(input.storageUri);
  const isGcsTemp = localPath.includes(`${path.sep}marryo-gcs-`) || localPath.includes("/marryo-gcs-");

  try {
    let probe;
    try {
      probe = await ffprobe(localPath);
    } catch (error) {
      await storage.delete(input.storageUri).catch(() => undefined);
      throw error;
    }

    const visual = await runVisualValidation(localPath);

    let thumbnailUri: string | null = null;
    try {
      thumbnailUri = await extractClipPoster({
        projectId: input.projectId,
        clipId: input.clipId,
        localVideoPath: localPath,
        duration: probe.duration,
      });
    } catch {
      thumbnailUri = null;
    }

    return createClip({
      clipId: input.clipId,
      projectId: input.projectId,
      filename: input.filename,
      storageUri: input.storageUri,
      duration: probe.duration,
      status: "uploaded",
      valid: visual.valid,
      validationWarnings: {
        warnings: visual.warnings,
        metrics: visual.metrics,
      },
      thumbnailUri,
    });
  } finally {
    if (isGcsTemp) {
      await rm(path.dirname(localPath), { recursive: true, force: true }).catch(() => {});
    }
  }
}
