import { finalizeUploadedClip } from "@marryo/services/clip-upload";
import { getProject, setProjectStatus } from "@marryo/services/projects";
import { parseGsUri } from "@marryo/services/storage";
import { StorageNotConfiguredError, storageService } from "@marryo/services/storage-service";
import { TechValidationError } from "@marryo/services/tech-validation";
import { env } from "@marryo/services/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * After browser PUT to signed URL: validate + register clip.
 * Body: { clip_id, filename, storage_uri }
 */
export async function POST(request: Request, { params }: Params) {
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

  const clipId =
    body && typeof body === "object" && body !== null && "clip_id" in body
      ? String((body as { clip_id: unknown }).clip_id || "")
      : "";
  const filename =
    body && typeof body === "object" && body !== null && "filename" in body
      ? String((body as { filename: unknown }).filename || "")
      : "";
  const storageUri =
    body && typeof body === "object" && body !== null && "storage_uri" in body
      ? String((body as { storage_uri: unknown }).storage_uri || "")
      : "";

  if (!clipId || !filename || !storageUri) {
    return Response.json({ error: "clip_id, filename, and storage_uri required" }, { status: 400 });
  }

  try {
    // Ensure object belongs to this project path.
    if (storageUri.startsWith("gs://")) {
      const { objectPath } = parseGsUri(storageUri);
      if (!objectPath.startsWith(`projects/${projectId}/raw/${clipId}.`)) {
        return Response.json({ error: "storage_uri does not match project/clip" }, { status: 400 });
      }
      if (env().GOOGLE_CLOUD_STORAGE_BUCKET) {
        const expected = `gs://${env().GOOGLE_CLOUD_STORAGE_BUCKET}/`;
        if (!storageUri.startsWith(expected)) {
          return Response.json({ error: "storage_uri bucket mismatch" }, { status: 400 });
        }
      }
    }

    // Confirm object exists before spending CPU on validation.
    const storage = storageService();
    const exists = storage.objectExists
      ? await storage.objectExists(storageUri)
      : true;
    if (!exists) {
      return Response.json(
        { error: "uploaded object not found in storage — retry upload" },
        { status: 400 },
      );
    }

    const clip = await finalizeUploadedClip({
      projectId,
      clipId,
      filename,
      storageUri,
    });

    await setProjectStatus(projectId, "draft", "validated");
    return Response.json({ project_id: projectId, clips: [clip], errors: [] });
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
