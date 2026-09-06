import { z } from "zod";

import {
  generateSoundtrackVersions,
  getLatestSoundtrackSession,
  SoundtrackError,
} from "@marryo/services/soundtrack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    force: z.boolean().optional(),
    top_n: z.number().int().min(1).max(10).optional(),
  })
  .optional();

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  let force = false;
  let topN: number | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown = undefined;
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text) as unknown;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return Response.json(
        { error: "validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    force = parsed.data?.force ?? false;
    topN = parsed.data?.top_n;
  }

  try {
    const session = await generateSoundtrackVersions(id, { force, topN });
    return Response.json(session);
  } catch (error) {
    if (error instanceof SoundtrackError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const session = await getLatestSoundtrackSession(id);
    if (!session) {
      return Response.json({ error: "no soundtrack session found" }, { status: 404 });
    }
    return Response.json(session);
  } catch (error) {
    if (error instanceof SoundtrackError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
