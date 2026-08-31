import { pingAgent } from "@marryo/services/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await pingAgent();

  return Response.json(result, { status: result.ok ? 200 : 503 });
}
