/**
 * Google Cloud Storage path helpers and client wiring.
 * Object paths are relative; StorageService prefixes gs://{bucket}/ or local:.
 */

import { Storage, type Bucket } from "@google-cloud/storage";
import { existsSync } from "node:fs";
import path from "node:path";

import { env } from "./env.ts";

let storage: Storage | undefined;

function repoRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}web`) ? path.join(cwd, "..") : cwd;
}

function resolveCredentialsPath(configured: string): string {
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot(), configured);
}

export function isConfigured(): boolean {
  const config = env();
  return Boolean(config.GOOGLE_CLOUD_PROJECT && config.GOOGLE_CLOUD_STORAGE_BUCKET);
}

export function requireGcsConfigured(): void {
  if (!isConfigured()) {
    throw new Error(
      "not configured: GCS — set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_STORAGE_BUCKET (and ADC or GOOGLE_APPLICATION_CREDENTIALS)",
    );
  }
}

export function client(): Storage {
  requireGcsConfigured();
  if (!storage) {
    const config = env();
    const options: ConstructorParameters<typeof Storage>[0] = {
      projectId: config.GOOGLE_CLOUD_PROJECT,
    };
    if (config.GOOGLE_APPLICATION_CREDENTIALS) {
      const keyFilename = resolveCredentialsPath(config.GOOGLE_APPLICATION_CREDENTIALS);
      if (!existsSync(keyFilename)) {
        throw new Error(
          `not configured: GCS — GOOGLE_APPLICATION_CREDENTIALS file not found at ${keyFilename}. ` +
            "Fix the path, or unset it to use Application Default Credentials, or set STORAGE_BACKEND=local.",
        );
      }
      options.keyFilename = keyFilename;
    }
    storage = new Storage(options);
  }
  return storage;
}

export function bucket(): Bucket {
  requireGcsConfigured();
  return client().bucket(env().GOOGLE_CLOUD_STORAGE_BUCKET!);
}

export function bucketName(): string {
  requireGcsConfigured();
  return env().GOOGLE_CLOUD_STORAGE_BUCKET!;
}

/** Raw uploaded clip: projects/{projectId}/raw/{clipId}.{ext} */
export function rawClipPath(projectId: string, clipId: string, extension: string): string {
  const ext = extension.replace(/^\./, "");
  return `projects/${projectId}/raw/${clipId}.${ext}`;
}

/** Rendered film: projects/{projectId}/renders/{renderId}.mp4 */
export function renderPath(projectId: string, renderId: string): string {
  return `projects/${projectId}/renders/${renderId}.mp4`;
}

/** Ungraded twin of a render (before color grade). */
export function ungradedRenderPath(projectId: string, renderId: string): string {
  return `projects/${projectId}/renders/${renderId}.ungraded.mp4`;
}

/** Soundtrack remux version: projects/{projectId}/soundtracks/{sessionId}/{versionId}.mp4 */
export function soundtrackVersionPath(
  projectId: string,
  sessionId: string,
  versionId: string,
): string {
  return `projects/${projectId}/soundtracks/${sessionId}/${versionId}.mp4`;
}

/** Film poster JPEG: projects/{projectId}/films/{filmId}/poster.jpg */
export function filmPosterPath(projectId: string, filmId: string): string {
  return `projects/${projectId}/films/${filmId}/poster.jpg`;
}

/** Clip poster JPEG: projects/{projectId}/raw/{clipId}/poster.jpg */
export function clipPosterPath(projectId: string, clipId: string): string {
  return `projects/${projectId}/raw/${clipId}/poster.jpg`;
}

/** Identity thumbnail: projects/{projectId}/identity/{personId}/{filename} */
export function identityThumbPath(projectId: string, personId: string, filename: string): string {
  return `projects/${projectId}/identity/${personId}/${pathBasename(filename)}`;
}

function pathBasename(filename: string): string {
  const parts = filename.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "thumb.jpg";
}

export function gsUri(objectPath: string): string {
  return `gs://${bucketName()}/${objectPath.replace(/^\//, "")}`;
}

export function parseGsUri(storageUri: string): { bucket: string; objectPath: string } {
  if (!storageUri.startsWith("gs://")) {
    throw new Error(`not a gs:// URI: ${storageUri}`);
  }
  const without = storageUri.slice("gs://".length);
  const slash = without.indexOf("/");
  if (slash <= 0) {
    throw new Error(`invalid gs:// URI: ${storageUri}`);
  }
  return {
    bucket: without.slice(0, slash),
    objectPath: without.slice(slash + 1),
  };
}
