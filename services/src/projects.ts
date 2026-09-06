/**
 * Project + clip persistence (Prisma/SQLite) and API-facing shapes.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { prisma } from "./db.ts";
import { env } from "./env.ts";

export const projectStatuses = [
  "draft",
  "uploading",
  "validating",
  "analysing",
  "directing",
  "rendering",
  "ready",
  "failed",
] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const projectStages = [
  "upload",
  "validated",
  "identifying",
  "identity",
  "analysing",
  "directing",
  "rendering",
  "soundtrack",
  "grading",
  "complete",
] as const;
export type ProjectStage = (typeof projectStages)[number];

export const clipStatuses = ["uploaded", "rejected", "analysed"] as const;
export type ClipStatus = (typeof clipStatuses)[number];

export const filmOrientations = ["landscape", "portrait"] as const;
export type FilmOrientation = (typeof filmOrientations)[number];

export const filmOrientationSchema = z.enum(filmOrientations);

export const coupleNameRole = z.enum(["bride", "groom"]);
export type CoupleNameRole = z.infer<typeof coupleNameRole>;

export const coupleNameEntry = z.object({
  name: z.string().trim().min(1),
  role: coupleNameRole,
});
export type CoupleNameEntry = z.infer<typeof coupleNameEntry>;

export const coupleNamesSchema = z
  .array(coupleNameEntry)
  .min(1)
  .max(2)
  .superRefine((entries, ctx) => {
    const roles = entries.map((e) => e.role);
    if (new Set(roles).size !== roles.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "couple_names roles must be unique when both present",
      });
    }
  });

export const createProjectInput = z.object({
  couple_names: coupleNamesSchema,
  wedding_date: z.string().trim().min(1).optional(),
  story: z.string().optional(),
  max_duration: z.number().int().positive().max(600).optional(),
  mood: z.string().trim().min(1).optional(),
  visual_tone: z.string().trim().min(1).optional(),
  ending_message: z.string().optional(),
  orientation: filmOrientationSchema.optional(),
  /** Set by API from authenticated session — not trusted from the browser body. */
  owner_id: z.string().trim().min(1).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const updateProjectInput = z
  .object({
    orientation: filmOrientationSchema.optional(),
  })
  .refine((v) => v.orientation !== undefined, {
    message: "at least one field is required",
  });
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

export class ProjectUpdateError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "ProjectUpdateError";
    this.status = status;
  }
}
export const validationMetricsSchema = z.object({
  brightness: z.number(),
  blur: z.number(),
  faceCount: z.number().int(),
});

export const validationCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  score: z.number(),
  unit: z.string().optional(),
  threshold: z.string().optional(),
  reason: z.string(),
  detail: z.string().optional(),
  implication: z.string().optional(),
});

export const validationWarningsSchema = z.object({
  warnings: z.array(z.string()),
  metrics: validationMetricsSchema,
  checks: z.array(validationCheckSchema).optional(),
  summary: z.string().optional(),
  verdict_detail: z.string().optional(),
  frames_sampled: z.number().int().optional(),
});
export type ValidationCheck = z.infer<typeof validationCheckSchema>;
export type ValidationWarnings = z.infer<typeof validationWarningsSchema>;

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** Normalize DB JSON: new `{name,role}` objects, or legacy bare strings (first→bride, second→groom). */
function parseCoupleNames(raw: string): CoupleNameEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2) {
    throw new Error("corrupt couple_names in database");
  }

  if (parsed.every((n) => typeof n === "string")) {
    const legacyRoles: CoupleNameRole[] = ["bride", "groom"];
    return (parsed as string[]).map((name, i) => ({
      name,
      role: legacyRoles[i]!,
    }));
  }

  const result = coupleNamesSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("corrupt couple_names in database");
  }
  return result.data;
}

function parseValidationWarnings(raw: string | null): ValidationWarnings | null {
  if (!raw) return null;
  return validationWarningsSchema.parse(JSON.parse(raw));
}

