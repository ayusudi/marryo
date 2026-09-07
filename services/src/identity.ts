/**
 * Face identity clustering bridge: spawn Python CV, persist Person + ClipPerson rows.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { z } from "zod";

import { prisma } from "./db.ts";
import { env } from "./env.ts";
import { setProjectStage } from "./projects.ts";
import { identityThumbPath } from "./storage.ts";
import { materializeCachedClip } from "./clip-cache.ts";
import { storageService } from "./storage-service.ts";

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

function pythonBin(): string {
  const configured = env().PYTHON_BIN;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

const personResultSchema = z.object({
  personId: z.string(),
  thumbnailUris: z.array(z.string()),
  clipIds: z.array(z.string()),
  faceCount: z.number().int().nonnegative(),
});

const identityCliSchema = z.object({
  persons: z.array(personResultSchema),
  warnings: z.array(z.string()).default([]),
  error: z.string().optional(),
});

export type ApiPerson = {
  person_id: string;
  thumbnail_uris: string[];
  clip_ids: string[];
  face_count: number;
};

const optionalPersonId = z
  .union([z.string().min(1), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

export const confirmIdentityInput = z
  .object({
    bride_person_id: optionalPersonId,
    groom_person_id: optionalPersonId,
  })
  .superRefine((value, ctx) => {
    const bride = value.bride_person_id;
    const groom = value.groom_person_id;
    // Bride/groom labels are optional — both null advances past People for an anonymous cut.
    if (bride !== null && groom !== null && bride === groom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bride_person_id and groom_person_id must be different",
        path: ["groom_person_id"],
      });
    }
  });
export type ConfirmIdentityInput = z.infer<typeof confirmIdentityInput>;

export class IdentityError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "IdentityError";
    this.status = status;
  }
}

async function runIdentityCli(manifestPath: string): Promise<z.infer<typeof identityCliSchema>> {
  const python = pythonBin();
  const args = ["-m", "cv.identity_cli", "--manifest", manifestPath];

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
    throw new IdentityError(
      `identity clustering failed (exit ${code}): ${stderr.trim() || stdout.trim() || "no output"}`,
      500,
    );
  }

  return identityCliSchema.parse(JSON.parse(stdout));
}

/**
 * Cluster faces across valid clips, replace prior persons for the project, return clusters.
 */
