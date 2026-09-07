"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState, useTransition, type VideoHTMLAttributes } from "react";

import {
  ApiError,
  confirmGrade,
  confirmIdentity,
  deleteProject,
  detectScenes,
  directFilm,
  generateSoundtrack,
  getLatestRender,
  getProject,
  getProjectArchive,
  getSoundtrack,
  getStatus,
  getIdentity,
  identifyProject,
  patchProject,
  personThumbUrl,
  renderFilm,
  selectSoundtrack,
  studioStepFromStage,
  uploadClipsWithProgress,
  type ApiClip,
  type ApiPerson,
  type ApiProject,
  type ApiRender,
  type ProjectArchive,
  type SoundtrackSession,
  type StudioStep,
  type UploadProgress,
} from "@/lib/api";
import {
  ConfirmModal,
  ErrorNote,
  GhostButton,
  NoticeModal,
  PrimaryButton,
  StepRail,
  StudioChrome,
  TrashIcon,
} from "@/components/ui";
import { ClipAnalysisList, StudioProcessPanel } from "@/components/clip-analysis";

const STEPS = [
  { id: "upload", label: "Footage" },
  { id: "identity", label: "People" },
  { id: "pipeline", label: "Direct" },
  { id: "soundtrack", label: "Sound" },
  { id: "grading", label: "Grade" },
  { id: "complete", label: "Film" },
];

function capitalizeLabel(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDayMonth(isoDate: string | null | undefined): string {
  if (!isoDate) return "--/--";
  const trimmed = isoDate.trim();
  // ISO timestamps (created_at): use local calendar day
  if (trimmed.includes("T") || /Z$/i.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}`;
    }
  }
  const raw = trimmed.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) return `${match[3]}/${match[2]}`;
  const dmy = /^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/.exec(raw);
  if (dmy) return `${dmy[1]!.padStart(2, "0")}/${dmy[2]!.padStart(2, "0")}`;
  return "--/--";
}

/** Short page title: "10/10 Portrait 30s" — DD/MM from project created_at. */
function projectShortLabel(project: ApiProject): string {
  const datePart = formatDayMonth(project.created_at);
  const orient = capitalizeLabel(project.orientation);
  const duration = `${Math.round(project.max_duration || 0)}s`;
  return `${datePart} ${orient} ${duration}`;
}

function namesLine(project: ApiProject): string {
  const names = project.couple_names.map((c) => c.name).filter(Boolean);
  if (names.length >= 2) return `${names[0]} & ${names[1]}`;
  return names[0] ?? "Your film";
}

function filmFrameClass(orientation: string | null | undefined): string {
  return orientation === "portrait"
    ? "mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-sm bg-black object-contain"
    : "aspect-video w-full bg-black object-contain";
}

function FilmPlayer({
  src,
  orientation,
  className = "",
  ...rest
}: {
  src: string;
  orientation?: string | null;
  className?: string;
} & VideoHTMLAttributes<HTMLVideoElement>) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-film ${orientation === "portrait" ? "mx-auto max-w-sm" : ""}`}>
      <video
        src={src}
        controls
        playsInline
        className={`${filmFrameClass(orientation)} ${className}`}
        {...rest}
      />
    </div>
  );
}

function buildProjectJournal(project: ApiProject, extras?: {
  sceneSummary?: string | null;
  soundtrackLabel?: string | null;
  render?: ApiRender | null;
}): Array<{ title: string; body: string }> {
  const names = namesLine(project);
  const clips = project.clips ?? [];
  const kept = clips.filter((c) => c.valid).length;
  const entries: Array<{ title: string; body: string }> = [
    {
      title: "Brief",
      body: `${names} · ${project.orientation} · max ${project.max_duration}s${
        project.mood ? ` · mood ${project.mood}` : ""
      }${project.visual_tone ? ` · tone ${project.visual_tone}` : ""}`,
    },
    {
      title: "Footage",
      body: `${kept} kept of ${clips.length} uploaded clip${clips.length === 1 ? "" : "s"}`,
    },
  ];
  if (project.bride_person_id || project.groom_person_id) {
    entries.push({
      title: "People",
      body: `Bride ${project.bride_person_id ? "set" : "—"} · Groom ${project.groom_person_id ? "set" : "—"}`,
    });
  }
  if (extras?.sceneSummary) {
    entries.push({ title: "Direct", body: extras.sceneSummary });
  }
  if (extras?.render) {
    const r = extras.render;
    entries.push({
      title: "Picture render",
      body: `${r.orientation}${r.width && r.height ? ` · ${r.width}×${r.height}` : ""}${
        r.duration != null ? ` · ${r.duration.toFixed(1)}s` : ""
      }${r.evaluation ? ` · eval ${r.evaluation.passed ? "passed" : "failed"}` : ""}`,
    });
  }
  if (extras?.soundtrackLabel) {
    entries.push({ title: "Soundtrack", body: extras.soundtrackLabel });
  }
  entries.push({
    title: "Stage",
    body: `${project.current_stage} (${project.status})`,
  });
  return entries;
}

