import { FilmError, getProjectFilm } from "@marryo/services/films";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Latest finished film for a project (fresh signed playback URL). */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const film = await getProjectFilm(id);
    if (!film) {
      return Response.json({ error: "no finished film — select a soundtrack first" }, { status: 404 });
    }
    return Response.json(film);
  } catch (error) {
    if (error instanceof FilmError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
