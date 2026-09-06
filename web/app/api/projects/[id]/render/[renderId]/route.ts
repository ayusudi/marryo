import { getRender } from "@marryo/services/render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; renderId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, renderId } = await params;
  try {
    const render = await getRender(id, renderId);
    if (!render) {
      return Response.json({ error: "render not found" }, { status: 404 });
    }
    return Response.json(render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