export async function identifyProject(projectId: string): Promise<{
  persons: ApiPerson[];
  warnings: string[];
}> {
  const project = await prisma().project.findUnique({
    where: { projectId },
    include: { clips: true },
  });
  if (!project) {
    throw new IdentityError("project not found", 404);
  }

  const validClips = project.clips.filter((c) => c.valid === true && c.storageUri);
  if (validClips.length === 0) {
    throw new IdentityError("no valid clips to identify — upload and validate footage first", 400);
  }

  const storage = storageService();
  const workDir = await mkdtemp(path.join(tmpdir(), "marryo-identity-"));
  const thumbsDir = path.join(workDir, "thumbs");
  const manifestPath = path.join(workDir, "manifest.json");

  try {
    const clips = await Promise.all(
      validClips.map(async (c) => ({
        clip_id: c.clipId,
        path: await materializeCachedClip(storage, projectId, c.storageUri!, c.clipId),
      })),
    );

    await writeFile(manifestPath, JSON.stringify({ clips, thumbs_dir: thumbsDir }), "utf8");
    const result = await runIdentityCli(manifestPath);

    // Clear previous identity graph (ClipPerson rows cascade from Person).
    // Use sequential ops — avoids interactive-tx proxies that can go stale
    // after `prisma generate` while Next keeps a cached PrismaClient.
    const db = prisma();
    if (typeof db.person?.deleteMany !== "function") {
      throw new IdentityError(
        "Prisma client is missing Person model — run `npm run db:generate` and restart the Next.js server",
        500,
      );
    }
    await db.person.deleteMany({ where: { projectId } });
    await db.project.update({
      where: { projectId },
      data: { bridePersonId: null, groomPersonId: null },
    });

    const persons: ApiPerson[] = [];

    for (const person of result.persons) {
      const storedThumbs: string[] = [];
      for (const [idx, relative] of person.thumbnailUris.entries()) {
        const abs = path.join(thumbsDir, relative);
        const bytes = await readFile(abs);
        const filename = path.basename(relative) || `thumb-${idx}.jpg`;
        const uploaded = await storage.upload({
          objectPath: identityThumbPath(projectId, person.personId, filename),
          body: bytes,
          contentType: "image/jpeg",
        });
        storedThumbs.push(uploaded.storageUri);
      }

      await prisma().person.create({
        data: {
          personId: person.personId,
          projectId,
          thumbnailUris: JSON.stringify(storedThumbs),
          faceCount: person.faceCount,
        },
      });

      for (const clipId of person.clipIds) {
        // Skip associations for clip ids that aren't in this project (defensive)
        if (!validClips.some((c) => c.clipId === clipId)) continue;
        await prisma().clipPerson.create({
          data: {
            id: newId("cp"),
            clipId,
            personId: person.personId,
          },
        });
      }

      persons.push({
        person_id: person.personId,
        thumbnail_uris: storedThumbs,
        clip_ids: person.clipIds,
        face_count: person.faceCount,
      });
    }

    await setProjectStage(projectId, "identifying");

    return { persons, warnings: result.warnings };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function confirmIdentity(
  projectId: string,
  input: ConfirmIdentityInput,
): Promise<{
  project_id: string;
  bride_person_id: string | null;
  groom_person_id: string | null;
  current_stage: string;
}> {
  const bridePersonId = input.bride_person_id ?? null;
  const groomPersonId = input.groom_person_id ?? null;

  const project = await prisma().project.findUnique({ where: { projectId } });
  if (!project) {
    throw new IdentityError("project not found", 404);
  }

  const requested = [bridePersonId, groomPersonId].filter((id): id is string => id !== null);
  const people = await prisma().person.findMany({
    where: {
      projectId,
      personId: { in: requested },
    },
  });
  const ids = new Set(people.map((p) => p.personId));
  if (bridePersonId !== null && !ids.has(bridePersonId)) {
    throw new IdentityError(`bride_person_id not found on this project: ${bridePersonId}`, 400);
  }
  if (groomPersonId !== null && !ids.has(groomPersonId)) {
    throw new IdentityError(`groom_person_id not found on this project: ${groomPersonId}`, 400);
  }

  const updated = await prisma().project.update({
    where: { projectId },
    data: {
      bridePersonId,
      groomPersonId,
      currentStage: "identity",
    },
  });

  return {
    project_id: updated.projectId,
    bride_person_id: updated.bridePersonId,
    groom_person_id: updated.groomPersonId,
    current_stage: updated.currentStage,
  };
}

/**
 * Resolve a stored person thumbnail to bytes for HTTP streaming.
 */
export async function readPersonThumbnail(
  projectId: string,
  personId: string,
  index: number,
): Promise<Buffer> {
  if (!Number.isInteger(index) || index < 0) {
    throw new IdentityError("thumbnail index must be a non-negative integer", 400);
  }

  const person = await prisma().person.findFirst({
    where: { projectId, personId },
  });
  if (!person) {
    throw new IdentityError("person not found", 404);
  }

  const uris = JSON.parse(person.thumbnailUris) as string[];
  if (index >= uris.length) {
    throw new IdentityError(`thumbnail index out of range (0..${Math.max(0, uris.length - 1)})`, 404);
  }

  const storageUri = uris[index]!;
  try {
    return await storageService().readBytes(storageUri);
  } catch (error) {
    throw new IdentityError(
      error instanceof Error ? error.message : `failed to read thumbnail: ${storageUri}`,
      404,
    );
  }
}

/** @deprecated Prefer readPersonThumbnail — kept for any local-path callers. */
export async function resolvePersonThumbnail(
  projectId: string,
  personId: string,
  index: number,
): Promise<string> {
  if (!Number.isInteger(index) || index < 0) {
    throw new IdentityError("thumbnail index must be a non-negative integer", 400);
  }

  const person = await prisma().person.findFirst({
    where: { projectId, personId },
  });
  if (!person) {
    throw new IdentityError("person not found", 404);
  }

  const uris = JSON.parse(person.thumbnailUris) as string[];
  if (index >= uris.length) {
    throw new IdentityError(`thumbnail index out of range (0..${Math.max(0, uris.length - 1)})`, 404);
  }

  const storageUri = uris[index]!;
  try {
    return await storageService().materializeLocal(storageUri);
  } catch (error) {
    throw new IdentityError(
      error instanceof Error ? error.message : `failed to resolve thumbnail: ${storageUri}`,
      404,
    );
  }
}

export async function listPersons(projectId: string): Promise<ApiPerson[]> {
  const rows = await prisma().person.findMany({
    where: { projectId },
    include: { clipPersons: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    person_id: row.personId,
    thumbnail_uris: JSON.parse(row.thumbnailUris) as string[],
    clip_ids: row.clipPersons.map((cp) => cp.clipId),
    face_count: row.faceCount,
  }));
}
