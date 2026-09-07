/**
 * Finished films: user's selected soundtrack (or mute) persisted with visibility.
 * Browser-created films are always private; set visibility=public in the DB to
 * feature them on the landing page.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prisma } from "./db.ts";
import { env } from "./env.ts";
import { clearProjectClipCache } from "./clip-cache.ts";
import { filmPosterPath } from "./storage.ts";
import { StorageNotConfiguredError, storageService } from "./storage-service.ts";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function ffmpegBin(): string {
  return env().FFMPEG_BIN || "ffmpeg";
}

export class FilmError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "FilmError";
    this.status = status;
  }
}

export type ApiFilm = {
  film_id: string;
  project_id: string;
  title: string | null;
  couple_label: string | null;
  track_id: string | null;
  track_title: string | null;
  visibility: "private" | "public";
  orientation: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  storage_uri: string;
  thumbnail_uri: string | null;
  playback_url?: string;
  thumbnail_url?: string;
  created_at: string;
};

type FilmRow = {
  filmId: string;
  projectId: string;
  title: string | null;
  coupleLabel: string | null;
  trackId: string | null;
  trackTitle: string | null;
  visibility: string;
  orientation: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  storageUri: string;
  thumbnailUri: string | null;
  createdAt: Date;
};

function coupleLabelFromJson(coupleNamesJson: string): string | null {
  try {
    const names = JSON.parse(coupleNamesJson) as Array<{ name?: string }>;
    const parts = names.map((n) => String(n.name || "").trim()).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]} & ${parts[1]}`;
    return parts[0] ?? null;
  } catch {
    return null;
  }
}

async function runFfmpeg(args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ ffmpegBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

/**
 * Extract a mid-film JPEG poster and upload it. Idempotent when thumbnailUri exists.
 */
