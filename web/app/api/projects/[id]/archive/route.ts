import { FilmError, getProjectArchive } from "@marryo/services/films";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Retained videos after (or during) the edit session: ungraded, graded, selected. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const archive = await getProjectArchive(id);
    if (!archive) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }
    return Response.json(archive);
  } catch (error) {
    if (error instanceof FilmError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
