import { randomBytes } from "node:crypto";

import { getProject, setProjectStatus, countClips } from "@marryo/services/projects";
import { rawClipPath } from "@marryo/services/storage";
import { StorageNotConfiguredError, storageService } from "@marryo/services/storage-service";
import {
  assertClipQuota,
  assertExtensionAndMime,
  assertFileSize,
  TechValidationError,
} from "@marryo/services/tech-validation";
import { env } from "@marryo/services/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function newClipId(): string {
  return `clp_${randomBytes(8).toString("hex")}`;
}

/**
 * Begin a browser→GCS direct upload (bypasses Cloud Run 32MB body limit).
 * Body: { filename, contentType?, size }
 */
export async function POST(request: Request, { params }: Params) {
  if (env().STORAGE_BACKEND.toLowerCase() === "local") {
    return Response.json(
      { error: "direct GCS upload unavailable with STORAGE_BACKEND=local; use multipart /upload" },
      { status: 501 },
    );
  }

  const { id: projectId } = await params;
  const project = await getProject(projectId);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const filename =
    body && typeof body === "object" && body !== null && "filename" in body
      ? String((body as { filename: unknown }).filename || "")
      : "";
  const contentType =
    body && typeof body === "object" && body !== null && "contentType" in body
      ? String((body as { contentType: unknown }).contentType || "")
      : "";
  const size =
    body && typeof body === "object" && body !== null && "size" in body
      ? Number((body as { size: unknown }).size)
      : NaN;

  if (!filename) {
    return Response.json({ error: "filename required" }, { status: 400 });
  }

  try {
    assertClipQuota(await countClips(projectId), 1);
    const ext = assertExtensionAndMime(filename, contentType);
    if (Number.isFinite(size)) assertFileSize(size);

    const storage = storageService();
    if (!storage.getWriteSignedUrl) {
      return Response.json({ error: "signed uploads not supported by storage backend" }, { status: 501 });
    }

    const clipId = newClipId();
    const objectPath = rawClipPath(projectId, clipId, ext.replace(".", ""));
    const { uploadUrl, storageUri } = await storage.getWriteSignedUrl(
      objectPath,
      contentType || "video/mp4",
      900,
    );

    await setProjectStatus(projectId, "uploading", "upload");

    return Response.json({
      clip_id: clipId,
      object_path: objectPath,
      storage_uri: storageUri,
      upload_url: uploadUrl,
      content_type: contentType || "video/mp4",
    });
  } catch (error) {
    if (error instanceof TechValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StorageNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
