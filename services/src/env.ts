/**
 * Server-side environment configuration.
 *
 * This module is the only place credentials are read. It refuses to load in a browser
 * bundle, and no variable is NEXT_PUBLIC_-prefixed, so secrets cannot reach client code.
 */

import { z } from "zod";

if (typeof globalThis === "object" && "window" in globalThis) {
  throw new Error(
    "@marryo/services/env was imported into client code. It reads credentials and must " +
      "stay server-side: move the import into a route handler or server component.",
  );
}

/** Treat an unset variable and an empty one (`FOO=`) as the same thing. */
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const withDefault = (fallback: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().default(fallback),
  );

const positiveInt = (fallback: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().positive().default(fallback),
  );

/** `0` and `false` turn Vertex AI off; anything else (including unset) leaves it on. */
const vertexFlag = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return true;
  return !(value === "0" || value === "false");
}, z.boolean());

const envSchema = z.object({
  GEMINI_API_KEY: optionalText,
  GOOGLE_GENAI_USE_VERTEXAI: vertexFlag,

  GOOGLE_CLOUD_PROJECT: optionalText,
  GOOGLE_CLOUD_LOCATION: withDefault("us-central1"),
  GOOGLE_CLOUD_STORAGE_BUCKET: optionalText,
  GOOGLE_APPLICATION_CREDENTIALS: optionalText,

  CLICKHOUSE_HOST: optionalText,
  CLICKHOUSE_PORT: positiveInt(8443),
  CLICKHOUSE_DATABASE: withDefault("marryo"),
  CLICKHOUSE_USER: optionalText,
  CLICKHOUSE_PASSWORD: optionalText,

  AGENT_ENGINE_ENDPOINT: optionalText,
  AGENT_SERVICE_URL: withDefault("http://127.0.0.1:8000"),

  MAX_CLIP_SIZE_MB: positiveInt(500),
  MAX_CLIPS_PER_PROJECT: positiveInt(30),
});

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;

let cached: Env | undefined;

/** Parse and cache the environment. Throws if a present value is malformed. */
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`invalid environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Subsystems and the variables each one needs before it can be used. */
export const envGroups = {
  gemini: {
    label: "Gemini via Vertex AI",
    keys: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
  },
  geminiApiKey: {
    label: "Gemini via AI Studio key",
    keys: ["GEMINI_API_KEY"],
  },
  storage: {
    label: "Cloud Storage",
    keys: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_STORAGE_BUCKET"],
  },
  clickhouse: {
    label: "ClickHouse",
    keys: ["CLICKHOUSE_HOST", "CLICKHOUSE_DATABASE", "CLICKHOUSE_USER", "CLICKHOUSE_PASSWORD"],
  },
  agent: {
    label: "ADK agent",
    keys: ["AGENT_SERVICE_URL"],
  },
} as const satisfies Record<string, { label: string; keys: readonly EnvKey[] }>;

export type EnvGroupName = keyof typeof envGroups;

export interface SubsystemStatus {
  subsystem: EnvGroupName;
  label: string;
  configured: boolean;
  /** Variables this subsystem needs that are neither set nor defaulted. */
  missing: EnvKey[];
}

/** Variables whose values must never be logged or returned over HTTP. */
const secretKeys = new Set<EnvKey>([
  "GEMINI_API_KEY",
  "CLICKHOUSE_PASSWORD",
  "GOOGLE_APPLICATION_CREDENTIALS",
]);

export function isSecret(key: EnvKey): boolean {
  return secretKeys.has(key);
}

/**
 * Report which variables are set, by name only. Safe to log or serve: it never includes
 * a value, secret or not.
 */
export function envPresence(): Record<EnvKey, boolean> {
  const keys = Object.keys(envSchema.shape) as EnvKey[];
  const present = {} as Record<EnvKey, boolean>;
  for (const key of keys) {
    const raw = process.env[key];
    present[key] = typeof raw === "string" && raw.trim() !== "";
  }
  return present;
}

/**
 * Which subsystems have everything they need, judged on presence alone. Safe to serve
 * over HTTP: the result names variables but never carries a value.
 */
export function describeEnv(): SubsystemStatus[] {
  const present = envPresence();
  const parsed = envSchema.safeParse(process.env);
  const defaults = parsed.success ? parsed.data : undefined;

  return (Object.keys(envGroups) as EnvGroupName[]).map((subsystem) => {
    const group = envGroups[subsystem];
    const missing = group.keys.filter((key) => {
      if (present[key]) return false;
      // A variable carrying a schema default counts as satisfied when unset.
      return defaults?.[key] === undefined;
    });
    return { subsystem, label: group.label, configured: missing.length === 0, missing };
  });
}
