import { getProjectStatus } from "@marryo/services/projects";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const status = await getProjectStatus(id);
  if (!status) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  return Response.json(status);
}
