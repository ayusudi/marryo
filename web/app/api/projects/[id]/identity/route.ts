import {
  confirmIdentity,
  confirmIdentityInput,
  IdentityError,
  listPersons,
} from "@marryo/services/identity";
import { getProject } from "@marryo/services/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Read-only people clusters + bride/groom labels for review. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  const persons = await listPersons(id);
  return Response.json({
    project_id: id,
    persons,
    bride_person_id: project.bride_person_id,
    groom_person_id: project.groom_person_id,
  });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = confirmIdentityInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await confirmIdentity(id, parsed.data);
    return Response.json(result);
  } catch (error) {
    if (error instanceof IdentityError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
