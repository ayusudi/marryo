import { auth } from "@/auth";
import { ensureUser } from "@marryo/services/account";
import { createProjectInput, createProject, listProjectsForOwner } from "@marryo/services/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const ownerId = session?.user?.id?.trim();
  if (!ownerId || !session?.user) {
    return Response.json({ error: "sign in required" }, { status: 401 });
  }

  await ensureUser({
    user_id: ownerId,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  });

  const projects = await listProjectsForOwner(ownerId);
  return Response.json({ projects });
}

export async function POST(request: Request) {
  const session = await auth();
  const ownerId = session?.user?.id?.trim();
  if (!ownerId || !session?.user) {
    return Response.json({ error: "sign in required" }, { status: 401 });
  }

  await ensureUser({
    user_id: ownerId,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = createProjectInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const project = await createProject({
    ...parsed.data,
    owner_id: ownerId,
  });
  return Response.json(project, { status: 201 });
}
