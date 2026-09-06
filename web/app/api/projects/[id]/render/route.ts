import { z } from "zod";

import { filmOrientationSchema } from "@marryo/services/projects";
import { getLatestRender, RenderError, renderProject } from "@marryo/services/render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const renderBodySchema = z
  .object({
    orientation: filmOrientationSchema.optional(),
  })
  .optional();

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  let orientation: z.infer<typeof filmOrientationSchema> | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown = undefined;
    try {
      const text = await request.text();
      if (text.trim()) {
        body = JSON.parse(text) as unknown;
      }
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const parsed = renderBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return Response.json(
        { error: "validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    orientation = parsed.data?.orientation;
  }

  try {
    const result = await renderProject(id, { orientation });
    return Response.json(result);
  } catch (error) {
    if (error instanceof RenderError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const render = await getLatestRender(id);
    if (!render) {
      return Response.json({ error: "no render found" }, { status: 404 });
    }
    return Response.json(render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
