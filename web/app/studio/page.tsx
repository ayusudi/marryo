"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  ApiError,
  createProject,
  listProjects,
  type ApiProjectSummary,
  type CoupleName,
} from "@/lib/api";
import {
  ErrorNote,
  FieldInput,
  FieldLabel,
  FieldSelect,
  GhostButton,
  PrimaryButton,
  StudioChrome,
} from "@/components/ui";

const MOODS = ["warm", "romantic", "cinematic", "joyful", "playful"] as const;
const TARGET_LENGTHS = [30, 60, 90] as const;

function capitalizeLabel(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function nearestTargetLength(seconds: number): (typeof TARGET_LENGTHS)[number] {
  if ((TARGET_LENGTHS as readonly number[]).includes(seconds)) {
    return seconds as (typeof TARGET_LENGTHS)[number];
  }
  return TARGET_LENGTHS.reduce((best, n) =>
    Math.abs(n - seconds) < Math.abs(best - seconds) ? n : best,
  );
}

/** Short list title: "10/10 Portrait 30s" — DD/MM from project created_at. */
function projectShortLabel(project: ApiProjectSummary): string {
  const datePart = formatDayMonth(project.created_at);
  const orient = capitalizeLabel(project.orientation);
  const duration = `${Math.round(project.max_duration || 0)}s`;
  return `${datePart} ${orient} ${duration}`;
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

function coupleLabel(project: ApiProjectSummary): string {
  const names = project.couple_names.map((c) => c.name).filter(Boolean);
  if (names.length >= 2) return `${names[0]} & ${names[1]}`;
  return names[0] ?? project.film_title ?? "Untitled short film";
}

function stageLabel(stage: string, status: string): string {
  if (status === "complete" || stage === "complete") return "Complete";
  const map: Record<string, string> = {
    upload: "Footage",
    validated: "Footage",
    identity: "People",
    analysing: "Direct",
    directing: "Direct",
    rendering: "Direct",
    soundtrack: "Soundtrack",
    grading: "Grade",
    ready: "Short film",
  };
  return map[stage] ?? stage;
}

export default function StudioDashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ApiProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();
  const [bride, setBride] = useState("");
  const [groom, setGroom] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [mood, setMood] = useState<(typeof MOODS)[number]>("warm");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("portrait");
  const [maxDuration, setMaxDuration] = useState<(typeof TARGET_LENGTHS)[number]>(90);
  const [visualTone, setVisualTone] = useState("");
  const [endingMessage, setEndingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [usePrevious, setUsePrevious] = useState(false);

  const latest = projects[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listProjects();
        if (!cancelled) setProjects(res.projects);
      } catch (err) {
        if (!cancelled) {
          setListError(err instanceof ApiError ? err.message : "Could not load projects");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const previousSummary = useMemo(() => {
    if (!latest) return null;
    return `${projectShortLabel(latest)} · ${coupleLabel(latest)} · ${capitalizeLabel(latest.mood ?? "mood n/a")}`;
  }, [latest]);

  function applyPrevious(checked: boolean) {
    setUsePrevious(checked);
    if (!checked || !latest) return;
    const brideName = latest.couple_names.find((c) => c.role === "bride")?.name ?? "";
    const groomName = latest.couple_names.find((c) => c.role === "groom")?.name ?? "";
    // Fallback if roles missing: first / second
    setBride(brideName || latest.couple_names[0]?.name || "");
    setGroom(groomName || latest.couple_names[1]?.name || "");
    setWeddingDate(latest.wedding_date ?? "");
    if (latest.mood && (MOODS as readonly string[]).includes(latest.mood)) {
      setMood(latest.mood as (typeof MOODS)[number]);
    }
    setOrientation(latest.orientation === "portrait" ? "portrait" : "landscape");
    setMaxDuration(nearestTargetLength(latest.max_duration || 90));
    setVisualTone(latest.visual_tone ?? "");
    setEndingMessage(latest.ending_message ?? "");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const couple_names: CoupleName[] = [];
    if (bride.trim()) couple_names.push({ name: bride.trim(), role: "bride" });
    if (groom.trim()) couple_names.push({ name: groom.trim(), role: "groom" });
    if (couple_names.length === 0) {
      setError("Add at least one name.");
      return;
    }

    startTransition(async () => {
      try {
        const project = await createProject({
          couple_names,
          wedding_date: weddingDate.trim() || undefined,
          mood,
          orientation,
          max_duration: maxDuration,
          visual_tone: visualTone.trim() || undefined,
          ending_message: endingMessage.trim() || undefined,
        });
        router.push(`/studio/${project.project_id}`);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not create project");
      }
    });
  }

  return (
    <StudioChrome title="Dashboard" subtitle="Your short films">
      <div className="animate-fade grid gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/10 pb-4">
            <div>
              <p className="text-[11px] tracking-[0.2em] text-ink-muted uppercase">Projects</p>
              <h2 className="font-display mt-1 text-2xl tracking-[-0.02em] text-ink">
                Short films you’ve started
              </h2>
            </div>
            <p className="mono-readout text-xs text-ink-muted">
              {loading ? "…" : `${projects.length} total`}
            </p>
          </div>

          {listError ? <ErrorNote>{listError}</ErrorNote> : null}

          {loading ? (
            <p className="text-sm text-ink-muted">Loading your projects…</p>
          ) : projects.length === 0 ? (
            <div className="border border-dashed border-ink/15 bg-white/40 px-5 py-10 text-sm text-ink-muted">
              No short films yet. Create your first project on the right — footage is added after setup.
            </div>
          ) : (
            <ul className="divide-y divide-ink/8 border-y border-ink/8">
              {projects.map((project) => (
                <li key={project.project_id}>
                  <Link
                    href={`/studio/${project.project_id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-4 transition hover:bg-white/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{projectShortLabel(project)}</p>
                      <p className="mono-readout mt-1 text-[11px] text-ink-muted">
                        {stageLabel(project.current_stage, project.status)}
                        {" · "}
                        {project.valid_clip_count}/{project.clip_count} clips kept
                        {project.mood ? ` · ${capitalizeLabel(project.mood)}` : ""}
                      </p>
                    </div>
                    <span className="mono-readout shrink-0 text-[11px] tracking-[0.12em] text-bronze">
                      OPEN
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="new" className="scroll-mt-8 border border-ink/10 bg-white/45 px-5 py-6 backdrop-blur-sm sm:px-6">
          <p className="text-[11px] tracking-[0.2em] text-ink-muted uppercase">New short film</p>
          <h2 className="font-display mt-1 text-2xl tracking-[-0.02em] text-ink">Begin a project</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Set couple details and creative prefs. Upload footage on the next step — video is never
            copied from an older project.
          </p>

          {latest ? (
            <label className="mt-5 flex cursor-pointer items-start gap-3 border border-ink/10 bg-ivory/50 px-4 py-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={usePrevious}
                onChange={(e) => applyPrevious(e.target.checked)}
                data-testid="prefill-previous"
              />
              <span>
                <span className="font-medium text-ink">Use details from last project</span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-muted">
                  Prefills names, date, mood, orientation, length, tone, and ending message from{" "}
                  {previousSummary}. Does not copy clips or renders.
                </span>
              </span>
            </label>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <FieldLabel>Bride</FieldLabel>
                <FieldInput
                  value={bride}
                  onChange={(e) => setBride(e.target.value)}
                  placeholder="Name"
                  autoComplete="off"
                />
              </div>
              <div>
                <FieldLabel>Groom</FieldLabel>
                <FieldInput
                  value={groom}
                  onChange={(e) => setGroom(e.target.value)}
                  placeholder="Name"
                  autoComplete="off"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Wedding date (optional)</FieldLabel>
              <FieldInput
                type="date"
                value={weddingDate}
                onChange={(e) => setWeddingDate(e.target.value)}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <FieldLabel>Mood</FieldLabel>
                <FieldSelect value={mood} onChange={(e) => setMood(e.target.value as typeof mood)}>
                  {MOODS.map((m) => (
                    <option key={m} value={m}>
                      {capitalizeLabel(m)}
                    </option>
                  ))}
                </FieldSelect>
              </div>
              <div>
                <FieldLabel>Orientation</FieldLabel>
                <FieldSelect
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as "landscape" | "portrait")}
                >
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </FieldSelect>
              </div>
            </div>

            <div>
              <FieldLabel>Target length</FieldLabel>
              <div className="flex gap-2" role="group" aria-label="Target length">
                {TARGET_LENGTHS.map((seconds) => {
                  const selected = maxDuration === seconds;
                  return (
                    <button
                      key={seconds}
                      type="button"
                      onClick={() => setMaxDuration(seconds)}
                      aria-pressed={selected}
                      className={`flex-1 rounded-lg border px-4 py-3 text-sm transition ${
                        selected
                          ? "border-bronze bg-bronze text-ivory"
                          : "border-ink/12 bg-white/50 text-ink hover:border-ink/25"
                      }`}
                    >
                      {seconds}s
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <FieldLabel>Visual tone (optional)</FieldLabel>
              <FieldInput
                value={visualTone}
                onChange={(e) => setVisualTone(e.target.value)}
                placeholder="e.g. cinematic, soft, documentary"
                autoComplete="off"
              />
            </div>

            <div>
              <FieldLabel>Ending message (optional)</FieldLabel>
              <FieldInput
                value={endingMessage}
                onChange={(e) => setEndingMessage(e.target.value)}
                placeholder="e.g. Forever starts here"
                autoComplete="off"
              />
            </div>

            <ErrorNote>{error}</ErrorNote>

            <div className="flex flex-wrap gap-3 pt-1">
              <PrimaryButton type="submit" disabled={pending} data-testid="create-project">
                {pending ? "Creating…" : "Continue to footage"}
              </PrimaryButton>
              {usePrevious ? (
                <GhostButton
                  type="button"
                  onClick={() => {
                    setUsePrevious(false);
                    setBride("");
                    setGroom("");
                    setWeddingDate("");
                    setMood("warm");
                    setOrientation("portrait");
                    setMaxDuration(90);
                    setVisualTone("");
                    setEndingMessage("");
                  }}
                >
                  Clear prefill
                </GhostButton>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </StudioChrome>
  );
}
