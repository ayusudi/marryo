/**
 * Storage behind a stable interface.
 * Default: GCS when configured. Escape hatch: STORAGE_BACKEND=local.
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable as NodeReadable } from "node:stream";

import { env } from "./env.ts";
import {
  bucket,
  gsUri,
  isConfigured as gcsIsConfigured,
  parseGsUri,
  requireGcsConfigured,
} from "./storage.ts";

export interface StorageUploadInput {
  /** Object path relative to bucket / uploads root (no leading slash). */
  objectPath: string;
  body: Buffer | NodeReadable;
  contentType?: string;
}

export interface StorageUploadResult {
  storageUri: string;
  /** Local absolute path when the object is already on disk; empty for pure GCS uploads. */
  absolutePath: string;
}

export interface StorageService {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  getSignedUrl(storageUri: string, expiresInSeconds?: number): Promise<string>;
  /** Browser-direct PUT (GCS). Local backend throws. */
  getWriteSignedUrl?(
    objectPath: string,
    contentType: string,
    expiresInSeconds?: number,
  ): Promise<{ uploadUrl: string; storageUri: string }>;
  /** True when object exists (GCS) / file exists (local). */
  objectExists?(storageUri: string): Promise<boolean>;
  delete(storageUri: string): Promise<void>;
  /**
   * Ensure a local filesystem path for CV/ffprobe.
   * Local backend: resolvePath. GCS: download to targetDir (or a new temp file).
   */
  materializeLocal(storageUri: string, targetDir?: string): Promise<string>;
  /** Read object bytes (for thumbnail streaming, etc.). */
  readBytes(storageUri: string): Promise<Buffer>;
}

export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

const LOCAL_PREFIX = "local:";

function uploadsRoot(): string {
  const configured = env().UPLOADS_DIR;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(
        process.cwd().endsWith(`${path.sep}web`) ? path.join(process.cwd(), "..") : process.cwd(),
        configured,
      );
}

function assertSafeRelative(objectPath: string): string {
  const normalized = objectPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("..")) {
    throw new Error(`invalid object path: ${objectPath}`);
  }
  return normalized;
}

export class LocalStorageService implements StorageService {
  upload = async (input: StorageUploadInput): Promise<StorageUploadResult> => {
    const relative = assertSafeRelative(input.objectPath);
    const absolutePath = path.join(uploadsRoot(), relative);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    if (Buffer.isBuffer(input.body)) {
      await writeFile(absolutePath, input.body);
    } else {
      await pipeline(input.body, createWriteStream(absolutePath));
    }

    return { storageUri: `${LOCAL_PREFIX}${relative}`, absolutePath };
  };

  getSignedUrl = async (storageUri: string, _expiresInSeconds = 3600): Promise<string> => {
    const absolute = this.#resolveLocal(storageUri);
    if (!existsSync(absolute)) {
      throw new Error(`object not found: ${storageUri}`);
    }
    return `file://${absolute}`;
  };

