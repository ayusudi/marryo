/**
 * Check the ADK agent service is reachable, directly and optionally through the Next.js
 * API route, so a failure points at the right layer.
 *
 *   npm run ping:agent
 *   npm run ping:agent -- --web   # also go through http://localhost:3100
 */
import { pingAgent } from "../services/src/agent.ts";

const AGENT_APP = "marryo_agent";

const direct = await pingAgent();

if (!direct.ok) {
  console.error(`Agent service unreachable at ${direct.target}: ${direct.error}`);
  console.error("Start it with: npm run agent:dev");
  process.exit(1);
}

const apps = direct.apps ?? [];
if (!apps.includes(AGENT_APP)) {
  console.error(`Agent service is up at ${direct.target} but "${AGENT_APP}" is not loaded. Serving: ${apps.join(", ") || "nothing"}`);
  process.exit(1);
}

console.log(`Agent service up and serving "${AGENT_APP}".`);

if (process.argv.includes("--web")) {
  const webUrl = process.env.WEB_URL ?? "http://localhost:3100";
  try {
    const response = await fetch(`${webUrl}/api/agent/ping`, { signal: AbortSignal.timeout(10_000) });
    const body: unknown = await response.json();
    if (!response.ok) {
      console.error(`Next.js API route returned ${response.status}: ${JSON.stringify(body)}`);
      process.exit(1);
    }
    console.log(`Next.js API route reached the agent: ${JSON.stringify(body)}`);
  } catch (error) {
    console.error(`Could not reach ${webUrl}: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Start it with: npm run dev");
    process.exit(1);
  }
}
