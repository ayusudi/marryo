/**
 * Cursor / IDE tooling sometimes POSTs here against the page origin.
 * Not part of Marryo — acknowledge so the Network tab is not full of 404s.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  return new Response(null, { status: 204 });
}

export async function GET() {
  return new Response(null, { status: 204 });
}
