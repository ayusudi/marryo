import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

/** Bump when Prisma models change so HMR drops a stale client without new delegates. */
const PRISMA_CLIENT_REV = 5;

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? "file:dev.db";
  if (!raw.startsWith("file:")) return raw;

  const filePath = raw.slice("file:".length);
  if (path.isAbsolute(filePath)) return raw;

  // Match Prisma CLI: relative SQLite paths are resolved from the schema directory.
  const schemaDir = path.join(repoRoot(), "prisma");
  const absolute = path.resolve(schemaDir, filePath);
  return pathToFileURL(absolute).href;
}

const globalForPrisma = globalThis as typeof globalThis & {
  __marryoPrisma?: PrismaClient;
  __marryoPrismaRev?: number;
};

function clientLooksCurrent(client: PrismaClient): boolean {
  // After schema adds models, an HMR-cached client can lack delegates.
  const c = client as PrismaClient & {
    person?: { deleteMany?: unknown };
    clipPerson?: { deleteMany?: unknown };
    editDecision?: { create?: unknown };
    render?: { create?: unknown };
    soundtrackSession?: { create?: unknown };
    soundtrackVersion?: { create?: unknown };
    film?: { create?: unknown };
    user?: { findUnique?: unknown };
  };
  return (
    typeof c.person?.deleteMany === "function" &&
    typeof c.clipPerson?.deleteMany === "function" &&
    typeof c.editDecision?.create === "function" &&
    typeof c.render?.create === "function" &&
    typeof c.soundtrackSession?.create === "function" &&
    typeof c.soundtrackVersion?.create === "function" &&
    typeof c.film?.create === "function" &&
    typeof c.user?.findUnique === "function"
  );
}

/** Shared Prisma client (SQLite in Phase 1). Avoids exhausting connections in Next.js HMR. */
export function prisma(): PrismaClient {
  process.env.DATABASE_URL = resolveDatabaseUrl();
  const existing = globalForPrisma.__marryoPrisma;
  const revOk = globalForPrisma.__marryoPrismaRev === PRISMA_CLIENT_REV;
  if (existing && revOk && clientLooksCurrent(existing)) {
    return existing;
  }
  if (existing) {
    void existing.$disconnect().catch(() => undefined);
  }
  const client = new PrismaClient();
  if (!clientLooksCurrent(client)) {
    void client.$disconnect().catch(() => undefined);
    throw new Error(
      "Prisma client is out of date (missing User model). Restart the Next.js server after running npm run db:generate.",
    );
  }
  globalForPrisma.__marryoPrisma = client;
  globalForPrisma.__marryoPrismaRev = PRISMA_CLIENT_REV;
  return client;
}
