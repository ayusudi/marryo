import { identifyProject, IdentityError } from "@marryo/services/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const result = await identifyProject(id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof IdentityError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "identify failed";
    console.error("[identify]", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
