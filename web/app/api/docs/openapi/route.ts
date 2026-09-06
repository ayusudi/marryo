import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

/** Serve the OpenAPI YAML for Swagger UI. */
export async function GET() {
  const specPath = path.join(repoRoot(), "docs", "openapi.yaml");
  const yaml = await readFile(specPath, "utf8");
  return new Response(yaml, {
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
