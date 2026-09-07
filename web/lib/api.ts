/**
 * Thin browser client for Marryo APIs (Phases 1–7). No business logic.
 */

export type CoupleName = { name: string; role: "bride" | "groom" };

export type ApiProject = {
  project_id: string;
  owner_id?: string | null;
  couple_names: CoupleName[];
  wedding_date: string | null;
  story: string | null;
  max_duration: number;
  mood: string | null;
  visual_tone: string | null;
  ending_message: string | null;
  orientation: "landscape" | "portrait";
  status: string;
  current_stage: string;
  bride_person_id: string | null;
  groom_person_id: string | null;
  session_ended_at?: string | null;
  created_at: string;
  clips?: ApiClip[];
};

export type ApiProjectSummary = ApiProject & {
  clip_count: number;
  valid_clip_count: number;
  film_title: string | null;
  film_track_title: string | null;
};

export type ValidationCheck = {
  id: string;
  label: string;
  passed: boolean;
  score: number;
  unit?: string;
  threshold?: string;
  reason: string;
  detail?: string;
  implication?: string;
};

export type ValidationWarnings = {
  warnings: string[];
  metrics: {
    brightness: number;
    blur: number;
    faceCount: number;
  };
  checks?: ValidationCheck[];
  summary?: string;
  verdict_detail?: string;
  frames_sampled?: number;
};

export type ApiClip = {
  clip_id: string;
  project_id: string;
  filename: string;
  storage_uri: string | null;
  duration: number | null;
  status: string;
  valid: boolean | null;
  validation_warnings?: ValidationWarnings | null;
  thumbnail_uri?: string | null;
  thumbnail_url?: string;
  playback_url?: string;
};

export type ProjectStatus = {
  status: string;
  current_stage: string;
  stage_message?: string | null;
};

export type ApiPerson = {
  person_id: string;
  thumbnail_uris: string[];
  clip_ids: string[];
  face_count: number;
};

export type IdentifyResponse = {
  persons: ApiPerson[];
  warnings?: string[];
};

export type ApiRender = {
  render_id: string;
  project_id: string;
  status: string;
  storage_uri: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  orientation: string;
  playback_url?: string;
  ungraded_playback_url?: string;
  evaluation?: { passed: boolean } | null;
  error_text?: string | null;
};

export type SoundtrackVersion = {
  version_id: string;
  rank: number;
  track_id: string;
  title: string;
  artist: string | null;
  score: number | null;
  tags: string[];
  status: string;
  storage_uri: string | null;
  playback_url?: string;
  error_text: string | null;
};

