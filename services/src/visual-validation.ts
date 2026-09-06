/**
 * Bridge to the Python visual validator (agent/cv).
 */

import { spawn } from "node:child_process";
import path from "node:path";

import { env } from "./env.ts";
import { validationWarningsSchema, type ValidationWarnings } from "./projects.ts";

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

function pythonBin(): string {
  const configured = env().PYTHON_BIN;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

export async function runVisualValidation(
  absolutePath: string,
  frameCount = 8,
): Promise<ValidationWarnings & { valid: boolean }> {
  const python = pythonBin();
  const args = ["-m", "cv.validate_cli", absolutePath, "--frames", String(frameCount)];

  const { stdout, stderr, code } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: path.join(repoRoot(), "agent"),
      env: { ...process.env, PYTHONPATH: path.join(repoRoot(), "agent") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ stdout: out, stderr: err, code: exitCode }));
  });

  if (code !== 0) {
    throw new Error(`visual validation failed (exit ${code}): ${stderr.trim() || stdout.trim() || "no output"}`);
  }

  const parsed = JSON.parse(stdout) as { valid: boolean; warnings: string[]; metrics: ValidationWarnings["metrics"] };
  const warnings = validationWarningsSchema.parse({
    warnings: parsed.warnings,
    metrics: parsed.metrics,
  });
  return { valid: Boolean(parsed.valid), ...warnings };
}
