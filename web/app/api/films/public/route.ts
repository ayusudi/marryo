import { FilmError, listPublicFilms } from "@marryo/services/films";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public films for the landing gallery (visibility=public only). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 12;

  try {
    const films = await listPublicFilms(Number.isFinite(limit) ? limit : 12);
    return Response.json({ films });
  } catch (error) {
    if (error instanceof FilmError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
