import { z } from "zod";

import { selectSoundtrack, SoundtrackError } from "@marryo/services/soundtrack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const selectSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("catalog"),
    version_id: z.string().min(1),
  }),
  z.object({
    mode: z.literal("mute"),
  }),
  z.object({
    mode: z.literal("original"),
  }),
]);

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = selectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const session = await selectSoundtrack(id, parsed.data);
    return Response.json(session);
  } catch (error) {
    if (error instanceof SoundtrackError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
