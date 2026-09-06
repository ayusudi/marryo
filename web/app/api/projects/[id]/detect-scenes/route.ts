import { detectScenesForProject, ScenesError } from "@marryo/services/scenes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const result = await detectScenesForProject(id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ScenesError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "detect scenes failed";
    console.error("[detect-scenes]", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
