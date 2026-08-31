/**
 * Project domain model: a project is one couple's film, with the clips uploaded for it.
 *
 * Phase 0 defines the shapes and the upload limits. Persistence arrives with the
 * ClickHouse schema in a later phase.
 */

import { z } from "zod";

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

export const clipStatuses = ["pending", "uploaded", "rejected", "analysed"] as const;

export type ClipStatus = (typeof clipStatuses)[number];

export const projectSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  coupleNames: z.tuple([z.string(), z.string()]).optional(),
  status: z.enum(projectStatuses),
  createdAt: z.string(),
});

export type Project = z.infer<typeof projectSchema>;

export const clipSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  filename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative().optional(),
  status: z.enum(clipStatuses),
  rejectionReason: z.string().optional(),
});

export type Clip = z.infer<typeof clipSchema>;

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