export type SoundtrackSession = {
  session_id: string;
  project_id: string;
  picture_render_id: string;
  status: string;
  selected_version_id: string | null;
  selected_mode: string | null;
  versions: SoundtrackVersion[];
  modes: Array<{ mode: "mute" | "original"; label: string; available: boolean }>;
  error_text: string | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { error: text };
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed (${res.status})`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export async function createProject(input: {
  couple_names: CoupleName[];
  wedding_date?: string;
  mood?: string;
  visual_tone?: string;
  ending_message?: string;
  max_duration?: number;
  orientation?: "landscape" | "portrait";
}): Promise<ApiProject> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function listProjects(): Promise<{ projects: ApiProjectSummary[] }> {
  const res = await fetch("/api/projects", { cache: "no-store" });
  return parseJson(res);
}

export async function getProject(id: string): Promise<ApiProject> {
  const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
  return parseJson(res);
}

export async function deleteProject(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  return parseJson(res);
}

export async function getStatus(id: string): Promise<ProjectStatus> {
  const res = await fetch(`/api/projects/${id}/status`, { cache: "no-store" });
  return parseJson(res);
}

export async function patchProject(
  id: string,
  body: { orientation?: "landscape" | "portrait" },
): Promise<ApiProject> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function uploadClips(id: string, files: File[]): Promise<{
  clips: ApiClip[];
  errors?: Array<{ filename: string; error: string }>;
}> {
  return uploadClipsWithProgress(id, files);
}

export type UploadProgress = {
  phase: "upload" | "validate";
  /** 0–100 while phase=upload; null while validating on the server */
  percent: number | null;
  loadedBytes: number;
  totalBytes: number;
  fileCount: number;
  /** 1-based index of the file currently uploading/validating */
  fileIndex?: number;
  fileName?: string;
};

/** Upload files one-by-one so the UI can show N-of-M analyzing progress. */
export async function uploadClipsWithProgress(
  id: string,
  files: File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<{
  clips: ApiClip[];
  errors?: Array<{ filename: string; error: string }>;
}> {
  const clips: ApiClip[] = [];
  const errors: Array<{ filename: string; error: string }> = [];
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let loadedBase = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const result = await uploadOneClipWithProgress(
      id,
      file,
      {
        fileIndex: i + 1,
        fileCount: files.length,
        fileName: file.name,
        loadedBase,
        totalBytes,
      },
      onProgress,
    );
    loadedBase += file.size;
    if (result.clip) clips.push(result.clip);
    if (result.error) errors.push(result.error);
  }

  return { clips, errors: errors.length ? errors : undefined };
}

function uploadOneClipWithProgress(
  id: string,
  file: File,
  meta: {
    fileIndex: number;
    fileCount: number;
    fileName: string;
    loadedBase: number;
    totalBytes: number;
  },
  onProgress?: (progress: UploadProgress) => void,
): Promise<{ clip?: ApiClip; error?: { filename: string; error: string } }> {
  // Prefer browser→GCS signed PUT (Cloud Run rejects bodies > ~32MB with 413).
  return uploadOneClipViaGcs(id, file, meta, onProgress).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    // Fall back to multipart only when direct upload is unavailable (local backend).
    if (/STORAGE_BACKEND=local|signed uploads not supported|501/i.test(msg)) {
      return uploadOneClipMultipart(id, file, meta, onProgress);
    }
    return { error: { filename: file.name, error: msg } };
  });
}

async function uploadOneClipViaGcs(
  id: string,
  file: File,
  meta: {
    fileIndex: number;
    fileCount: number;
    fileName: string;
    loadedBase: number;
    totalBytes: number;
  },
  onProgress?: (progress: UploadProgress) => void,
): Promise<{ clip?: ApiClip; error?: { filename: string; error: string } }> {
  const initRes = await fetch(`/api/projects/${id}/upload/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "video/mp4",
      size: file.size,
    }),
  });
  const initBody = (await initRes.json().catch(() => ({}))) as {
    error?: string;
    clip_id?: string;
    storage_uri?: string;
    upload_url?: string;
    content_type?: string;
  };
  if (initRes.status === 501) {
    throw new Error(initBody.error || "501");
  }
  if (!initRes.ok || !initBody.upload_url || !initBody.clip_id || !initBody.storage_uri) {
    return {
      error: {
        filename: file.name,
        error: initBody.error || `upload init failed (${initRes.status})`,
      },
    };
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const loaded = meta.loadedBase + event.loaded;
      const percent = Math.min(99, Math.round((loaded / meta.totalBytes) * 100));
      onProgress?.({
        phase: "upload",
        percent,
        loadedBytes: loaded,
        totalBytes: meta.totalBytes,
        fileCount: meta.fileCount,
        fileIndex: meta.fileIndex,
        fileName: meta.fileName,
      });
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`GCS upload failed (${xhr.status})`));
        return;
      }
      resolve();
    };
    xhr.onerror = () => reject(new Error("network error during GCS upload"));
    xhr.open("PUT", initBody.upload_url!);
    xhr.setRequestHeader("Content-Type", initBody.content_type || file.type || "video/mp4");
    xhr.send(file);
  });

  onProgress?.({
    phase: "validate",
    percent: null,
    loadedBytes: meta.loadedBase + file.size,
    totalBytes: meta.totalBytes,
    fileCount: meta.fileCount,
    fileIndex: meta.fileIndex,
    fileName: meta.fileName,
  });

  const completeRes = await fetch(`/api/projects/${id}/upload/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clip_id: initBody.clip_id,
      filename: file.name,
      storage_uri: initBody.storage_uri,
    }),
  });
  const completeBody = (await completeRes.json().catch(() => ({}))) as {
    error?: string;
    clips?: ApiClip[];
    errors?: Array<{ filename: string; error: string }>;
  };
  if (!completeRes.ok) {
    return {
      error: {
        filename: file.name,
        error: completeBody.error || `upload complete failed (${completeRes.status})`,
      },
    };
  }
  const clip = completeBody.clips?.[0];
  const err = completeBody.errors?.[0];
  return {
    clip,
    error: err ?? (clip ? undefined : { filename: file.name, error: "upload returned no clip" }),
  };
}

function uploadOneClipMultipart(
  id: string,
  file: File,
  meta: {
    fileIndex: number;
    fileCount: number;
    fileName: string;
    loadedBase: number;
    totalBytes: number;
  },
  onProgress?: (progress: UploadProgress) => void,
): Promise<{ clip?: ApiClip; error?: { filename: string; error: string } }> {
  const form = new FormData();
  form.append("files", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const loaded = meta.loadedBase + event.loaded;
      const percent = Math.min(99, Math.round((loaded / meta.totalBytes) * 100));
      onProgress?.({
        phase: "upload",
        percent,
        loadedBytes: loaded,
        totalBytes: meta.totalBytes,
        fileCount: meta.fileCount,
        fileIndex: meta.fileIndex,
        fileName: meta.fileName,
      });
    };

    xhr.upload.onload = () => {
      onProgress?.({
        phase: "validate",
        percent: null,
        loadedBytes: meta.loadedBase + file.size,
        totalBytes: meta.totalBytes,
        fileCount: meta.fileCount,
        fileIndex: meta.fileIndex,
        fileName: meta.fileName,
      });
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = { error: xhr.responseText };
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const msg =
          body && typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : `upload failed (${xhr.status})`;
        resolve({ error: { filename: file.name, error: msg } });
        return;
      }
      const parsed = body as {
        clips?: ApiClip[];
        errors?: Array<{ filename: string; error: string }>;
      };
      const clip = parsed.clips?.[0];
      const err = parsed.errors?.[0];
      resolve({
        clip,
        error: err ?? (clip ? undefined : { filename: file.name, error: "upload returned no clip" }),
      });
    };

    xhr.onerror = () => reject(new ApiError("network error during upload", 0));
    xhr.onabort = () => reject(new ApiError("upload aborted", 0));

    onProgress?.({
      phase: "upload",
      percent: Math.min(99, Math.round((meta.loadedBase / meta.totalBytes) * 100)),
      loadedBytes: meta.loadedBase,
      totalBytes: meta.totalBytes,
      fileCount: meta.fileCount,
      fileIndex: meta.fileIndex,
      fileName: meta.fileName,
    });

    xhr.open("POST", `/api/projects/${id}/upload`);
    xhr.send(form);
  });
}

export async function identifyProject(id: string): Promise<IdentifyResponse> {
  const res = await fetch(`/api/projects/${id}/identify`, { method: "POST" });
  return parseJson(res);
}

export async function confirmIdentity(
  id: string,
  body: { bride_person_id?: string | null; groom_person_id?: string | null },
): Promise<{ project_id: string; bride_person_id: string | null; groom_person_id: string | null; current_stage: string }> {
  const res = await fetch(`/api/projects/${id}/identity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function getIdentity(id: string): Promise<{
  project_id: string;
  persons: ApiPerson[];
  bride_person_id: string | null;
  groom_person_id: string | null;
}> {
  const res = await fetch(`/api/projects/${id}/identity`, { cache: "no-store" });
  return parseJson(res);
}

export function personThumbUrl(projectId: string, personId: string, index = 0): string {
  return `/api/projects/${projectId}/persons/${personId}/thumbnails/${index}`;
}

export async function detectScenes(id: string): Promise<{
  project_id: string;
  total_scenes: number;
  clips: Array<{
    clip_id: string;
    filename: string;
    scene_count: number;
    scenes: Array<{ scene_id: string; start_time: number; end_time: number; duration: number }>;
  }>;
}> {
  const res = await fetch(`/api/projects/${id}/detect-scenes`, {
    method: "POST",
  });
  return parseJson(res);
}

export async function directFilm(id: string): Promise<{
  project_id: string;
  theme?: string;
  moments_analyzed?: number;
  moments_scored?: number;
  valid?: boolean;
  edit_id?: string;
}> {
  const res = await fetch(`/api/projects/${id}/direct`, { method: "POST" });
  return parseJson(res);
}

export async function renderFilm(
  id: string,
  body?: { orientation?: "landscape" | "portrait" },
): Promise<ApiRender> {
  const res = await fetch(`/api/projects/${id}/render`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseJson(res);
}

export async function getLatestRender(id: string): Promise<ApiRender> {
  const res = await fetch(`/api/projects/${id}/render`, { cache: "no-store" });
  return parseJson(res);
}

export async function generateSoundtrack(
  id: string,
  body?: { force?: boolean; top_n?: number },
): Promise<SoundtrackSession> {
  const res = await fetch(`/api/projects/${id}/soundtrack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return parseJson(res);
}

export async function getSoundtrack(id: string): Promise<SoundtrackSession> {
  const res = await fetch(`/api/projects/${id}/soundtrack`, { cache: "no-store" });
  return parseJson(res);
}

export async function selectSoundtrack(
  id: string,
  body: { mode: "catalog"; version_id: string } | { mode: "mute" } | { mode: "original" },
): Promise<SoundtrackSession> {
  const res = await fetch(`/api/projects/${id}/soundtrack/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function confirmGrade(id: string): Promise<{
  ok: boolean;
  current_stage: string;
  session_ended_at: string | null;
  archive?: ProjectArchive;
}> {
  const res = await fetch(`/api/projects/${id}/grade/confirm`, { method: "POST" });
  return parseJson(res);
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

export async function getProjectArchive(id: string): Promise<ProjectArchive> {
  const res = await fetch(`/api/projects/${id}/archive`, { cache: "no-store" });
  return parseJson(res);
}

export async function getProjectFilm(id: string): Promise<{
  film_id: string;
  title: string | null;
  couple_label: string | null;
  track_title: string | null;
  visibility: string;
  playback_url?: string;
  storage_uri: string;
}> {
  const res = await fetch(`/api/projects/${id}/film`, { cache: "no-store" });
  return parseJson(res);
}

export async function listPublicFilms(): Promise<{
  films: Array<{
    film_id: string;
    title: string | null;
    couple_label: string | null;
    track_title: string | null;
    playback_url?: string;
    orientation: string | null;
  }>;
}> {
  const res = await fetch("/api/films/public?limit=12", { cache: "no-store" });
  return parseJson(res);
}

export type AccountSettings = {
  user_id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  joined_at: string;
  first_video_at: string | null;
};

export async function getAccountSettings(): Promise<AccountSettings> {
  const res = await fetch("/api/account", { cache: "no-store" });
  return parseJson(res);
}

export async function deleteAccount(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/account", { method: "DELETE" });
  return parseJson(res);
}

/** Map backend stage → studio UI step. */
export type StudioStep =
  | "upload"
  | "identity"
  | "pipeline"
  | "soundtrack"
  | "grading"
  | "complete";

export function studioStepFromStage(stage: string, status: string): StudioStep {
  if (status === "failed") {
    if (stage === "rendering" || stage === "directing" || stage === "analysing") return "pipeline";
    if (stage === "soundtrack") return "soundtrack";
    if (stage === "grading") return "grading";
  }
  switch (stage) {
    case "upload":
    case "validated":
      return "upload";
    case "identifying":
    case "identity":
      return "identity";
    case "analysing":
    case "directing":
    case "rendering":
      return "pipeline";
    case "soundtrack":
      return "soundtrack";
    case "grading":
      return "grading";
    case "complete":
      return "complete";
    default:
      return "upload";
  }
}