export default function StudioProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<ApiProject | null>(null);
  const [step, setStep] = useState<StudioStep>("upload");
  const [forceEdit, setForceEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [journalExtras, setJournalExtras] = useState<{
    sceneSummary?: string | null;
    soundtrackLabel?: string | null;
    render?: ApiRender | null;
  }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getProject(projectId);
        if (cancelled) return;
        setProject(p);
        setStep(studioStepFromStage(p.current_stage, p.status));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refresh = useCallback(async () => {
    const [p, status] = await Promise.all([getProject(projectId), getStatus(projectId)]);
    setProject(p);
    return { project: p, status };
  }, [projectId]);

  const progressStep = project
    ? studioStepFromStage(project.current_stage, project.status)
    : "upload";
  const progressIdx = Math.max(
    0,
    STEPS.findIndex((s) => s.id === progressStep),
  );
  const unlockedIds = STEPS.slice(0, progressIdx + 1).map((s) => s.id);
  const readOnly =
    forceEdit && step === "soundtrack"
      ? false
      : progressStep === "complete"
        ? step !== "complete"
        : step !== progressStep;

  const goToStep = useCallback((id: string) => {
    if (!STEPS.some((s) => s.id === id)) return;
    setForceEdit(false);
    setError(null);
    setStep(id as StudioStep);
  }, []);

  async function runDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(projectId);
      router.push("/studio");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete project");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const deleteAction = (
    <button
      type="button"
      disabled={deleting}
      onClick={() => setConfirmDelete(true)}
      className="inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-transparent px-4 py-2.5 text-sm font-medium tracking-[0.04em] text-ink/80 transition hover:border-ink/35 hover:bg-ink/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
      aria-label="Delete project"
    >
      <TrashIcon className="h-4 w-4" />
      Delete
    </button>
  );

  const deleteModal = (
    <ConfirmModal
      open={confirmDelete}
      danger
      pending={deleting}
      title="Delete this project?"
      body="Footage, renders, and soundtrack choices will be removed permanently. This cannot be undone."
      confirmLabel="Delete project"
      cancelLabel="Keep project"
      onCancel={() => {
        if (!deleting) setConfirmDelete(false);
      }}
      onConfirm={() => void runDelete()}
    />
  );

  if (loading) {
    return (
      <StudioChrome title="Studio" subtitle="Loading" backHref="/studio" actions={deleteAction}>
        {deleteModal}
        <p className="animate-fade text-ink-muted">Opening your project…</p>
      </StudioChrome>
    );
  }

  if (!project) {
    return (
      <StudioChrome title="Studio" subtitle="Error" backHref="/studio" actions={deleteAction}>
        {deleteModal}
        <ErrorNote>{error ?? "Project not found"}</ErrorNote>
      </StudioChrome>
    );
  }

  const journal = buildProjectJournal(project, journalExtras);

  return (
    <StudioChrome
      title={projectShortLabel(project)}
      subtitle={project.project_id}
      backHref="/studio"
      actions={deleteAction}
    >
      {deleteModal}
      <StepRail
        steps={STEPS}
        active={step}
        unlockedIds={unlockedIds}
        onSelect={goToStep}
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {readOnly ? (
        <p className="mb-4 mono-readout text-[11px] tracking-[0.14em] text-bronze uppercase">
          Review · read only
        </p>
      ) : null}

      <div className="mb-8">
        <StudioProcessPanel
          journal={journal}
          unlockedStepIds={unlockedIds}
          onNavigateStep={goToStep}
        />
      </div>

      <div key={`${step}-${readOnly ? "ro" : "edit"}`} className="animate-fade">
        {step === "upload" ? (
          <UploadStep
            project={project}
            readOnly={readOnly}
            onError={setError}
            onDone={async () => {
              await refresh();
              setStep("identity");
            }}
          />
        ) : null}
        {step === "identity" ? (
          <IdentityStep
            project={project}
            readOnly={readOnly}
            onError={setError}
            onDone={async () => {
              await refresh();
              setStep("pipeline");
            }}
            onSkip={async () => {
              await refresh();
              setStep("pipeline");
            }}
          />
        ) : null}
        {step === "pipeline" ? (
          <PipelineStep
            project={project}
            readOnly={readOnly}
            onError={setError}
            onProjectChange={setProject}
            onJournal={(extra) => setJournalExtras((prev) => ({ ...prev, ...extra }))}
            onDone={async () => {
              await refresh();
              setStep("soundtrack");
            }}
          />
        ) : null}
        {step === "soundtrack" ? (
          <SoundtrackStep
            projectId={project.project_id}
            orientation={project.orientation}
            readOnly={readOnly}
            onError={setError}
            onJournal={(label) => setJournalExtras((prev) => ({ ...prev, soundtrackLabel: label }))}
            onDone={async () => {
              setForceEdit(false);
              await refresh();
              setStep("grading");
            }}
          />
        ) : null}
        {step === "grading" ? (
          <GradingStep
            projectId={project.project_id}
            orientation={project.orientation}
            readOnly={readOnly}
            onError={setError}
            onDone={async () => {
              await refresh();
              setStep("complete");
            }}
            onChangeSong={() => {
              setForceEdit(true);
              setStep("soundtrack");
            }}
          />
        ) : null}
        {step === "complete" ? (
          <CompleteStep
            projectId={project.project_id}
            orientation={project.orientation}
            sessionEndedAt={project.session_ended_at ?? null}
            onError={setError}
            onChangeSong={() => {
              setForceEdit(true);
              setStep("soundtrack");
            }}
            onReviewGrade={() => goToStep("grading")}
          />
        ) : null}
      </div>
    </StudioChrome>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadStep({
  project,
  readOnly = false,
  onError,
  onDone,
}: {
  project: ApiProject;
  readOnly?: boolean;
  onError: (msg: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [clips, setClips] = useState<ApiClip[]>(project.clips ?? []);
  const [uploadErrors, setUploadErrors] = useState<Array<{ filename: string; error: string }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const [batchNames, setBatchNames] = useState<string[]>([]);

  useEffect(() => {
    setClips(project.clips ?? []);
  }, [project.clips]);

  const validCount = clips.filter((c) => c.valid).length;
  const maxClips = 6;
  const slotsLeft = Math.max(0, maxClips - clips.length);
  const atClipLimit = slotsLeft <= 0;

  async function handleFiles(fileList: FileList | null) {
    if (readOnly || !fileList?.length || busy) return;
    if (atClipLimit) {
      onError(`This project already has ${maxClips} clips — the maximum allowed.`);
      return;
    }
    let files = Array.from(fileList);
    if (files.length > slotsLeft) {
      onError(
        `Only ${slotsLeft} more clip${slotsLeft === 1 ? "" : "s"} allowed (max ${maxClips} per project). Extra files were skipped.`,
      );
      files = files.slice(0, slotsLeft);
    }
    onError(null);
    setBusy(true);
    setBatchNames(files.map((f) => f.name));
    setProgress({
      phase: "upload",
      percent: 0,
      loadedBytes: 0,
      totalBytes: files.reduce((s, f) => s + f.size, 0),
      fileCount: files.length,
    });
    try {
      const result = await uploadClipsWithProgress(project.project_id, files, setProgress);
      setClips((prev) => [...prev, ...(result.clips ?? [])]);
      setUploadErrors((prev) => [...prev, ...(result.errors ?? [])]);
      if (result.errors?.length) {
        onError(
          `${result.errors.length} file${result.errors.length === 1 ? "" : "s"} failed technical checks — see details below.`,
        );
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
      setBatchNames([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const statusLine = (() => {
    if (!progress) {
      if (atClipLimit) return `Limit reached · ${maxClips} clips max`;
      return `Click or drag MP4 / MOV · ${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left`;
    }
    const idx = progress.fileIndex ?? progress.fileCount;
    const name = progress.fileName ? ` · ${progress.fileName}` : "";
    if (progress.phase === "upload" && progress.percent != null) {
      return `Uploading ${idx} of ${progress.fileCount}${name} — ${progress.percent}%`;
    }
    const eta = Math.max(1, (progress.fileCount - idx + 1) * 8);
    return `Analyzing ${idx} of ${progress.fileCount}${name} — about ${eta}s left (estimate)`;
  })();

  const barWidth =
    progress?.phase === "upload" && progress.percent != null
      ? `${progress.percent}%`
      : progress?.phase === "validate"
        ? `${Math.min(99, Math.round(((progress.fileIndex ?? 1) / progress.fileCount) * 100))}%`
        : "0%";

  return (
    <div className="space-y-7">
      <p className="max-w-lg text-sm leading-relaxed text-ink-muted">
        {readOnly
          ? "Clip analysis from validation — Kept clips entered the film; open Detail for measurements."
          : `Up to ${maxClips} clips per project. We score brightness, sharpness, and faces — only Kept footage continues.`}
      </p>

      {!readOnly ? (
      <div
        role="button"
        tabIndex={busy || atClipLimit ? -1 : 0}
        aria-disabled={busy || atClipLimit}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !atClipLimit) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!atClipLimit) void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => {
          if (!busy && !atClipLimit) inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (busy || atClipLimit) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`relative overflow-hidden border border-dashed px-6 py-16 text-center transition ${
          busy || atClipLimit ? "cursor-not-allowed opacity-70" : "cursor-pointer"
        } ${
          dragOver
            ? "border-bronze bg-bronze/[0.06]"
            : "border-ink/15 bg-white/35 hover:border-ink/30 hover:bg-white/50"
        }`}
      >
        {busy ? (
          <>
            <div
              aria-hidden
              className="process-reel pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, transparent 0 10px, color-mix(in srgb, var(--color-bronze) 12%, transparent) 10px 12px)",
                backgroundSize: "48px 100%",
              }}
            />
            <div
              aria-hidden
              className="process-scan pointer-events-none absolute inset-y-0 left-1/2 w-1/3 bg-gradient-to-r from-transparent via-bronze/25 to-transparent"
            />
          </>
        ) : (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 49%, color-mix(in srgb, var(--color-ink) 6%, transparent) 50%, transparent 51%)",
              backgroundSize: "24px 100%",
            }}
          />
        )}
        <p className="relative font-display text-2xl tracking-[-0.02em] text-ink">Drop footage</p>
        <p className="relative mt-2 text-sm text-ink-muted" aria-live="polite">
          {statusLine}
        </p>

        {progress ? (
          <div className="relative mx-auto mt-8 max-w-sm space-y-3 text-left">
            <div
              className="h-px overflow-hidden bg-ink/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                progress.phase === "upload" && progress.percent != null
                  ? progress.percent
                  : progress.fileIndex && progress.fileCount
                    ? Math.round((progress.fileIndex / progress.fileCount) * 100)
                    : undefined
              }
              aria-valuetext={statusLine}
            >
              <div
                className={`h-full bg-bronze transition-[width] duration-200 ease-out ${
                  progress.phase === "validate" ? "animate-pulse-soft" : ""
                }`}
                style={{ width: barWidth }}
              />
            </div>
            <p className="mono-readout text-[11px] text-ink-muted">
              {progress.phase === "upload"
                ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}`
                : "brightness → sharpness → faces → poster"}
            </p>
            {batchNames.length > 0 ? (
              <ul className="max-h-24 space-y-1 overflow-y-auto text-xs text-ink/75">
                {batchNames.map((name, i) => (
                  <li
                    key={name}
                    className={`truncate mono-readout ${
                      progress.fileIndex === i + 1 ? "font-medium text-ink" : ""
                    }`}
                  >
                    {progress.fileIndex === i + 1 ? "→ " : ""}
                    {name}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/*,.mp4,.mov"
          multiple
          disabled={busy}
          className="hidden"
          data-testid="footage-input"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      ) : null}

      <ClipAnalysisList clips={clips} uploadErrors={uploadErrors} />

      {!readOnly ? (
        <PrimaryButton disabled={busy || validCount === 0} onClick={() => void onDone()}>
          {busy
            ? progress?.phase === "validate"
              ? "Analyzing…"
              : "Uploading…"
            : `Continue with ${validCount} clip${validCount === 1 ? "" : "s"}`}
        </PrimaryButton>
      ) : null}
    </div>
  );
}

function IdentityStep({
  project,
  readOnly = false,
  onError,
  onDone,
  onSkip,
}: {
  project: ApiProject;
  readOnly?: boolean;
  onError: (msg: string | null) => void;
  onDone: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [persons, setPersons] = useState<ApiPerson[]>([]);
  const [brideId, setBrideId] = useState<string | null>(project.bride_person_id);
  const [groomId, setGroomId] = useState<string | null>(project.groom_person_id);
  const [ran, setRan] = useState(false);
  const startedRef = useRef(false);

  const runIdentify = useCallback(() => {
    if (readOnly) return;
    onError(null);
    startTransition(async () => {
      try {
        const result = await identifyProject(project.project_id);
        const list = result.persons ?? [];
        setPersons(list);
        setRan(true);
        if (result.warnings?.length) onError(result.warnings.join(" · "));

        // Happy path: 0 people → skip; 1–2 people → auto-label and continue.
        if (list.length === 0) {
          await onSkip();
          return;
        }
        if (list.length <= 2) {
          const autoBride = list[0]?.person_id ?? null;
          const autoGroom = list[1]?.person_id ?? null;
          setBrideId(autoBride);
          setGroomId(autoGroom);
          await confirmIdentity(project.project_id, {
            bride_person_id: autoBride,
            groom_person_id: autoGroom,
          });
          await onDone();
        }
      } catch (err) {
        onError(err instanceof ApiError ? err.message : "Identify failed");
      }
    });
  }, [onDone, onError, onSkip, project.project_id, readOnly]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (readOnly) {
      startTransition(async () => {
        try {
          const result = await getIdentity(project.project_id);
          setPersons(result.persons ?? []);
          setBrideId(result.bride_person_id);
          setGroomId(result.groom_person_id);
          setRan(true);
        } catch (err) {
          onError(err instanceof ApiError ? err.message : "Could not load people");
        }
      });
      return;
    }
    runIdentify();
  }, [onError, project.project_id, readOnly, runIdentify]);

  function confirm() {
    if (readOnly) return;
    if (!brideId && !groomId) {
      onError("Select at least one person as bride or groom.");
      return;
    }
    onError(null);
    startTransition(async () => {
      try {
        await confirmIdentity(project.project_id, {
          bride_person_id: brideId,
          groom_person_id: groomId,
        });
        await onDone();
      } catch (err) {
        onError(err instanceof ApiError ? err.message : "Could not confirm identity");
      }
    });
  }

  return (
    <div className="space-y-8">
      <p className="max-w-xl text-ink-muted">
        {readOnly
          ? "People labels used for the story cut. Bride / groom selection is shown for review."
          : "Choose who is the bride and groom. We cluster faces across kept clips, then show thumbnails so you can label them. Skip if you prefer an anonymous cut."}
      </p>

      {pending && persons.length === 0 ? (
        <div className="space-y-4">
          <ProcessingMotion label={readOnly ? "Loading people…" : "Finding people in your clips…"} />
        </div>
      ) : null}

      {ran && persons.length === 0 && !pending ? (
        <div className="rounded-2xl border border-bronze/25 bg-bronze/5 px-5 py-4 text-sm text-bronze-deep">
          {readOnly
            ? "No people were labeled for this project."
            : "No distinct people were clustered from the kept footage. You can re-scan, skip, or upload clearer face-forward clips."}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {persons.map((person) => {
          const isBride = brideId === person.person_id;
          const isGroom = groomId === person.person_id;
          return (
            <div
              key={person.person_id}
              className={`overflow-hidden rounded-2xl border bg-ivory-deep/20 ${
                isBride || isGroom ? "border-bronze" : "border-stone-line"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={personThumbUrl(project.project_id, person.person_id, 0)}
                alt=""
                className="aspect-[4/5] w-full object-cover"
              />
              <div className="flex gap-2 p-3">
                {readOnly ? (
                  <p className="mono-readout w-full py-2 text-center text-xs tracking-[0.12em] text-ink-muted uppercase">
                    {isBride ? "Bride" : isGroom ? "Groom" : "Unlabeled"}
                  </p>
                ) : (
                  <>
                    <GhostButton
                      className={`flex-1 !px-3 !py-2 text-xs ${isBride ? "!border-bronze !bg-bronze/10" : ""}`}
                      onClick={() => {
                        setBrideId(person.person_id);
                        if (groomId === person.person_id) setGroomId(null);
                      }}
                    >
                      Bride
                    </GhostButton>
                    <GhostButton
                      className={`flex-1 !px-3 !py-2 text-xs ${isGroom ? "!border-bronze !bg-bronze/10" : ""}`}
                      onClick={() => {
                        setGroomId(person.person_id);
                        if (brideId === person.person_id) setBrideId(null);
                      }}
                    >
                      Groom
                    </GhostButton>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-3">
          <PrimaryButton disabled={pending} onClick={confirm}>
            Confirm people
          </PrimaryButton>
          <GhostButton disabled={pending} onClick={() => void onSkip()}>
            Continue without
          </GhostButton>
          <GhostButton disabled={pending} onClick={runIdentify}>
            Re-scan faces
          </GhostButton>
        </div>
      ) : null}
    </div>
  );
}

function ProcessingMotion({
  label,
  orientation,
}: {
  label: string;
  orientation?: string | null;
}) {
  const portrait = orientation === "portrait";
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-film ${portrait ? "mx-auto max-w-sm" : ""}`}>
      <div
        aria-hidden
        className="process-reel absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 10px, rgba(255,255,255,0.06) 10px 12px)",
          backgroundSize: "48px 100%",
        }}
      />
      <div
        aria-hidden
        className="process-scan absolute inset-y-0 left-1/2 w-1/3 bg-gradient-to-r from-transparent via-bronze/35 to-transparent"
      />
      <div
        className={`relative flex items-center justify-center px-6 text-center ${
          portrait ? "aspect-[9/16] max-h-[70vh]" : "aspect-video"
        }`}
      >
        <div>
          <p className="font-display text-2xl text-ivory/90">{label}</p>
          <p className="mt-3 mono-readout text-[11px] tracking-[0.18em] text-ivory/45 uppercase">
            Processing video
          </p>
        </div>
      </div>
    </div>
  );
}

function PipelineStep({
  project,
  readOnly = false,
  onError,
  onDone,
  onProjectChange,
  onJournal,
}: {
  project: ApiProject;
  readOnly?: boolean;
  onError: (msg: string | null) => void;
  onDone: () => Promise<void>;
  onProjectChange: (p: ApiProject) => void;
  onJournal: (extra: {
    sceneSummary?: string | null;
    render?: ApiRender | null;
  }) => void;
}) {
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    project.orientation === "portrait" ? "portrait" : "landscape",
  );
  const [phase, setPhase] = useState<"idle" | "scenes" | "direct" | "render" | "done">("idle");
  const [message, setMessage] = useState("Starting your edit…");
  const [stageHint, setStageHint] = useState<string | null>(null);
  const [sceneSummary, setSceneSummary] = useState<string | null>(null);
  const [render, setRender] = useState<ApiRender | null>(null);
  const [pending, setPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const startedRef = useRef(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    setOrientation(project.orientation === "portrait" ? "portrait" : "landscape");
  }, [project.orientation]);

  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const tick = async () => {
      try {
        const status = await getStatus(project.project_id);
        if (alive && status.stage_message) setStageHint(status.stage_message);
      } catch {
        /* ignore poll errors */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pending, project.project_id]);

  const run = useCallback(async () => {
    if (readOnly) return;
    onError(null);
    cancelRef.current = false;
    setCancelled(false);
    setPending(true);
    setRender(null);
    setSceneSummary(null);
    const startedAt = Date.now();
    try {
      if (orientation !== project.orientation) {
        const updated = await patchProject(project.project_id, { orientation });
        onProjectChange(updated);
      }

      setPhase("scenes");
      setMessage("Detecting scenes…");
      setStageHint("Reading shot boundaries on kept clips");
      const scenes = await detectScenes(project.project_id);
      if (cancelRef.current) return;
      const total = typeof scenes.total_scenes === "number" ? scenes.total_scenes : null;
      const clipCount = Array.isArray(scenes.clips) ? scenes.clips.length : null;
      const topClips = (scenes.clips ?? [])
        .slice()
        .sort((a, b) => (b.scene_count ?? 0) - (a.scene_count ?? 0))
        .slice(0, 3)
        .map((c) => `${c.filename} (${c.scene_count} cut${c.scene_count === 1 ? "" : "s"})`)
        .join("; ");
      const sceneLine =
        total != null && clipCount != null
          ? `Found ${total} scene cut${total === 1 ? "" : "s"} across ${clipCount} clip${clipCount === 1 ? "" : "s"}${
              topClips ? ` — ${topClips}.` : "."
            }`
          : "Scene boundaries ready for the Film Director.";
      setSceneSummary(sceneLine);
      onJournal({ sceneSummary: sceneLine });

      setPhase("direct");
      setMessage("Building the story…");
      setStageHint("Scoring moments and writing the edit");
      const directed = await directFilm(project.project_id);
      if (cancelRef.current) return;
      const theme = directed.theme?.trim() || null;
      const scored = directed.moments_scored ?? null;
      const analyzed = directed.moments_analyzed ?? null;
      setSceneSummary((prev) => {
        const storyBits = [
          theme ? `Story theme: ${theme}` : null,
          scored != null && analyzed != null
            ? `Scored ${scored} of ${analyzed} moments for the cut`
            : scored != null
              ? `Scored ${scored} moments for the cut`
              : null,
        ].filter(Boolean);
        if (!storyBits.length) return prev;
        const next = [prev, storyBits.join(". ")].filter(Boolean).join(" ");
        onJournal({ sceneSummary: next });
        return next;
      });

      setPhase("render");
      setMessage(`Rendering ${orientation} picture…`);
      setStageHint("Title cards, stitch, mute for music");
      const rendered = await renderFilm(project.project_id, { orientation });
      if (cancelRef.current) return;
      setRender(rendered);
      onJournal({ render: rendered });
      if (rendered.status !== "ready") {
        throw new ApiError(rendered.error_text || "Render did not succeed", 500);
      }

      setPhase("done");
      const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      setMessage(`Picture ready · took about ${secs}s`);
      setStageHint(null);
      if (cancelRef.current) return;
      await onDone();
    } catch (err) {
      if (cancelRef.current) return;
      setPhase("idle");
      setMessage("Something stopped the pipeline.");
      setStageHint(null);
      onError(err instanceof ApiError ? err.message : "Pipeline failed");
    } finally {
      setPending(false);
    }
  }, [onDone, onError, onJournal, onProjectChange, orientation, project.orientation, project.project_id, readOnly]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (readOnly) {
      void (async () => {
        setPending(true);
        setMessage("Loading picture…");
        try {
          const rendered = await getLatestRender(project.project_id);
          setRender(rendered);
          onJournal({ render: rendered });
          setPhase("done");
          setMessage("Picture lock");
          if (rendered.duration != null) {
            setSceneSummary(
              `Picture-locked cut · ${rendered.duration.toFixed(1)}s · ${rendered.orientation}${
                rendered.evaluation
                  ? ` · eval ${rendered.evaluation.passed ? "passed" : "failed"}`
                  : ""
              }`,
            );
          }
        } catch (err) {
          onError(err instanceof ApiError ? err.message : "Could not load picture render");
          setPhase("idle");
        } finally {
          setPending(false);
        }
      })();
      return;
    }
    void run();
  }, [onError, onJournal, project.project_id, readOnly, run]);

  const phaseComplete = phase === "done";
  const hasPicture = Boolean(render?.playback_url);
  const pictureReady = hasPicture || phaseComplete;

  return (
    <div className="space-y-8">
      <p className="max-w-xl text-ink-muted">
        {readOnly
          ? "Scenes, story, and picture-locked cut from this project."
          : "Scenes → story → picture-locked cut. Confirm orientation before render — wrong canvas causes black bars."}
      </p>

      {!readOnly ? (
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          <span className="text-ink-muted">Film orientation</span>
          <select
            className="rounded-xl border border-stone-line bg-white px-3 py-2 text-ink"
            value={orientation}
            disabled={pending}
            onChange={(e) => setOrientation(e.target.value as "landscape" | "portrait")}
          >
            <option value="portrait">Portrait (9:16)</option>
            <option value="landscape">Landscape (16:9)</option>
          </select>
        </label>
      ) : null}

      {pictureReady && render?.playback_url ? (
        <FilmPlayer
          key={render.render_id}
          src={render.playback_url}
          orientation={render.orientation || orientation}
        />
      ) : pending ? (
        <ProcessingMotion label={message} orientation={orientation} />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-2xl bg-film text-ivory/60">
          No picture render yet
        </div>
      )}

      {stageHint ? (
        <p className="mono-readout text-xs text-ink-muted" aria-live="polite">
          {stageHint}
        </p>
      ) : null}

      {sceneSummary ? (
        <p className="text-sm leading-relaxed text-ink">{sceneSummary}</p>
      ) : null}

      <ol className="space-y-3 text-sm">
        {(
          [
            ["scenes", "Detect scenes", "Shot boundaries on kept clips"],
            ["direct", "Film Director", "Score moments and write the edit"],
            ["render", "Render picture", "Cards + stitch (silent for music)"],
          ] as const
        ).map(([id, label, detail]) => {
          const order = ["idle", "scenes", "direct", "render", "done"] as const;
          const cur = order.indexOf(phase);
          const mine = order.indexOf(id);
          const done = pictureReady || cur > mine || (id === "render" && hasPicture);
          const active = !done && cur === mine && pending;
          return (
            <li key={id} className={active ? "text-ink" : done ? "text-ink" : "text-ink-muted"}>
              <div>
                <span className="mr-2 text-bronze">{done ? "✓" : active ? "·" : "○"}</span>
                {label}
              </div>
              <p className="mt-1 ml-5 text-xs leading-relaxed opacity-90">{detail}</p>
            </li>
          );
        })}
      </ol>

      {render?.evaluation ? (
        <p className="text-sm text-ink-muted">
          Render evaluation: {render.evaluation.passed ? "passed" : "failed"}
          {render.duration != null ? ` · ${render.duration.toFixed(1)}s` : ""}
          {render.width && render.height ? ` · ${render.width}×${render.height}` : ""}
          {` · ${render.orientation}`}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap gap-3">
          {pending ? (
            <GhostButton
              onClick={() => {
                cancelRef.current = true;
                setCancelled(true);
                setPending(false);
                setPhase("idle");
                setMessage("Cancelled — run again when you are ready.");
              }}
            >
              Cancel
            </GhostButton>
          ) : (
            <PrimaryButton disabled={phaseComplete} onClick={() => void run()}>
              {cancelled || phase === "idle" ? "Direct & render" : "Run again"}
            </PrimaryButton>
          )}
          {pending ? (
            <p className="self-center text-sm text-ink-muted">Working…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SoundtrackStep({
  projectId,
  orientation,
  readOnly = false,
  onError,
  onDone,
  onJournal,
}: {
  projectId: string;
  orientation: string;
  readOnly?: boolean;
  onError: (msg: string | null) => void;
  onDone: () => Promise<void>;
  onJournal: (label: string) => void;
}) {
  const [session, setSession] = useState<SoundtrackSession | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"catalog" | "mute" | "original">("catalog");
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    (force = false) => {
      onError(null);
      startTransition(async () => {
        try {
          let s: SoundtrackSession;
          if (readOnly && !force) {
            s = await getSoundtrack(projectId);
          } else {
            try {
              s = force ? await generateSoundtrack(projectId, { force: true }) : await getSoundtrack(projectId);
              if (!force && s.status !== "ready") {
                s = await generateSoundtrack(projectId, { force: true });
              }
            } catch {
              if (readOnly) throw new Error("Soundtrack not available for review");
              s = await generateSoundtrack(projectId, { force: true });
            }
          }
          setSession(s);
          const selected = s.selected_version_id
            ? s.versions.find((v) => v.version_id === s.selected_version_id)
            : null;
          const firstReady = selected ?? s.versions.find((v) => v.status === "ready");
          setFocusId(firstReady?.version_id ?? null);
          if (s.selected_mode === "mute") setPreviewMode("mute");
          else if (s.selected_mode === "original") setPreviewMode("original");
          else setPreviewMode("catalog");
          try {
            const render = await getLatestRender(projectId);
            setPictureUrl(render.playback_url ?? null);
          } catch {
            setPictureUrl(null);
          }
          if (s.selected_mode === "mute") onJournal("Mute (no music)");
          else if (s.selected_mode === "original") onJournal("Original clip audio");
          else if (firstReady) onJournal(`Catalog · ${firstReady.title}`);
        } catch (err) {
          onError(err instanceof ApiError ? err.message : "Soundtrack generation failed");
        }
      });
    },
    [onError, onJournal, projectId, readOnly],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const versions = useMemo(
    () => (session?.versions ?? []).filter((v) => v.status === "ready").slice(0, 5),
    [session],
  );

  const focused = versions.find((v) => v.version_id === focusId) ?? versions[0];

  const previewUrl =
    previewMode === "catalog"
      ? focused?.playback_url ?? null
      : pictureUrl;

  async function saveChoice(
    choice:
      | { mode: "catalog"; version_id: string; label: string }
      | { mode: "mute"; label: string }
      | { mode: "original"; label: string },
  ) {
    if (readOnly) return;
    onError(null);
    setSaving(true);
    try {
      if (choice.mode === "catalog") {
        await selectSoundtrack(projectId, { mode: "catalog", version_id: choice.version_id });
      } else if (choice.mode === "mute") {
        await selectSoundtrack(projectId, { mode: "mute" });
      } else {
        await selectSoundtrack(projectId, { mode: "original" });
      }
      onJournal(choice.label);
      await onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not save soundtrack choice");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <p className="max-w-xl text-ink-muted">
        {readOnly
          ? "Preview soundtrack options used for this film. Selection is locked in review."
          : "Preview all seven options, then save the one you want. Nothing is locked until you choose."}
      </p>

      {pending && !session ? (
        <ProcessingMotion label="Scoring music and building versions…" orientation={orientation} />
      ) : null}

      {previewUrl ? (
        <div className="animate-focus space-y-3">
          <FilmPlayer
            key={`${previewMode}-${focused?.version_id ?? "picture"}`}
            src={previewUrl}
            orientation={orientation}
            autoPlay
          />
          <p className="text-sm text-ink">
            {previewMode === "catalog" && focused
              ? `${focused.title}${focused.artist ? ` · ${focused.artist}` : ""}`
              : previewMode === "mute"
                ? "Mute (no music)"
                : "Original clip audio (preview is silent picture — save to rebuild with sound)"}
          </p>
        </div>
      ) : null}

      <div>
        <p className="mb-3 text-[11px] tracking-[0.18em] text-ink-muted uppercase">
          5 recommended tracks
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {versions.map((v) => {
            const active = previewMode === "catalog" && v.version_id === focused?.version_id;
            return (
              <button
                key={v.version_id}
                type="button"
                onClick={() => {
                  setPreviewMode("catalog");
                  setFocusId(v.version_id);
                }}
                className={`rounded-xl border px-3 py-4 text-left transition ${
                  active
                    ? "border-bronze bg-bronze/10"
                    : "border-stone-line bg-ivory-deep/20 hover:border-ink/25"
                }`}
              >
                <p className="text-xs tracking-widest text-ink-muted uppercase">
                  {String(v.rank).padStart(2, "0")}
                  {v.score != null ? ` · ${v.score.toFixed(1)}` : ""}
                </p>
                <p className="mt-1 font-medium text-ink">{v.title}</p>
                {v.tags.length > 0 ? (
                  <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{v.tags.join(" · ")}</p>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-3 text-[11px] tracking-[0.18em] text-ink-muted uppercase">
          Plus mute &amp; original
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPreviewMode("mute")}
            className={`rounded-xl border px-4 py-4 text-left transition ${
              previewMode === "mute"
                ? "border-bronze bg-bronze/10"
                : "border-stone-line bg-ivory-deep/20 hover:border-ink/25"
            }`}
          >
            <p className="font-medium text-ink">Mute</p>
            <p className="mt-1 text-xs text-ink-muted">No music under the picture</p>
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode("original")}
            className={`rounded-xl border px-4 py-4 text-left transition ${
              previewMode === "original"
                ? "border-bronze bg-bronze/10"
                : "border-stone-line bg-ivory-deep/20 hover:border-ink/25"
            }`}
          >
            <p className="font-medium text-ink">Original sound</p>
            <p className="mt-1 text-xs text-ink-muted">Keep audio from your clips</p>
          </button>
        </div>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-3">
          <PrimaryButton
            disabled={pending || saving || (previewMode === "catalog" && !focused)}
            onClick={() => {
              if (previewMode === "catalog" && focused) {
                void saveChoice({
                  mode: "catalog",
                  version_id: focused.version_id,
                  label: `Catalog · ${focused.title}`,
                });
              } else if (previewMode === "mute") {
                void saveChoice({ mode: "mute", label: "Mute (no music)" });
              } else {
                void saveChoice({ mode: "original", label: "Original clip audio" });
              }
            }}
          >
            {saving ? "Saving…" : "Save this soundtrack"}
          </PrimaryButton>
          <GhostButton disabled={pending || saving} onClick={() => load(true)}>
            Refresh versions
          </GhostButton>
        </div>
      ) : null}
    </div>
  );
}

function GradingStep({
  projectId,
  orientation,
  readOnly = false,
  onError,
  onDone,
  onChangeSong,
}: {
  projectId: string;
  orientation: string;
  readOnly?: boolean;
  onError: (msg: string | null) => void;
  onDone: () => Promise<void>;
  onChangeSong: () => void;
}) {
  const [view, setView] = useState<"after" | "before" | "both">("both");
  const [gradedUrl, setGradedUrl] = useState<string | null>(null);
  const [ungradedUrl, setUngradedUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const render = await getLatestRender(projectId);
        const before = render.ungraded_playback_url ?? null;
        const after = render.playback_url ?? null;
        if (!cancelled) {
          setGradedUrl(after);
          setUngradedUrl(before);
          if (!before) setView("after");
        }
      } catch (err) {
        if (!cancelled) onError(err instanceof ApiError ? err.message : "Could not load grade previews");
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError, projectId]);

  const activeUrl = view === "before" ? ungradedUrl ?? gradedUrl : gradedUrl;

  return (
    <div className="space-y-8">
      <p className="max-w-xl text-ink-muted">
        {readOnly
          ? "Color grade comparison for this film. Before is ungraded; After is graded."
          : "Compare color grade before you finish. After is the graded film; Before is the ungraded picture lock."}
      </p>

      <div className="flex flex-wrap gap-2">
        {ungradedUrl ? (
          <button
            type="button"
            onClick={() => setView("both")}
            className={`rounded-xl border px-4 py-2 text-sm ${
              view === "both" ? "border-bronze bg-bronze/10 text-ink" : "border-stone-line text-ink-muted"
            }`}
          >
            Before / after
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setView("after")}
          className={`rounded-xl border px-4 py-2 text-sm ${
            view === "after" ? "border-bronze bg-bronze/10 text-ink" : "border-stone-line text-ink-muted"
          }`}
        >
          After (graded)
        </button>
        <button
          type="button"
          onClick={() => setView("before")}
          disabled={!ungradedUrl}
          className={`rounded-xl border px-4 py-2 text-sm ${
            view === "before" ? "border-bronze bg-bronze/10 text-ink" : "border-stone-line text-ink-muted"
          }`}
        >
          Before (ungraded)
        </button>
      </div>

      {pending ? (
        <div
          className={`flex items-center justify-center rounded-2xl bg-film text-ivory/60 ${
            orientation === "portrait" ? "mx-auto aspect-[9/16] max-h-[70vh] max-w-sm" : "aspect-video"
          }`}
        >
          Loading…
        </div>
      ) : view === "both" && gradedUrl && ungradedUrl ? (
        <div
          className={`grid gap-4 ${
            orientation === "portrait" ? "mx-auto max-w-3xl sm:grid-cols-2" : "lg:grid-cols-2"
          }`}
        >
          <div className="space-y-2">
            <p className="mono-readout text-[11px] tracking-[0.14em] text-ink-muted uppercase">
              Before · ungraded
            </p>
            <FilmPlayer key={`before-${ungradedUrl}`} src={ungradedUrl} orientation={orientation} />
          </div>
          <div className="space-y-2">
            <p className="mono-readout text-[11px] tracking-[0.14em] text-ink-muted uppercase">
              After · graded
            </p>
            <FilmPlayer key={`after-${gradedUrl}`} src={gradedUrl} orientation={orientation} />
          </div>
        </div>
      ) : activeUrl ? (
        <FilmPlayer key={`${view}-${activeUrl}`} src={activeUrl} orientation={orientation} />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-2xl bg-film text-ivory/60">
          No preview URL
        </div>
      )}

      {!ungradedUrl && !pending ? (
        <p className="text-sm text-ink-muted">
          Ungraded twin not found for this render — showing graded only. Re-render picture to
          generate a before/after pair.
        </p>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap gap-3">
          <PrimaryButton
            disabled={saving || !gradedUrl}
            onClick={() => {
              setSaving(true);
              void (async () => {
                try {
                  await confirmGrade(projectId);
                  await onDone();
                } catch (err) {
                  onError(err instanceof ApiError ? err.message : "Could not confirm grade");
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            {saving ? "Saving…" : "Keep graded film"}
          </PrimaryButton>
          <GhostButton disabled={saving} onClick={onChangeSong}>
            Change soundtrack
          </GhostButton>
        </div>
      ) : null}
    </div>
  );
}

function formatSessionEndedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function CompleteStep({
  projectId,
  orientation,
  sessionEndedAt,
  onError,
  onChangeSong,
  onReviewGrade,
}: {
  projectId: string;
  orientation: string;
  sessionEndedAt: string | null;
  onError: (msg: string | null) => void;
  onChangeSong: () => void;
  onReviewGrade?: () => void;
}) {
  const [archive, setArchive] = useState<ProjectArchive | null>(null);
  const [pending, setPending] = useState(true);
  const [showSessionNotice, setShowSessionNotice] = useState(false);
  const [focusRole, setFocusRole] = useState<"ungraded" | "graded" | "selected">("selected");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getProjectArchive(projectId);
        if (cancelled) return;
        setArchive(data);
        const ended = data.session_ended_at ?? sessionEndedAt;
        if (ended) setShowSessionNotice(true);
        const selected = data.videos.find((v) => v.role === "selected" && v.playback_url);
        setFocusRole(selected ? "selected" : data.videos.find((v) => v.playback_url)?.role ?? "selected");
      } catch (err) {
        if (!cancelled) onError(err instanceof ApiError ? err.message : "Could not load retained films");
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError, projectId, sessionEndedAt]);

  const endedAt = archive?.session_ended_at ?? sessionEndedAt;
  const videos = archive?.videos ?? [];
  const focused = videos.find((v) => v.role === focusRole) ?? videos[0];
  const orient = archive?.orientation ?? orientation;

  return (
    <div className="space-y-8">
      <NoticeModal
        open={showSessionNotice}
        title="This session has ended"
        acknowledgeLabel="Got it"
        onAcknowledge={() => setShowSessionNotice(false)}
      >
        <p>
          We do not store your data beyond the latest session. Any assets you uploaded and some of
          the 5 recommended results have been deleted. Only the color-graded Before &amp; After
          comparison remains, with the music muted.
        </p>
        {endedAt ? (
          <p className="mono-readout text-xs tracking-[0.06em] text-ink">
            Session ended · {formatSessionEndedAt(endedAt)}
          </p>
        ) : null}
      </NoticeModal>

      <p className="max-w-xl text-ink-muted">
        Three retained cuts: before grade, after grade (muted), and your soundtrack choice.
        {endedAt ? ` Session ended ${formatSessionEndedAt(endedAt)}.` : ""}
      </p>

      {pending ? (
        <div
          className={`overflow-hidden rounded-2xl bg-film ${
            orient === "portrait" ? "mx-auto max-w-sm" : ""
          }`}
        >
          <div
            className={`flex items-center justify-center text-ivory/60 ${
              orient === "portrait" ? "aspect-[9/16] max-h-[70vh]" : "aspect-video"
            }`}
          >
            Loading…
          </div>
        </div>
      ) : focused?.playback_url ? (
        <FilmPlayer
          key={`${focused.role}-${focused.playback_url}`}
          src={focused.playback_url}
          orientation={orient}
        />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-2xl bg-film text-ivory/60">
          No retained videos
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {videos.map((v) => {
          const active = v.role === focused?.role;
          return (
            <button
              key={v.role}
              type="button"
              disabled={!v.playback_url}
              onClick={() => setFocusRole(v.role)}
              className={`rounded-xl border px-4 py-4 text-left transition disabled:opacity-40 ${
                active
                  ? "border-bronze bg-bronze/10"
                  : "border-stone-line bg-ivory-deep/20 hover:border-ink/25"
              }`}
            >
              <p className="text-[11px] tracking-[0.16em] text-ink-muted uppercase">
                {v.role === "ungraded" ? "01 Before" : v.role === "graded" ? "02 After" : "03 Selected"}
              </p>
              <p className="mt-1 text-sm font-medium text-ink">{v.label}</p>
              {v.muted ? (
                <p className="mt-1 text-xs text-ink-muted">Music muted</p>
              ) : null}
            </button>
          );
        })}
      </div>

      {focused?.playback_url ? (
        <div className="flex flex-wrap gap-3">
          <a
            href={focused.playback_url}
            download
            className="inline-flex items-center justify-center rounded-xl bg-bronze px-6 py-3 text-sm font-medium tracking-wide text-ivory transition hover:bg-bronze-deep"
          >
            Download this MP4
          </a>
          {endedAt ? (
            <GhostButton onClick={() => setShowSessionNotice(true)}>Session notice</GhostButton>
          ) : null}
          {onReviewGrade ? (
            <GhostButton onClick={onReviewGrade}>View grade</GhostButton>
          ) : null}
          {!endedAt ? <GhostButton onClick={onChangeSong}>Change song</GhostButton> : null}
        </div>
      ) : null}
    </div>
  );
}
