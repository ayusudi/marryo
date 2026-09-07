import { endEditingSession, FilmError } from "@marryo/services/films";
import { applyGradePreference, SoundtrackError } from "@marryo/services/soundtrack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm color grade preference, end the editing session, and retain only:
 * ungraded picture, graded mute picture, and the user's selected film.
 * Body: `{ use_grade?: boolean }` — default true (keep graded look).
 * `use_grade: false` rebuilds the selection on the ungraded twin first.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  let useGrade = true;
  try {
    const body = (await request.json()) as { use_grade?: unknown };
    if (typeof body?.use_grade === "boolean") useGrade = body.use_grade;
  } catch {
    /* empty body → keep graded */
  }

  try {
    await applyGradePreference(id, useGrade);
    const archive = await endEditingSession(id);
    return Response.json({
      ok: true,
      current_stage: "complete",
      use_grade: useGrade,
      session_ended_at: archive.session_ended_at,
      archive,
    });
  } catch (error) {
    if (error instanceof FilmError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SoundtrackError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