export async function ensureFilmThumbnail(filmId: string): Promise<string | null> {
  const film = await prisma().film.findUnique({ where: { filmId } });
  if (!film?.storageUri) return null;
  if (film.thumbnailUri) return film.thumbnailUri;

  const storage = storageService();
  const workDir = await mkdtemp(path.join(tmpdir(), "marryo-poster-"));
  try {
    const localVideo = await storage.materializeLocal(film.storageUri, workDir);
    const seek =
      film.duration && film.duration > 4
        ? Math.min(film.duration * 0.28, film.duration - 0.5)
        : 1.2;
    const outPath = path.join(workDir, "poster.jpg");

    // Scale to a clean web poster; portrait vs landscape handled by scale+pad.
    const isPortrait = film.orientation === "portrait";
    const vf = isPortrait
      ? "scale=720:-2:force_original_aspect_ratio=decrease"
      : "scale=1280:-2:force_original_aspect_ratio=decrease";

    await runFfmpeg(
      [
        "-y",
        "-ss",
        seek.toFixed(2),
        "-i",
        localVideo,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-vf",
        vf,
        outPath,
      ],
      "film poster",
    );

    const body = await readFile(outPath);
    if (body.length < 1000) {
      throw new Error("poster too small");
    }

    const uploaded = await storage.upload({
      objectPath: filmPosterPath(film.projectId, film.filmId),
      body,
      contentType: "image/jpeg",
    });

    await prisma().film.update({
      where: { filmId },
      data: { thumbnailUri: uploaded.storageUri },
    });
    return uploaded.storageUri;
  } catch (error) {
    console.warn(
      `[films] poster failed for ${filmId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function withPlayback(row: FilmRow, expiresInSeconds = 3600): Promise<ApiFilm> {
  const storage = storageService();
  let playbackUrl: string | undefined;
  let thumbnailUrl: string | undefined;
  try {
    playbackUrl = await storage.getSignedUrl(row.storageUri, expiresInSeconds);
  } catch {
    playbackUrl = undefined;
  }
  if (row.thumbnailUri) {
    try {
      thumbnailUrl = await storage.getSignedUrl(row.thumbnailUri, expiresInSeconds);
    } catch {
      thumbnailUrl = undefined;
    }
  }
  return {
    film_id: row.filmId,
    project_id: row.projectId,
    title: row.title,
    couple_label: row.coupleLabel,
    track_id: row.trackId,
    track_title: row.trackTitle,
    visibility: row.visibility === "public" ? "public" : "private",
    orientation: row.orientation,
    duration: row.duration,
    width: row.width,
    height: row.height,
    storage_uri: row.storageUri,
    thumbnail_uri: row.thumbnailUri,
    playback_url: playbackUrl,
    thumbnail_url: thumbnailUrl,
    created_at: row.createdAt.toISOString(),
  };
}

export type UpsertFilmInput = {
  projectId: string;
  storageUri: string;
  title?: string | null;
  trackId?: string | null;
  trackTitle?: string | null;
  orientation?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  soundtrackSessionId?: string | null;
  soundtrackVersionId?: string | null;
  pictureRenderId?: string | null;
};

/**
 * Create or update a film row.
 * - If soundtrackVersionId is set, upsert that version row (many per project OK).
 * - Else (mute), upsert the mute/picture row for the project.
 * Browser creates always start as private; existing visibility is preserved on update.
 */
export async function upsertProjectFilm(input: UpsertFilmInput): Promise<ApiFilm> {
  const project = await prisma().project.findUnique({
    where: { projectId: input.projectId },
  });
  if (!project) {
    throw new FilmError("project not found", 404);
  }

  const coupleLabel = coupleLabelFromJson(project.coupleNames);
  const title =
    input.title?.trim() ||
    (input.trackTitle ? `${coupleLabel ?? "Film"} — ${input.trackTitle}` : coupleLabel) ||
    "Wedding film";

  const existing = input.soundtrackVersionId
    ? await prisma().film.findFirst({
        where: {
          projectId: input.projectId,
          soundtrackVersionId: input.soundtrackVersionId,
        },
      })
    : await prisma().film.findFirst({
        where: {
          projectId: input.projectId,
          soundtrackVersionId: null,
          pictureRenderId: input.pictureRenderId ?? undefined,
        },
        orderBy: { updatedAt: "desc" },
      });

  const data = {
    storageUri: input.storageUri,
    title,
    coupleLabel,
    trackId: input.trackId ?? null,
    trackTitle: input.trackTitle ?? null,
    orientation: input.orientation ?? project.orientation,
    duration: input.duration ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    soundtrackSessionId: input.soundtrackSessionId ?? null,
    soundtrackVersionId: input.soundtrackVersionId ?? null,
    pictureRenderId: input.pictureRenderId ?? null,
  };

  const row = existing
    ? await prisma().film.update({
        where: { filmId: existing.filmId },
        // Clear poster if the underlying video changed.
        data: {
          ...data,
          ...(existing.storageUri !== input.storageUri ? { thumbnailUri: null } : {}),
        },
      })
    : await prisma().film.create({
        data: {
          filmId: newId("flm"),
          projectId: input.projectId,
          visibility: "private",
          ...data,
        },
      });

  return withPlayback(row);
}

export async function getProjectFilm(projectId: string): Promise<ApiFilm | null> {
  const session = await prisma().soundtrackSession.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { createdAt: "desc" },
  });

  if (session?.selectedMode === "catalog" && session.selectedVersionId) {
    const selected = await prisma().film.findFirst({
      where: {
        projectId,
        soundtrackVersionId: session.selectedVersionId,
      },
    });
    if (selected) return withPlayback(selected);
  }

  if (session?.selectedMode === "mute") {
    const muted = await prisma().film.findFirst({
      where: { projectId, soundtrackVersionId: null },
      orderBy: { updatedAt: "desc" },
    });
    if (muted) return withPlayback(muted);
  }

  const row = await prisma().film.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  return withPlayback(row);
}

/**
 * Publish every ready soundtrack version for a project as public Film rows
 * (admin/manual — not called from the browser UI).
 */
export async function publishSoundtrackVersionsPublic(
  projectId: string,
): Promise<ApiFilm[]> {
  const session = await prisma().soundtrackSession.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { rank: "asc" } } },
  });
  if (!session) {
    throw new FilmError("no ready soundtrack session", 404);
  }

  const picture = await prisma().render.findUnique({
    where: { renderId: session.pictureRenderId },
  });

  const published: ApiFilm[] = [];
  for (const version of session.versions) {
    if (version.status !== "ready" || !version.storageUri) continue;

    const film = await upsertProjectFilm({
      projectId,
      storageUri: version.storageUri,
      trackId: version.trackId,
      trackTitle: version.title,
      orientation: picture?.orientation ?? null,
      duration: picture?.duration ?? null,
      width: picture?.width ?? null,
      height: picture?.height ?? null,
      soundtrackSessionId: session.sessionId,
      soundtrackVersionId: version.versionId,
      pictureRenderId: session.pictureRenderId,
    });

    await prisma().film.update({
      where: { filmId: film.film_id },
      data: { visibility: "public" },
    });
    await ensureFilmThumbnail(film.film_id);
    const refreshed = await prisma().film.findUnique({ where: { filmId: film.film_id } });
    if (refreshed) published.push(await withPlayback(refreshed));
  }

  return published;
}

/** Landing gallery — only visibility=public (set manually / admin publish). */
export async function listPublicFilms(limit = 12): Promise<ApiFilm[]> {
  try {
    storageService();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      throw new FilmError(error.message, 503);
    }
    throw error;
  }

  const rows = await prisma().film.findMany({
    where: { visibility: "public" },
    orderBy: [{ trackTitle: "asc" }, { updatedAt: "desc" }],
    take: Math.min(50, Math.max(1, limit)),
  });

  const withThumbs: FilmRow[] = [];
  for (const row of rows) {
    if (!row.thumbnailUri) {
      await ensureFilmThumbnail(row.filmId);
      const refreshed = await prisma().film.findUnique({ where: { filmId: row.filmId } });
      if (refreshed) withThumbs.push(refreshed);
      else withThumbs.push(row);
    } else {
      withThumbs.push(row);
    }
  }

  return Promise.all(withThumbs.map((row) => withPlayback(row, 3600)));
}

export type ProjectArchiveVideo = {
  role: "ungraded" | "graded" | "selected";
  label: string;
  playback_url?: string;
  storage_uri: string | null;
  muted: boolean;
};

export type ProjectArchive = {
  project_id: string;
  session_ended_at: string | null;
  orientation: string | null;
  videos: ProjectArchiveVideo[];
  selected_label: string | null;
};

/**
 * Three retained outputs: ungraded picture, graded mute picture, user selection.
 */
export async function getProjectArchive(projectId: string): Promise<ProjectArchive | null> {
  const project = await prisma().project.findUnique({ where: { projectId } });
  if (!project) return null;

  let storage;
  try {
    storage = storageService();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      throw new FilmError(error.message, 503);
    }
    throw error;
  }

  const render = await prisma().render.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { createdAt: "desc" },
  });

  const film = await getProjectFilm(projectId);

  const videos: ProjectArchiveVideo[] = [];

  if (render?.storageUri) {
    const ungradedUri = render.storageUri.replace(/\.mp4$/i, ".ungraded.mp4");
    let ungradedUrl: string | undefined;
    try {
      if (ungradedUri !== render.storageUri) {
        ungradedUrl = await storage.getSignedUrl(ungradedUri);
      }
    } catch {
      ungradedUrl = undefined;
    }
    if (ungradedUrl) {
      videos.push({
        role: "ungraded",
        label: "Before · no color grade",
        playback_url: ungradedUrl,
        storage_uri: ungradedUri,
        muted: true,
      });
    }

    let gradedUrl: string | undefined;
    try {
      gradedUrl = await storage.getSignedUrl(render.storageUri);
    } catch {
      gradedUrl = undefined;
    }
    videos.push({
      role: "graded",
      label: "After · color graded (muted)",
      playback_url: gradedUrl,
      storage_uri: render.storageUri,
      muted: true,
    });
  }

  if (film?.storage_uri) {
    const selectedLabel =
      film.track_title
        ? `Your selection · ${film.track_title}`
        : film.couple_label || film.title || "Your selection";
    videos.push({
      role: "selected",
      label: selectedLabel,
      playback_url: film.playback_url,
      storage_uri: film.storage_uri,
      muted: false,
    });
  }

  return {
    project_id: projectId,
    session_ended_at: project.sessionEndedAt ? project.sessionEndedAt.toISOString() : null,
    orientation: film?.orientation ?? render?.orientation ?? project.orientation,
    videos,
    selected_label: film?.track_title ?? film?.title ?? null,
  };
}

/**
 * Close the editing session: keep graded/ungraded picture + selected film,
 * delete uploaded clips and non-selected soundtrack remuxes.
 */
export async function endEditingSession(projectId: string): Promise<ProjectArchive> {
  const film = await getProjectFilm(projectId);
  if (!film) {
    throw new FilmError("no finished film — pick a soundtrack first", 409);
  }

  const endedAt = new Date();
  await prisma().project.update({
    where: { projectId },
    data: {
      status: "ready",
      currentStage: "complete",
      stageMessage: "Session ended — retained before/after + your selection",
      sessionEndedAt: endedAt,
    },
  });

  await cleanupSessionAssets(projectId, {
    keepStorageUris: new Set(
      [film.storage_uri].filter(Boolean) as string[],
    ),
  });
  await clearProjectClipCache(projectId).catch(() => undefined);

  const archive = await getProjectArchive(projectId);
  if (!archive) throw new FilmError("project missing after session end", 500);
  return archive;
}

async function cleanupSessionAssets(
  projectId: string,
  opts: { keepStorageUris: Set<string> },
): Promise<void> {
  let storage;
  try {
    storage = storageService();
  } catch {
    storage = null;
  }

  const keep = opts.keepStorageUris;

  // Preserve graded + ungraded picture render objects.
  const renders = await prisma().render.findMany({
    where: { projectId, status: "ready" },
    select: { storageUri: true },
  });
  for (const r of renders) {
    if (!r.storageUri) continue;
    keep.add(r.storageUri);
    keep.add(r.storageUri.replace(/\.mp4$/i, ".ungraded.mp4"));
  }

  // Delete non-selected soundtrack remux files + rows.
  const sessions = await prisma().soundtrackSession.findMany({
    where: { projectId },
    include: { versions: true },
  });
  for (const session of sessions) {
    for (const version of session.versions) {
      const isSelected = session.selectedVersionId === version.versionId;
      if (isSelected) {
        if (version.storageUri) keep.add(version.storageUri);
        continue;
      }
      if (version.storageUri && !keep.has(version.storageUri) && storage) {
        try {
          await storage.delete(version.storageUri);
        } catch {
          /* best-effort */
        }
      }
      await prisma().soundtrackVersion.delete({ where: { versionId: version.versionId } });
    }
  }

  // Delete uploaded clip media + clip rows (cascades clipPersons).
  const clips = await prisma().clip.findMany({
    where: { projectId },
    select: { clipId: true, storageUri: true, thumbnailUri: true },
  });
  for (const clip of clips) {
    if (storage) {
      for (const uri of [clip.storageUri, clip.thumbnailUri]) {
        if (!uri || keep.has(uri)) continue;
        try {
          await storage.delete(uri);
        } catch {
          /* best-effort */
        }
      }
    }
    await prisma().clip.delete({ where: { clipId: clip.clipId } });
  }
}
