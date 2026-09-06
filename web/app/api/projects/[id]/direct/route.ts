import { DirectorError, runFilmDirector } from "@marryo/services/film-director";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const result = await runFilmDirector(id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof DirectorError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "film director failed";
    console.error("[direct]", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
