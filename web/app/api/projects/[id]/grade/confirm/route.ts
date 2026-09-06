import { endEditingSession, FilmError } from "@marryo/services/films";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm color grade, end the editing session, and retain only:
 * ungraded picture, graded mute picture, and the user's selected film.
 * Uploaded clips and non-selected soundtrack remuxes are deleted.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const archive = await endEditingSession(id);
    return Response.json({
      ok: true,
      current_stage: "complete",
      session_ended_at: archive.session_ended_at,
      archive,
    });
  } catch (error) {
    if (error instanceof FilmError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
