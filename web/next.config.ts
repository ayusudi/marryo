import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));
// Prefer the config file's parent (repo root). Fall back to cwd/.. when the
// config is evaluated from a temp compile path that is not web/.
const repoRoot =
  path.basename(configDir) === "web"
    ? path.resolve(configDir, "..")
    : path.resolve(process.cwd(), "..");

// Next already called loadEnvConfig(web/) before evaluating this file and
// caches that empty result. Force a reload from the monorepo root so route
// handlers see the shared .env (same file the CLI scripts and ADK use).
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", console, true);

const nextConfig: NextConfig = {
  // @marryo/services ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@marryo/services"],
  outputFileTracingRoot: repoRoot,
  serverExternalPackages: ["@clickhouse/client", "@google-cloud/storage"],
};

export default nextConfig;
