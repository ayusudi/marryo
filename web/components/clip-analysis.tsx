"use client";

import { useState } from "react";

import type { ApiClip, ValidationCheck } from "@/lib/api";

const WARNING_COPY: Record<string, string> = {
  near_black: "Too dark — most sampled frames are near black.",
  overexposed: "Overexposed — highlights are blown out.",
  too_blurry: "Too soft — sharpness is below the usable threshold.",
  no_faces: "No faces found in sampled frames.",
  no_frames: "No decodable video frames.",
  assess_error: "Visual analysis failed while reading this file.",
};

function warnText(code: string): string {
  return WARNING_COPY[code] ?? code.replaceAll("_", " ");
}

function formatScore(score: number): string {
  return score % 1 !== 0 ? score.toFixed(2) : String(score);
}

/** Build check rows from stored validation (new structured checks, or legacy metrics). */
export function checksForClip(clip: ApiClip): ValidationCheck[] {
  const vw = clip.validation_warnings;
  if (!vw) return [];
  if (vw.checks?.length) return vw.checks;

  const { brightness, blur, faceCount } = vw.metrics;
  const warnings = new Set(vw.warnings);
  const frames = vw.frames_sampled ?? 8;

  return [
    {
      id: "brightness",
      label: "Brightness",
      passed: !warnings.has("near_black") && !warnings.has("overexposed"),
      score: brightness,
      unit: "0–1 mean luma",
      threshold: "0.08–0.92",
      reason: warnings.has("near_black")
        ? `Failed — mean brightness ${brightness.toFixed(2)} is too dark (need 0.08–0.92).`
        : warnings.has("overexposed")
          ? `Failed — mean brightness ${brightness.toFixed(2)} exceeds 0.92.`
          : `Passed — mean brightness ${brightness.toFixed(2)} sits inside 0.08–0.92.`,
      detail:
        "Average gray-level across evenly sampled frames (0 = black, 1 = white). Mid-range values keep faces and venue detail readable.",
      implication: warnings.has("near_black") || warnings.has("overexposed")
        ? "Excluded from the story cut for exposure."
        : "Usable lighting for later scene analysis.",
    },
    {
      id: "sharpness",
      label: "Sharpness",
      passed: !warnings.has("too_blurry"),
      score: blur,
      unit: "Laplacian variance",
      threshold: "≥ 15",
      reason: warnings.has("too_blurry")
        ? `Failed — sharpness ${blur.toFixed(1)} is below 15.0.`
        : `Passed — sharpness ${blur.toFixed(1)} clears ≥ 15.`,
      detail:
        "Laplacian variance on grayscale frames: higher means more edge energy. Low scores usually mean motion blur, soft focus, or heavy compression.",
      implication: warnings.has("too_blurry")
        ? "Too soft for a large-screen highlight film."
        : "Clear enough for scored moments and render.",
    },
    {
      id: "faces",
      label: "Faces",
      passed: !warnings.has("no_faces") && faceCount > 0,
      score: faceCount,
      unit: "detections in samples",
      threshold: "≥ 1",
      reason:
        warnings.has("no_faces") || faceCount === 0
          ? `Failed — 0 face detections across ~${frames} samples (need ≥ 1).`
          : `Passed — ${faceCount} face detection(s) across sampled frames.`,
      detail:
        "OpenCV Haar frontal-face detector on each sample. This is a presence signal, not a unique-person count — the same face can count more than once.",
      implication:
        warnings.has("no_faces") || faceCount === 0
          ? "Cannot feed People labeling or couple-led story beats."
          : "Eligible for People labeling and people-led moments.",
    },
  ];
}

export function summaryForClip(clip: ApiClip): string {
  const vw = clip.validation_warnings;
  if (vw?.summary) return vw.summary;
  if (clip.valid) {
    const m = vw?.metrics;
    return m
      ? `This clip looks usable for the short film — lighting ${m.brightness.toFixed(2)}, sharpness ${m.blur.toFixed(1)}, faces detected.`
      : "This clip looks usable for the short film.";
  }
  if (!vw?.warnings.length) return "This clip was rejected during validation.";
  return vw.warnings.map(warnText).join(" ");
}