  objectExists = async (storageUri: string): Promise<boolean> => {
    try {
      return existsSync(this.#resolveLocal(storageUri));
    } catch {
      return false;
    }
  };

  delete = async (storageUri: string): Promise<void> => {
    const absolute = this.#resolveLocal(storageUri);
    try {
      await unlink(absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  };

  materializeLocal = async (storageUri: string, _targetDir?: string): Promise<string> =>
    this.#resolveLocal(storageUri);

  readBytes = async (storageUri: string): Promise<Buffer> => readFile(this.#resolveLocal(storageUri));

  #resolveLocal(storageUri: string): string {
    if (!storageUri.startsWith(LOCAL_PREFIX)) {
      throw new Error(`unsupported storage uri scheme for local backend: ${storageUri}`);
    }
    const relative = assertSafeRelative(storageUri.slice(LOCAL_PREFIX.length));
    const absolute = path.resolve(uploadsRoot(), relative);
    const root = path.resolve(uploadsRoot());
    if (!absolute.startsWith(root + path.sep) && absolute !== root) {
      throw new Error("path escape blocked");
    }
    return absolute;
  }
}

export class GcsStorageService implements StorageService {
  upload = async (input: StorageUploadInput): Promise<StorageUploadResult> => {
    requireGcsConfigured();
    const objectPath = assertSafeRelative(input.objectPath);
    const file = bucket().file(objectPath);

    if (Buffer.isBuffer(input.body)) {
      await file.save(input.body, {
        resumable: false,
        contentType: input.contentType ?? "application/octet-stream",
        validation: false,
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        const write = file.createWriteStream({
          resumable: true,
          contentType: input.contentType ?? "application/octet-stream",
        });
        write.on("error", reject);
        write.on("finish", () => resolve());
        (input.body as NodeReadable).pipe(write);
      });
    }

    return { storageUri: gsUri(objectPath), absolutePath: "" };
  };

  getSignedUrl = async (storageUri: string, expiresInSeconds = 900): Promise<string> => {
    requireGcsConfigured();
    const { bucket: bkt, objectPath } = parseGsUri(storageUri);
    if (bkt !== env().GOOGLE_CLOUD_STORAGE_BUCKET) {
      throw new Error(`storage uri bucket mismatch: ${bkt}`);
    }
    const [url] = await bucket()
      .file(objectPath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expiresInSeconds * 1000,
      });
    return url;
  };

  getWriteSignedUrl = async (
    objectPath: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<{ uploadUrl: string; storageUri: string }> => {
    requireGcsConfigured();
    const relative = assertSafeRelative(objectPath);
    const [uploadUrl] = await bucket()
      .file(relative)
      .getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + expiresInSeconds * 1000,
        contentType: contentType || "application/octet-stream",
      });
    return { uploadUrl, storageUri: gsUri(relative) };
  };

  objectExists = async (storageUri: string): Promise<boolean> => {
    requireGcsConfigured();
    const { objectPath } = parseGsUri(storageUri);
    const [exists] = await bucket().file(objectPath).exists();
    return exists;
  };

  delete = async (storageUri: string): Promise<void> => {
    requireGcsConfigured();
    const { objectPath } = parseGsUri(storageUri);
    try {
      await bucket().file(objectPath).delete({ ignoreNotFound: true });
    } catch (error) {
      throw new Error(
        `failed to delete GCS object: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  materializeLocal = async (storageUri: string, targetDir?: string): Promise<string> => {
    requireGcsConfigured();
    const { objectPath } = parseGsUri(storageUri);
    const dir = targetDir || (await mkdtemp(path.join(tmpdir(), "marryo-gcs-")));
    const dest = path.join(/* turbopackIgnore: true */ dir, path.basename(objectPath) || "object.bin");
    await bucket().file(objectPath).download({ destination: dest });
    return dest;
  };

  readBytes = async (storageUri: string): Promise<Buffer> => {
    requireGcsConfigured();
    const { objectPath } = parseGsUri(storageUri);
    const [buf] = await bucket().file(objectPath).download();
    return buf;
  };
}

let singleton: StorageService | undefined;

class RoutingStorageService implements StorageService {
  private readonly primary: StorageService;
  private readonly localFallback: LocalStorageService;

  constructor(primary: StorageService, localFallback: LocalStorageService) {
    this.primary = primary;
    this.localFallback = localFallback;
  }

  upload = (input: StorageUploadInput) => this.primary.upload(input);

  getSignedUrl = (storageUri: string, expiresInSeconds?: number) =>
    storageUri.startsWith(LOCAL_PREFIX)
      ? this.localFallback.getSignedUrl(storageUri, expiresInSeconds)
      : this.primary.getSignedUrl(storageUri, expiresInSeconds);

  getWriteSignedUrl = (
    objectPath: string,
    contentType: string,
    expiresInSeconds?: number,
  ) => {
    if (!this.primary.getWriteSignedUrl) {
      throw new Error("direct upload signed URLs require GCS (STORAGE_BACKEND=gcs)");
    }
    return this.primary.getWriteSignedUrl(objectPath, contentType, expiresInSeconds);
  };

  objectExists = (storageUri: string) =>
    storageUri.startsWith(LOCAL_PREFIX)
      ? this.localFallback.objectExists!(storageUri)
      : this.primary.objectExists!(storageUri);

  delete = (storageUri: string) =>
    storageUri.startsWith(LOCAL_PREFIX)
      ? this.localFallback.delete(storageUri)
      : this.primary.delete(storageUri);

  materializeLocal = (storageUri: string, targetDir?: string) =>
    storageUri.startsWith(LOCAL_PREFIX)
      ? this.localFallback.materializeLocal(storageUri, targetDir)
      : this.primary.materializeLocal(storageUri, targetDir);

  readBytes = (storageUri: string) =>
    storageUri.startsWith(LOCAL_PREFIX)
      ? this.localFallback.readBytes(storageUri)
      : this.primary.readBytes(storageUri);
}

/**
 * Default: GCS when bucket+project are set (unless STORAGE_BACKEND=local).
 * Missing GCS with STORAGE_BACKEND=gcs → clear error. Reads still accept legacy local: URIs.
 */
export function storageService(): StorageService {
  if (singleton) return singleton;

  const local = new LocalStorageService();
  const backend = env().STORAGE_BACKEND.toLowerCase();

  if (backend === "local") {
    singleton = local;
    return singleton;
  }

  if (!gcsIsConfigured()) {
    throw new StorageNotConfiguredError(
      "not configured: GCS — set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_STORAGE_BUCKET, or set STORAGE_BACKEND=local for offline demos",
    );
  }

  singleton = new RoutingStorageService(new GcsStorageService(), local);
  return singleton;
}

/** Reset singleton (tests / after env change). */
export function resetStorageService(): void {
  singleton = undefined;
}
