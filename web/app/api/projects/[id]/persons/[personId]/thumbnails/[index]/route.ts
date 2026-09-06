import { IdentityError, readPersonThumbnail } from "@marryo/services/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; personId: string; index: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id: projectId, personId, index: indexRaw } = await params;
  const index = Number(indexRaw);
  if (!Number.isInteger(index)) {
    return Response.json({ error: "thumbnail index must be an integer" }, { status: 400 });
  }

  try {
    const bytes = await readPersonThumbnail(projectId, personId, index);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof IdentityError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
