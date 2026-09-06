import { auth } from "@/auth";
import {
  deleteProject,
  getProject,
  ProjectDeleteError,
  ProjectUpdateError,
  updateProject,
  updateProjectInput,
} from "@marryo/services/projects";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  return Response.json(project);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = updateProjectInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const project = await updateProject(id, parsed.data);
    return Response.json(project);
  } catch (error) {
    if (error instanceof ProjectUpdateError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  const ownerId = session?.user?.id?.trim();
  if (!ownerId) {
    return Response.json({ error: "sign in required" }, { status: 401 });
  }

  const { id } = await params;
  try {
    await deleteProject(id, { ownerId });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ProjectDeleteError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
