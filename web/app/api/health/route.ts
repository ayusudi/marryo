import { describeEnv } from "@marryo/services/env";

export const dynamic = "force-dynamic";

export function GET() {
  const subsystems = describeEnv();

  return Response.json({
    ok: true,
    service: "marryo-web",
    phase: 6,
    // Variable names only - values are never returned over HTTP.
    subsystems,
    configured: subsystems.filter((s) => s.configured).map((s) => s.subsystem),
  });
}
