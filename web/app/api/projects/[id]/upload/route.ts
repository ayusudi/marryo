import { rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { extractClipPoster } from "@marryo/services/clip-media";
import {
  countClips,
  createClip,
  getProject,
  setProjectStatus,
  type ApiClip,
} from "@marryo/services/projects";
import { rawClipPath } from "@marryo/services/storage";
import { StorageNotConfiguredError, storageService } from "@marryo/services/storage-service";
import {
  assertClipQuota,
  assertExtensionAndMime,
  assertFileSize,
  ffprobe,
  TechValidationError,
} from "@marryo/services/tech-validation";
import { runVisualValidation } from "@marryo/services/visual-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type UploadError = { filename: string; error: string };

function newClipId(): string {
  return `clp_${randomBytes(8).toString("hex")}`;
}

export async function POST(request: Request, { params }: Params) {
  const { id: projectId } = await params;
  const project = await getProject(projectId);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const files = form
    .getAll("files")
    .filter((value): value is File => typeof value === "object" && value !== null && "arrayBuffer" in value);

  if (files.length === 0) {
    return Response.json({ error: 'no files uploaded — use form field name "files"' }, { status: 400 });
  }

  try {
    assertClipQuota(await countClips(projectId), files.length);
  } catch (error) {
    if (error instanceof TechValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  let storage;
  try {
    storage = storageService();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  await setProjectStatus(projectId, "uploading", "upload");

  const clips: ApiClip[] = [];
  const errors: UploadError[] = [];

  for (const file of files) {
    const filename = file.name || "upload.bin";
    try {
      const ext = assertExtensionAndMime(filename, file.type);
      assertFileSize(file.size);

      const clipId = newClipId();
      const buffer = Buffer.from(await file.arrayBuffer());
      const objectPath = rawClipPath(projectId, clipId, ext.replace(".", ""));

      const stored = await storage.upload({
        objectPath,
        body: buffer,
        contentType: file.type || "video/mp4",
      });

      const isMaterialized = !stored.absolutePath;
      const localPath = stored.absolutePath || (await storage.materializeLocal(stored.storageUri));

      let probe;
      let visual;
      try {
        try {
          probe = await ffprobe(localPath);
        } catch (error) {
          await storage.delete(stored.storageUri);
          throw error;
        }

        visual = await runVisualValidation(localPath);

        let thumbnailUri: string | null = null;
        try {
          thumbnailUri = await extractClipPoster({
            projectId,
            clipId,
            localVideoPath: localPath,
            duration: probe.duration,
          });
        } catch {
          thumbnailUri = null;
        }

        const clip = await createClip({
          clipId,
          projectId,
          filename,
          storageUri: stored.storageUri,
          duration: probe.duration,
          status: "uploaded",
          valid: visual.valid,
          validationWarnings: {
            warnings: visual.warnings,
            metrics: visual.metrics,
          },
          thumbnailUri,
        });

        clips.push(clip);
      } finally {
        if (isMaterialized && localPath) {
          await rm(path.dirname(localPath), { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ filename, error: message });
    }
  }

  if (clips.length > 0) {
    await setProjectStatus(projectId, "draft", "validated");
  } else {
    await setProjectStatus(projectId, "draft", "upload");
  }

  return Response.json({
    project_id: projectId,
    clips,
    errors,
  });
}
