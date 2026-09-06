import { deleteClip, getProject } from "@marryo/services/projects";
import { storageService } from "@marryo/services/storage-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; clipId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id: projectId, clipId } = await params;

  const project = await getProject(projectId);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  const removed = await deleteClip(projectId, clipId);
  if (!removed) {
    return Response.json({ error: "clip not found" }, { status: 404 });
  }

  if (removed.storage_uri) {
    try {
      await storageService().delete(removed.storage_uri);
    } catch {
      // File may already be gone; DB row is what the API guarantees.
    }
  }

  return Response.json({ ok: true, clip_id: clipId });
}
