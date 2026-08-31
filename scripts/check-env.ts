/**
 * Report which subsystems are configured. Prints variable names, never values.
 *
 *   npm run check:env
 */
import { describeEnv, env } from "../services/src/env.ts";

const config = env();
const subsystems = describeEnv();

console.log("Marryo environment\n");
console.log(`  Gemini via     ${config.GOOGLE_GENAI_USE_VERTEXAI ? "Vertex AI (gcloud credentials)" : "AI Studio (GEMINI_API_KEY)"}`);
console.log(`  Region         ${config.GOOGLE_CLOUD_LOCATION}`);
console.log(`  Agent service  ${config.AGENT_SERVICE_URL}`);
console.log(`  Upload limits  ${config.MAX_CLIP_SIZE_MB} MB per clip, ${config.MAX_CLIPS_PER_PROJECT} clips per project`);
console.log("");

for (const { label, configured, missing } of subsystems) {
  const name = label.padEnd(26);
  console.log(configured ? `  [ok]      ${name} configured` : `  [missing] ${name} needs ${missing.join(", ")}`);
}

const unconfigured = subsystems.filter((s) => !s.configured);
console.log("");
console.log(
  unconfigured.length === 0
    ? "All subsystems configured."
    : `${unconfigured.length} subsystem(s) not configured yet. Fill them in .env as you reach each phase.`,
);
