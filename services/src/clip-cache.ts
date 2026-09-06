/**
 * Shared on-disk cache for project clips so identify → scenes → direct → render
 * do not re-download the same GCS objects.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { StorageService } from "./storage-service.ts";

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

export function clipCacheRoot(): string {
  return path.resolve(repoRoot(), "tmp", "marryo-cache");
}

export function projectClipCacheDir(projectId: string): string {
  return path.join(clipCacheRoot(), projectId);
}

function cacheFileName(storageUri: string, clipId?: string): string {
  if (clipId && /^[a-zA-Z0-9_-]+$/.test(clipId)) {
    const ext = path.extname(storageUri.replace(/^local:/, "")) || ".mp4";
    return `${clipId}${ext}`;
  }
  const hash = createHash("sha1").update(storageUri).digest("hex").slice(0, 16);
  const base = path.basename(storageUri.replace(/^local:/, "").replace(/^gs:\/\//, "")) || "clip.mp4";
  const ext = path.extname(base) || ".mp4";
  return `${hash}${ext}`;
}

/** Materialize into the project cache when possible; reuse if already warm. */
export async function materializeCachedClip(
  storage: StorageService,
  projectId: string,
  storageUri: string,
  clipId?: string,
): Promise<string> {
  if (storageUri.startsWith("local:")) {
    return storage.materializeLocal(storageUri);
  }

  const dir = projectClipCacheDir(projectId);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, cacheFileName(storageUri, clipId));
  try {
    const st = await stat(dest);
    if (st.isFile() && st.size > 0) return dest;
  } catch {
    /* miss */
  }
  const downloaded = await storage.materializeLocal(storageUri, dir);
  if (path.resolve(downloaded) !== path.resolve(dest)) {
    try {
      await rename(downloaded, dest);
    } catch {
      await copyFile(downloaded, dest);
    }
  }
  return dest;
}

export async function clearProjectClipCache(projectId: string): Promise<void> {
  const dir = projectClipCacheDir(projectId);
  await rm(dir, { recursive: true, force: true });
}
