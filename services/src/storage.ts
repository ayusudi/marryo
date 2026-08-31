/**
 * Google Cloud Storage access for raw clips and rendered films.
 *
 * Phase 0 provides wiring only. Uploads are signed-URL based from a later phase: clips
 * run to hundreds of megabytes, so bytes go straight from the browser to the bucket and
 * never through the Next.js API layer.
 */

import { Storage, type Bucket } from "@google-cloud/storage";

import { env } from "./env.ts";

let storage: Storage | undefined;

export function isConfigured(): boolean {
  const config = env();
  return Boolean(config.GOOGLE_CLOUD_PROJECT && config.GOOGLE_CLOUD_STORAGE_BUCKET);
}

/**
 * The shared Storage client. Credentials come from Application Default Credentials
 * unless GOOGLE_APPLICATION_CREDENTIALS points at a service-account key file, which the
 * library picks up from the environment on its own.
 */
export function client(): Storage {
  if (!storage) {
    const config = env();
    storage = new Storage({ projectId: config.GOOGLE_CLOUD_PROJECT });
  }
  return storage;
}

export function bucket(): Bucket {
  const config = env();
  if (!config.GOOGLE_CLOUD_STORAGE_BUCKET) {
    throw new Error("GOOGLE_CLOUD_STORAGE_BUCKET is not set");
  }
  return client().bucket(config.GOOGLE_CLOUD_STORAGE_BUCKET);
}

/** Object path for a raw uploaded clip. */
export function rawClipPath(projectId: string, clipId: string, extension: string): string {
  return `projects/${projectId}/raw/${clipId}.${extension.replace(/^\./, "")}`;
}

/** Object path for a rendered film. */
export function renderPath(projectId: string, renderId: string): string {
  return `projects/${projectId}/renders/${renderId}.mp4`;
}