export type ApiProject = {
  project_id: string;
  owner_id: string | null;
  couple_names: CoupleNameEntry[];
  wedding_date: string | null;
  story: string | null;
  max_duration: number;
  mood: string | null;
  visual_tone: string | null;
  ending_message: string | null;
  orientation: FilmOrientation;
  status: string;
  current_stage: string;
  bride_person_id: string | null;
  groom_person_id: string | null;
  session_ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiClip = {
  clip_id: string;
  project_id: string;
  filename: string;
  storage_uri: string | null;
  duration: number | null;
  uploaded_at: string;
  status: string;
  valid: boolean | null;
  validation_warnings: ValidationWarnings | null;
  thumbnail_uri?: string | null;
  thumbnail_url?: string;
  playback_url?: string;
};

function normalizeOrientation(raw: string | null | undefined): FilmOrientation {
  return raw === "portrait" ? "portrait" : "landscape";
}

function toApiProject(row: {
  projectId: string;
  ownerId: string | null;
  coupleNames: string;
  weddingDate: string | null;
  story: string | null;
  maxDuration: number;
  mood: string | null;
  visualTone: string | null;
  endingMessage: string | null;
  orientation?: string | null;
  status: string;
  currentStage: string;
  bridePersonId: string | null;
  groomPersonId: string | null;
  sessionEndedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ApiProject {
  return {
    project_id: row.projectId,
    owner_id: row.ownerId,
    couple_names: parseCoupleNames(row.coupleNames),
    wedding_date: row.weddingDate,
    story: row.story,
    max_duration: row.maxDuration,
    mood: row.mood,
    visual_tone: row.visualTone,
    ending_message: row.endingMessage,
    orientation: normalizeOrientation(row.orientation),
    status: row.status,
    current_stage: row.currentStage,
    bride_person_id: row.bridePersonId,
    groom_person_id: row.groomPersonId,
    session_ended_at: row.sessionEndedAt ? row.sessionEndedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toApiClip(row: {
  clipId: string;
  projectId: string;
  filename: string;
  storageUri: string | null;
  duration: number | null;
  uploadedAt: Date;
  status: string;
  valid: boolean | null;
  validationWarnings: string | null;
  thumbnailUri?: string | null;
}): ApiClip {
  return {
    clip_id: row.clipId,
    project_id: row.projectId,
    filename: row.filename,
    storage_uri: row.storageUri,
    duration: row.duration,
    uploaded_at: row.uploadedAt.toISOString(),
    status: row.status,
    valid: row.valid,
    validation_warnings: parseValidationWarnings(row.validationWarnings),
    thumbnail_uri: row.thumbnailUri ?? null,
  };
}

async function withClipMedia(clip: ApiClip, expiresInSeconds = 3600): Promise<ApiClip> {
  try {
    const { storageService } = await import("./storage-service.ts");
    const storage = storageService();
    let playback_url: string | undefined;
    let thumbnail_url: string | undefined;
    if (clip.storage_uri) {
      try {
        playback_url = await storage.getSignedUrl(clip.storage_uri, expiresInSeconds);
      } catch {
        playback_url = undefined;
      }
    }
    if (clip.thumbnail_uri) {
      try {
        thumbnail_url = await storage.getSignedUrl(clip.thumbnail_uri, expiresInSeconds);
      } catch {
        thumbnail_url = undefined;
      }
    }
    return { ...clip, playback_url, thumbnail_url };
  } catch {
    return clip;
  }
}

export interface UploadLimits {
  maxClipBytes: number;
  maxClipSizeMb: number;
  maxClipsPerProject: number;
}

export function uploadLimits(): UploadLimits {
  const config = env();
  return {
    maxClipBytes: config.MAX_CLIP_SIZE_MB * 1024 * 1024,
    maxClipSizeMb: config.MAX_CLIP_SIZE_MB,
    maxClipsPerProject: config.MAX_CLIPS_PER_PROJECT,
  };
}

export async function createProject(input: CreateProjectInput): Promise<ApiProject> {
  const row = await prisma().project.create({
    data: {
      projectId: newId("prj"),
      ownerId: input.owner_id ?? null,
      coupleNames: JSON.stringify(input.couple_names),
      weddingDate: input.wedding_date ?? null,
      story: input.story ?? null,
      maxDuration: input.max_duration ?? 90,
      mood: input.mood ?? null,
      visualTone: input.visual_tone ?? null,
      endingMessage: input.ending_message ?? null,
      orientation: input.orientation ?? "portrait",
      status: "draft",
      currentStage: "upload",
    },
  });
  return toApiProject(row);
}

export type ApiProjectSummary = ApiProject & {
  clip_count: number;
  valid_clip_count: number;
  film_title: string | null;
  film_track_title: string | null;
};

/** Projects owned by this user, newest first. */
export async function listProjectsForOwner(ownerId: string): Promise<ApiProjectSummary[]> {
  const rows = await prisma().project.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    include: {
      clips: { select: { valid: true } },
      films: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { title: true, trackTitle: true, coupleLabel: true },
      },
    },
  });

  return rows.map((row) => {
    const base = toApiProject(row);
    const film = row.films[0];
    return {
      ...base,
      clip_count: row.clips.length,
      valid_clip_count: row.clips.filter((c) => c.valid === true).length,
      film_title: film?.title ?? film?.coupleLabel ?? null,
      film_track_title: film?.trackTitle ?? null,
    };
  });
}

/**
 * Update project creative settings. Orientation may change anytime except while
 * a render is actively in progress (in-flight job keeps its snapshot).
 */
export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<ApiProject> {
  const existing = await prisma().project.findUnique({ where: { projectId } });
  if (!existing) {
    throw new ProjectUpdateError("project not found", 404);
  }
  if (existing.status === "rendering") {
    throw new ProjectUpdateError("cannot update orientation while a render is in progress", 409);
  }

  const row = await prisma().project.update({
    where: { projectId },
    data: {
      ...(input.orientation ? { orientation: input.orientation } : {}),
    },
  });
  return toApiProject(row);
}

export async function getProject(projectId: string): Promise<(ApiProject & { clips: ApiClip[] }) | null> {
  const row = await prisma().project.findUnique({
    where: { projectId },
    include: { clips: { orderBy: { uploadedAt: "asc" } } },
  });
  if (!row) return null;
  const clips = await Promise.all(row.clips.map((c) => withClipMedia(toApiClip(c))));
  return { ...toApiProject(row), clips };
}

export async function getProjectStatus(
  projectId: string,
): Promise<{ status: string; current_stage: string; stage_message: string | null } | null> {
  const row = await prisma().project.findUnique({
    where: { projectId },
    select: { status: true, currentStage: true, stageMessage: true },
  });
  if (!row) return null;
  return {
    status: row.status,
    current_stage: row.currentStage,
    stage_message: row.stageMessage,
  };
}

export async function setProjectStage(projectId: string, currentStage: ProjectStage): Promise<void> {
  await prisma().project.update({
    where: { projectId },
    data: { currentStage },
  });
}

export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus,
  currentStage?: ProjectStage,
): Promise<void> {
  await prisma().project.update({
    where: { projectId },
    data: {
      status,
      ...(currentStage ? { currentStage } : {}),
    },
  });
}

export async function countClips(projectId: string): Promise<number> {
  return prisma().clip.count({ where: { projectId } });
}

export async function createClip(input: {
  projectId: string;
  filename: string;
  storageUri: string | null;
  duration: number | null;
  status: ClipStatus;
  valid: boolean | null;
  validationWarnings: ValidationWarnings | null;
  clipId?: string;
  thumbnailUri?: string | null;
}): Promise<ApiClip> {
  const row = await prisma().clip.create({
    data: {
      clipId: input.clipId ?? newId("clp"),
      projectId: input.projectId,
      filename: input.filename,
      storageUri: input.storageUri,
      duration: input.duration,
      status: input.status,
      valid: input.valid,
      validationWarnings: input.validationWarnings
        ? JSON.stringify(input.validationWarnings)
        : null,
      thumbnailUri: input.thumbnailUri ?? null,
    },
  });
  return withClipMedia(toApiClip(row));
}

export async function getClip(projectId: string, clipId: string): Promise<ApiClip | null> {
  const row = await prisma().clip.findFirst({ where: { projectId, clipId } });
  return row ? withClipMedia(toApiClip(row)) : null;
}

export async function deleteClip(projectId: string, clipId: string): Promise<ApiClip | null> {
  const existing = await getClip(projectId, clipId);
  if (!existing) return null;
  await prisma().clip.delete({ where: { clipId } });
  return existing;
}

export class ProjectDeleteError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectDeleteError";
    this.status = status;
  }
}

/** Permanently delete a project (cascades clips, films, renders, etc.). */
export async function deleteProject(
  projectId: string,
  opts?: { ownerId?: string },
): Promise<void> {
  const db = prisma();
  const row = await db.project.findUnique({
    where: { projectId },
    select: { projectId: true, ownerId: true },
  });
  if (!row) {
    throw new ProjectDeleteError("project not found", 404);
  }
  if (opts?.ownerId) {
    if (row.ownerId && row.ownerId !== opts.ownerId) {
      throw new ProjectDeleteError("forbidden", 403);
    }
  }
  await db.project.delete({ where: { projectId } });
}