export function verdictDetailForClip(clip: ApiClip): string {
  const vw = clip.validation_warnings;
  if (vw?.verdict_detail) return vw.verdict_detail;
  if (clip.valid) {
    return "We can use this footage in People labeling and the story cut.";
  }
  if (vw?.warnings.includes("near_black")) {
    return "Too dark overall — faces and venue detail will not read on a large screen.";
  }
  if (vw?.warnings.includes("overexposed")) {
    return "Highlights are blown out — detail is lost in bright areas.";
  }
  if (vw?.warnings.includes("too_blurry")) {
    return "Too soft or motion-blurred for a highlight film.";
  }
  if (vw?.warnings.includes("no_faces")) {
    return "No faces found in samples — harder to build a couple-led story from this clip alone.";
  }
  return "This clip will not enter identity clustering or the Film Director pool.";
}

function scoreBarWidth(check: ValidationCheck): string {
  if (check.id === "brightness") {
    return `${Math.max(0, Math.min(100, check.score * 100))}%`;
  }
  if (check.id === "sharpness") {
    return `${Math.max(0, Math.min(100, (check.score / 60) * 100))}%`;
  }
  if (check.id === "faces") {
    return `${Math.max(0, Math.min(100, check.score * 25))}%`;
  }
  return `${Math.max(0, Math.min(100, check.score))}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

const FLOW_STEPS = [
  { n: "01", title: "Footage", body: "Up to 6 clips · validate & keep", stepId: "upload" },
  { n: "02", title: "People", body: "Optional bride / groom labels", stepId: "identity" },
  { n: "03", title: "Direct", body: "Scenes → score → EDL → render (~1 min)", stepId: "pipeline" },
  { n: "04", title: "Soundtrack", body: "Choose 1 of 7: 5 tracks, mute, or original", stepId: "soundtrack" },
  { n: "05", title: "Grade", body: "Compare before / after color grade", stepId: "grading" },
  { n: "06", title: "Short film", body: "Download retained cuts · session notice", stepId: "complete" },
] as const;

const ANALYZE_STEPS = [
  { n: "01", title: "Container", body: "Format, size, ffprobe duration" },
  { n: "02", title: "Brightness", body: "Mean luma 0.08–0.92" },
  { n: "03", title: "Sharpness", body: "Laplacian variance ≥ 15" },
  { n: "04", title: "Faces", body: "≥ 1 Haar detection in samples" },
] as const;

/** Compact process panel — flow + analysis, one expandable surface. */
export function StudioProcessPanel({
  journal,
  unlockedStepIds,
  onNavigateStep,
}: {
  /** Live decisions from this project (readable after the fact). */
  journal?: Array<{ title: string; body: string }>;
  unlockedStepIds?: string[];
  onNavigateStep?: (stepId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const unlocked = new Set(unlockedStepIds ?? []);

  return (
    <div className="border border-ink/10 bg-white/40 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/50"
        aria-expanded={open}
      >
        <div>
          <p className="text-[11px] tracking-[0.2em] text-ink-muted uppercase">Process</p>
          <p className="mt-1 text-sm text-ink">
            {journal?.length
              ? `${journal.length} decision${journal.length === 1 ? "" : "s"} · flow & analysis`
              : "Pipeline gates · visual scoring · what Kept means"}
          </p>
        </div>
        <span className="mono-readout text-xs tracking-[0.14em] text-bronze">
          {open ? "CLOSE" : "OPEN"}
        </span>
      </button>

      {open ? (
        <div className="animate-fade border-t border-ink/8 px-5 py-5">
          {journal && journal.length > 0 ? (
            <div className="mb-8">
              <p className="text-[11px] tracking-[0.18em] text-ink-muted uppercase">
                This project
              </p>
              <ol className="mt-4 space-y-3">
                {journal.map((entry, i) => (
                  <li key={`${entry.title}-${i}`} className="flex gap-3 text-sm">
                    <span className="mono-readout text-bronze">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <span className="text-ink">{entry.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                        {entry.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <p className="text-[11px] tracking-[0.18em] text-ink-muted uppercase">Film flow</p>
              <ol className="mt-4 space-y-3">
                {FLOW_STEPS.map((step) => {
                  const canOpen = unlocked.has(step.stepId) && onNavigateStep;
                  return (
                    <li key={step.n} className="flex gap-3 text-sm">
                      <span className="mono-readout text-bronze">{step.n}</span>
                      <span className="min-w-0">
                        {canOpen ? (
                          <button
                            type="button"
                            onClick={() => {
                              onNavigateStep(step.stepId);
                              setOpen(false);
                            }}
                            className="text-left text-ink underline-offset-2 hover:underline"
                          >
                            {step.title}
                          </button>
                        ) : (
                          <span className="text-ink">{step.title}</span>
                        )}
                        <span className="mt-0.5 block text-xs text-ink-muted">{step.body}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div>
              <p className="text-[11px] tracking-[0.18em] text-ink-muted uppercase">
                Per-clip analysis
              </p>
              <ol className="mt-4 space-y-3">
                {ANALYZE_STEPS.map((step) => (
                  <li key={step.n} className="flex gap-3 text-sm">
                    <span className="mono-readout text-bronze">{step.n}</span>
                    <span>
                      <span className="text-ink">{step.title}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">{step.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 text-xs leading-relaxed text-ink-muted">
                A clip is Kept only when every visual check passes. Rejected clips stay listed with
                scores so you can see exactly what failed.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated use StudioProcessPanel */
export function StudioFlowExplainer() {
  return <StudioProcessPanel />;
}

/** @deprecated use StudioProcessPanel */
export function AnalysisProcessLegend() {
  return null;
}

export function ClipAnalysisList({
  clips,
  uploadErrors = [],
}: {
  clips: ApiClip[];
  uploadErrors?: Array<{ filename: string; error: string }>;
}) {
  if (clips.length === 0 && uploadErrors.length === 0) return null;

  const kept = clips.filter((c) => c.valid).length;
  const rejected = clips.filter((c) => c.valid === false).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/10 pb-4">
        <div>
          <p className="text-[11px] tracking-[0.2em] text-ink-muted uppercase">Results</p>
          <p className="font-display mt-1 text-2xl tracking-[-0.02em] text-ink">Clip analysis</p>
        </div>
        <p className="mono-readout text-xs text-ink-muted">
          <span className="text-signal">{kept} kept</span>
          {rejected ? <span className="text-alert"> · {rejected} out</span> : null}
          {uploadErrors.length ? ` · ${uploadErrors.length} upload fail` : ""}
        </p>
      </div>

      <ul className="space-y-3">
        {uploadErrors.map((err) => (
          <li
            key={`err-${err.filename}-${err.error}`}
            className="border border-alert/20 bg-alert-soft/60 px-5 py-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="truncate text-sm font-medium text-ink">{err.filename}</p>
              <span className="mono-readout text-[10px] tracking-[0.16em] text-alert uppercase">
                Upload failed
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-alert">{err.error}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              Failed a technical gate before visual scoring — fix and re-upload.
            </p>
          </li>
        ))}

        {clips.map((clip) => (
          <ClipAnalysisCard key={clip.clip_id} clip={clip} />
        ))}
      </ul>
    </div>
  );
}

function ClipAnalysisCard({ clip }: { clip: ApiClip }) {
  const checks = checksForClip(clip);
  const summary = summaryForClip(clip);
  const verdictDetail = verdictDetailForClip(clip);
  const vw = clip.validation_warnings ?? null;
  const kept = clip.valid === true;
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const passedCount = checks.filter((c) => c.passed).length;

  return (
    <li
      className={`animate-fade border bg-white/45 backdrop-blur-sm transition ${
        kept ? "border-ink/10" : "border-alert/20"
      }`}
    >
      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
        <div className="relative w-full shrink-0 overflow-hidden rounded-lg bg-ink/5 sm:w-40">
          {playing && clip.playback_url ? (
            <video
              src={clip.playback_url}
              controls
              autoPlay
              playsInline
              className="aspect-video w-full object-cover"
              onEnded={() => setPlaying(false)}
            />
          ) : clip.thumbnail_url ? (
            <button
              type="button"
              className="group relative block aspect-video w-full"
              onClick={() => clip.playback_url && setPlaying(true)}
              aria-label={`Play ${clip.filename}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={clip.thumbnail_url} alt="" className="h-full w-full object-cover" />
              {clip.playback_url ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-ivory opacity-90 transition group-hover:bg-black/35">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-ivory/40 bg-black/40">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M8 5.14v13.72L19 12 8 5.14z" />
                    </svg>
                  </span>
                </span>
              ) : null}
            </button>
          ) : (
            <div className="flex aspect-video items-center justify-center text-xs text-ink-muted">
              No preview
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`mono-readout px-2 py-0.5 text-[10px] tracking-[0.16em] uppercase ${
                    kept ? "bg-signal-soft text-signal" : "bg-alert-soft text-alert"
                  }`}
                >
                  {kept ? "Kept" : clip.valid === false ? "Rejected" : clip.status}
                </span>
                <p className="truncate text-sm font-medium text-ink">{clip.filename}</p>
              </div>
              <p className="mono-readout mt-2 text-xs text-ink-muted">
                {formatDuration(clip.duration)}
                {vw?.frames_sampled != null ? ` · ${vw.frames_sampled} frames` : ""}
                {checks.length > 0 ? ` · ${passedCount}/${checks.length} checks` : ""}
              </p>
              <p className={`mt-3 text-sm leading-relaxed ${kept ? "text-ink" : "text-alert"}`}>
                {summary}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mono-readout shrink-0 text-[11px] tracking-[0.14em] text-bronze transition hover:text-bronze-deep"
              aria-expanded={expanded}
            >
              {expanded ? "LESS" : "DETAIL"}
            </button>
          </div>
        </div>
      </div>

      {vw?.metrics ? (
        <div className="grid grid-cols-3 border-t border-ink/8">
          {(
            [
              ["BRIGHT", vw.metrics.brightness.toFixed(2), "0.08–0.92"],
              ["SHARP", vw.metrics.blur.toFixed(1), "≥ 15"],
              ["FACES", String(vw.metrics.faceCount), "≥ 1"],
            ] as const
          ).map(([label, value, need], i) => (
            <div
              key={label}
              className={`px-5 py-3 ${i > 0 ? "border-l border-ink/8" : ""}`}
            >
              <p className="mono-readout text-[10px] tracking-[0.18em] text-ink-muted">{label}</p>
              <p className="font-display mono-readout mt-1 text-xl text-ink">{value}</p>
              <p className="mono-readout mt-0.5 text-[10px] text-ink-muted/80">{need}</p>
            </div>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="animate-fade border-t border-ink/8 px-5 py-4">
          <p className="text-sm leading-relaxed text-ink-muted">{verdictDetail}</p>

          {checks.length > 0 ? (
            <ul className="mt-4 space-y-1">
              {checks.map((check) => {
                const open = openId === check.id;
                return (
                  <li key={check.id} className="border border-ink/8 bg-ivory/40">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : check.id)}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm text-ink">
                          <span
                            className={`mono-readout text-[10px] tracking-[0.14em] ${
                              check.passed ? "text-signal" : "text-alert"
                            }`}
                          >
                            {check.passed ? "PASS" : "FAIL"}
                          </span>
                          {check.label}
                        </span>
                        <span className="mt-1 block text-xs text-ink-muted line-clamp-1">
                          {check.reason}
                        </span>
                      </span>
                      <span className="mono-readout shrink-0 text-right text-xs text-ink">
                        {formatScore(check.score)}
                      </span>
                    </button>

                    {open ? (
                      <div className="space-y-3 border-t border-ink/8 px-4 py-3">
                        <div className="h-px overflow-hidden bg-ink/10">
                          <div
                            className={`h-full ${check.passed ? "bg-signal" : "bg-alert/70"}`}
                            style={{ width: scoreBarWidth(check) }}
                          />
                        </div>
                        {check.unit ? (
                          <p className="mono-readout text-[11px] text-ink-muted">
                            {check.unit}
                            {check.threshold ? ` · pass ${check.threshold}` : ""}
                          </p>
                        ) : null}
                        {check.detail ? (
                          <div>
                            <p className="text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                              Measurement
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-ink">{check.detail}</p>
                          </div>
                        ) : null}
                        {check.implication ? (
                          <div>
                            <p className="text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                              For your short film
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-ink">
                              {check.implication}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {vw?.warnings.length && !kept ? (
            <p className="mono-readout mt-4 text-[10px] tracking-[0.08em] text-ink-muted">
              {vw.warnings.map((w) => w.replaceAll("_", " ")).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
