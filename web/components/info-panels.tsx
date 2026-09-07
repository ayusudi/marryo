import type { ReactNode } from "react";

export function InfoH2({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-xl tracking-[-0.02em] text-ink">{children}</h2>;
}

export function InfoLead({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-base leading-relaxed text-ink-muted sm:text-lg">{children}</p>;
}

export function InfoTitle({
  eyebrow,
  title,
  updated,
  hideEyebrow = false,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  hideEyebrow?: boolean;
}) {
  return (
    <header>
      {!hideEyebrow ? (
        <p className="text-[11px] tracking-[0.22em] text-ink-muted uppercase">{eyebrow}</p>
      ) : null}
      <h1
        className={`font-display tracking-[-0.03em] text-balance text-ink sm:text-4xl ${
          hideEyebrow ? "text-3xl" : "mt-3 text-3xl"
        }`}
      >
        {title}
      </h1>
      {updated ? <p className="mono-readout mt-3 text-xs text-ink-muted">Updated {updated}</p> : null}
    </header>
  );
}

const TUTORIAL_STEPS = [
  {
    n: "01",
    title: "Upload footage",
    body: "Drop up to 6 wedding clips. We validate container health, then score brightness, sharpness, and faces — only Kept clips continue.",
  },
  {
    n: "02",
    title: "Recognize people",
    body: "Optional face clustering labels bride and groom so presence in the cut stays intentional.",
  },
  {
    n: "03",
    title: "Direct the film",
    body: "Scene detection and the Film Director analyze capped moments in parallel, score them by theme, build an EDL, and render the picture — typically under about a minute after upload.",
  },
  {
    n: "04",
    title: "Choose a soundtrack",
    body: "Seven choices: five scored catalog tracks, mute, or original clip audio. Preview freely, then save the one you want.",
  },
  {
    n: "05",
    title: "Compare color grade",
    body: "Before (no grade) vs After (graded, muted). Confirm to end the session and keep your selected short film.",
  },
  {
    n: "06",
    title: "Keep your short film",
    body: "Download before, after, and your selection. When the session ends, uploads and unused remuxes are removed — the muted before/after pair and your pick remain.",
  },
] as const;

export function TutorialPanel({
  cta,
  hideEyebrow = false,
}: {
  cta?: ReactNode;
  hideEyebrow?: boolean;
}) {
  return (
    <div className="space-y-12">
      <div>
        <InfoTitle
          eyebrow="Tutorial"
          title="How Marryo builds your short film"
          updated="6 Sep 2026"
          hideEyebrow={hideEyebrow}
        />
        <InfoLead>
          A gated short-film studio: up to 6 clips per project, each stage only sees what the previous
          stage kept. Direct through soundtrack is aimed at about one minute after upload.
        </InfoLead>
      </div>

      <ol className="space-y-8 border-t border-ink/10 pt-10">
        {TUTORIAL_STEPS.map((step) => (
          <li key={step.n} className="grid gap-2 sm:grid-cols-[3.5rem_1fr] sm:gap-6">
            <span className="mono-readout text-xs tracking-[0.18em] text-bronze">{step.n}</span>
            <div>
              <h3 className="font-display text-xl text-ink">{step.title}</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {cta ? <div className="border-t border-ink/10 pt-8">{cta}</div> : null}
    </div>
  );
}

export function AboutPanel({ hideEyebrow = false }: { hideEyebrow?: boolean }) {
  return (
    <div className="space-y-10">
      <div>
        <InfoTitle
          eyebrow="About us"
          title="Turn your wedding journey into a short film, without the editing room."
          updated="6 Sep 2026"
          hideEyebrow={hideEyebrow}
        />
        <InfoLead>
          Marryo is an AI-powered short-film studio: upload up to 6 clips, and we turn them into a
          story cut with soundtrack and grade — aimed at about a minute after upload.
        </InfoLead>
      </div>

      <div className="space-y-6 border-t border-ink/10 pt-10 text-base leading-relaxed text-ink-muted">
        <p className="text-ink">We built Marryo while preparing for our own wedding.</p>
        <p className="font-display text-lg tracking-[-0.02em] text-ink">Ayu &amp; Fauzan</p>
        <p>
          It started with a simple idea: we wanted to create a pre-wedding video for our digital
          invitation. We had so many moments we wanted to capture, the little things during our
          pre-wedding, the excitement leading up to the wedding, and everything that would happen on
          the big day.
        </p>
        <p>
          But when we started putting the footage together, we realized how much work it takes to
          turn those moments into a short film. Hours of footage to go through, moments to choose, stories
          to piece together, and even more hours spent editing.
        </p>
        <p>And honestly, we didn&apos;t want to spend our wedding journey sitting in front of an editing timeline.</p>
        <p>
          We wanted to be there. To enjoy it. To capture the moments as they happened, and still have
          a beautiful short film to look back on.
        </p>
        <p>That&apos;s why we built Marryo.</p>
        <p>
          Upload a focused set of clips (up to 6), and Marryo selects moments, shapes a short story,
          scores music, and grades the picture — so you keep living the day, not scrubbing a timeline.
        </p>
        <p>
          No editing room. No extra team. Just more time to enjoy the moments that matter.
        </p>
        <p className="font-display text-xl tracking-[-0.02em] text-ink">
          You live the moments. We&apos;ll turn them into your story.
        </p>
      </div>
    </div>
  );
}

export function TermsPanel({ hideEyebrow = false }: { hideEyebrow?: boolean }) {
  return (
    <div className="space-y-10">
      <InfoTitle
        eyebrow="Terms and conditions"
        title="Terms and conditions"
        updated="5 September 2026"
        hideEyebrow={hideEyebrow}
      />
      <div className="space-y-8 text-base leading-relaxed text-ink-muted">
        <section className="space-y-3">
          <InfoH2>1. Agreement</InfoH2>
          <p>
            By using Marryo (“Service”), you agree to these Terms. If you do not agree, do not upload
            footage or create a project. Marryo is currently offered as a studio tool for creating
            wedding short films from your own clips.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>2. What Marryo does</InfoH2>
          <p>
            You upload up to 6 video clips you own or are allowed to use. Marryo may validate clips,
            detect faces and scenes, propose an edit (EDL), render a picture-locked short film, recommend
            soundtrack versions from Marryo’s licensed catalog (plus mute / original), compare color
            grade, and let you download retained MP4s. Output is generated automatically; it is not a
            human-edited commission unless we say otherwise in writing.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>3. Your content and rights</InfoH2>
          <p>
            You retain ownership of footage you upload. You grant Marryo a limited license to store,
            process, analyze, and render that footage solely to provide the Service. You represent
            that you have all rights needed to upload and process the clips.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>4. Soundtrack and media licenses</InfoH2>
          <p>
            Recommended tracks come from Marryo’s curated library (currently Mixkit Free License
            material). Catalog music may be used inside your exported short film under those license terms.
            You may not redistribute soundtrack files as standalone music products.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>5. Acceptable use</InfoH2>
          <p>
            Do not upload illegal content, content exploiting minors, malware, or material you are
            not authorized to share. Do not disrupt the Service or probe others’ projects.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>6. No warranty</InfoH2>
          <p>
            The Service is provided “as is.” Edit quality depends on your footage and automated
            systems. We do not guarantee a particular artistic result or that every clip will pass
            validation.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>7. Limitation of liability</InfoH2>
          <p>
            To the fullest extent permitted by law, Marryo and its operators are not liable for
            indirect or consequential damages, including lost footage — keep your own originals.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>8. Changes</InfoH2>
          <p>
            We may update these Terms. Continued use after changes means you accept the updated
            Terms. Material changes are reflected by the Updated date on this panel.
          </p>
        </section>
      </div>
    </div>
  );
}

export function PrivacyPanel({ hideEyebrow = false }: { hideEyebrow?: boolean }) {
  return (
    <div className="space-y-10">
      <InfoTitle
        eyebrow="Privacy policy"
        title="Privacy policy"
        updated="5 September 2026"
        hideEyebrow={hideEyebrow}
      />
      <div className="space-y-8 text-base leading-relaxed text-ink-muted">
        <section className="space-y-3">
          <InfoH2>1. Overview</InfoH2>
          <p>
            This policy describes how Marryo handles information when you create a project and upload
            wedding footage. We process media to produce your edit, not to sell advertising profiles.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>2. Information we process</InfoH2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-ink">Project details</span> — names, mood, orientation, duration
              preferences.
            </li>
            <li>
              <span className="text-ink">Footage &amp; derived data</span> — validation metrics, scenes,
              face clusters, moment scores, EDLs, renders, soundtrack selections.
            </li>
            <li>
              <span className="text-ink">Technical logs</span> — request and error logs needed to run
              the Service.
            </li>
          </ul>
        </section>
        <section className="space-y-3">
          <InfoH2>3. How we use it</InfoH2>
          <p>
            Validate clips, optional identity labeling, scene detection, Film Director planning,
            render, soundtrack remux, and download. Gemini (via your configured cloud project) may
            analyze scenes for storytelling signals.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>4. Storage</InfoH2>
          <p>
            Media may live in local storage and/or Google Cloud Storage; metadata in SQLite; scene and
            moment analytics in ClickHouse when enabled. We do not sell your footage.
          </p>
        </section>
        <section className="space-y-3">
          <InfoH2>5. Retention &amp; choices</InfoH2>
          <p>
            When you finish a session (confirm color grade), we delete uploaded source clips and
            unused soundtrack remuxes. We retain the muted before/after grade pair and the short film you
            selected. Projects remain until deleted by you. Keep original camera files — Marryo is
            not your only backup.
          </p>
        </section>
      </div>
    </div>
  );
}

const PIPELINE_GRID = [
  { n: "01", title: "Sign in", body: "Google OAuth via Auth.js" },
  { n: "02", title: "Brief", body: "Names, mood, length, orientation" },
  { n: "03", title: "Upload", body: "Clips to Cloud Storage" },
  { n: "04", title: "Validate", body: "OpenCV brightness · sharpness · faces" },
  { n: "05", title: "People", body: "MediaPipe clusters · bride / groom" },
  { n: "06", title: "Scenes", body: "PySceneDetect shot boundaries" },
  { n: "07", title: "Director", body: "ADK + Gemini + ClickHouse scores" },
  { n: "08", title: "Render", body: "FFmpeg picture lock + cards" },
  { n: "09", title: "Sound", body: "Top catalog tracks scored to the cut" },
  { n: "10", title: "Grade", body: "Before / after color compare" },
  { n: "11", title: "Short film", body: "Preview and download" },
] as const;

const HAPPY_PATH = [
  "Sign in",
  "Brief",
  "Upload",
  "Validate",
  "People",
  "Scenes",
  "Director",
  "Render",
  "Sound",
  "Grade",
  "Short film",
] as const;

const MOMENT_FLOW = [
  "Analyze moment",
  "Apply theme weights",
  "quality_score",
  "ClickHouse",
  "Director picks for EDL",
] as const;

const MOMENT_FACTORS = [
  { title: "Couple", body: "Both / one / none in frame — highest weight for romantic" },
  { title: "Emotion", body: "Match to theme-positive emotions (joy, tender, love…)" },
  { title: "Visual quality", body: "High / medium / low from analysis" },
  { title: "Lighting", body: "Bonus for golden hour, soft, warm, etc." },
  { title: "Shot type", body: "Close-up / medium / wide / drone by theme" },
  { title: "Duration", body: "Sweet-spot bonus (e.g. ~2–8s romantic)" },
  { title: "Penalty", body: "Other people without the couple lowers the score" },
] as const;

const MUSIC_WEIGHTS = [
  { w: "40%", title: "Mood", body: "Project mood vs track mood tags" },
  { w: "30%", title: "Emotion", body: "Moment emotion histogram vs track tags" },
  { w: "25%", title: "Tempo / energy", body: "BPM & energy vs cut density" },
  { w: "5%", title: "Length", body: "Mild preference for usable source length" },
] as const;

const GRADE_TONES = [
  {
    title: "Cinematic",
    body: "Slightly higher contrast, softer saturation, medium-contrast curves",
  },
  { title: "Natural", body: "No tone filter — picture stays as cut" },
  {
    title: "Bright",
    body: "Lift brightness a touch; mild contrast and saturation bump",
  },
] as const;

const GRADE_MOODS = [
  { title: "Warm", body: "Push reds / greens, pull blues — golden cast" },
  { title: "Romantic", body: "Stronger red lift, soft cool cut — rose warmth" },
  { title: "Cool", body: "Pull reds, add blue — cooler venue look" },
  { title: "Neutral", body: "No mood colorbalance — cards use default ink" },
] as const;

const STUDIO_STEPS = ["Footage", "People", "Direct", "Sound", "Grade", "Short film"] as const;

/** Full pipeline + scoring UI — between Tutorial and Tech stack. */
export function PipelinePanel({ hideEyebrow = false }: { hideEyebrow?: boolean }) {
  return (
    <div className="space-y-14">
      <div>
        <InfoTitle
          eyebrow="Pipeline"
          title="From upload to short film"
          updated="7 Sep 2026"
          hideEyebrow={hideEyebrow}
        />
        <InfoLead>
          How Marryo validates footage, scores moments, directs a cut, picks music, and applies
          color grade — for demos and walkthroughs.
        </InfoLead>
        <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-b border-ink/10 pb-5 text-sm">
          <a href="#pipeline-flow" className="text-ink-muted transition hover:text-ink">
            Flow
          </a>
          <a href="#pipeline-moments" className="text-ink-muted transition hover:text-ink">
            Moment scoring
          </a>
          <a href="#pipeline-sound" className="text-ink-muted transition hover:text-ink">
            Soundtrack scoring
          </a>
          <a href="#pipeline-grade" className="text-ink-muted transition hover:text-ink">
            Color grading
          </a>
          <a href="#pipeline-studio" className="text-ink-muted transition hover:text-ink">
            Studio steps
          </a>
        </nav>
      </div>

      <section id="pipeline-flow" className="scroll-mt-28 space-y-8">
        <div>
          <h2 className="font-display text-2xl tracking-[-0.02em] text-ink">
            Flow
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
            Rejected clips loop back to upload. Kept clips continue into people, directing, sound,
            grade, and the finished short film.
          </p>
        </div>

        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE_GRID.map((step) => (
            <li
              key={step.n}
              className="border border-ink/10 bg-ivory/50 px-4 py-4"
            >
              <p className="mono-readout text-[10px] tracking-[0.16em] text-bronze">{step.n}</p>
              <p className="mt-2 text-sm font-medium text-ink">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="overflow-x-auto border border-ink/10 bg-film px-4 py-5 text-ivory">
          <p className="mono-readout text-[10px] tracking-[0.16em] text-ivory/45 uppercase">
            Marryo path
          </p>
          <div className="mt-4 flex min-w-max items-center gap-2 text-xs sm:text-sm">
            {HAPPY_PATH.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <span className="whitespace-nowrap border border-ivory/20 bg-ivory/5 px-3 py-2">
                  {label}
                </span>
                {i < HAPPY_PATH.length - 1 ? (
                  <span aria-hidden className="text-bronze">
                    →
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-ivory/50">
            Validate → Rejected returns to Upload · Kept advances to People
          </p>
        </div>
      </section>

      <section id="pipeline-moments" className="scroll-mt-28 space-y-8 border-t border-ink/10 pt-12">
        <div>
          <h2 className="font-display text-2xl tracking-[-0.02em] text-ink">
            Moment scoring
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
            Deterministic scores (0–100) from <span className="text-ink">scoring.json</span> by
            theme — romantic, cinematic, or fun. Results land in ClickHouse as{" "}
            <span className="text-ink">moment_scores</span>; the Film Director prefers
            higher-scoring moments for the EDL.
          </p>
        </div>

        <div className="flex flex-col gap-3 border border-ink/10 bg-ivory/45 px-5 py-5 sm:flex-row sm:flex-wrap sm:items-center">
          {MOMENT_FLOW.map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-sm text-ink">{label}</span>
              {i < MOMENT_FLOW.length - 1 ? (
                <span aria-hidden className="hidden text-bronze sm:inline">
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {MOMENT_FACTORS.map((f) => (
            <li key={f.title} className="border-l-2 border-bronze/40 pl-4">
              <p className="text-sm font-medium text-ink">{f.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted sm:text-sm">{f.body}</p>
            </li>
          ))}
        </ul>

        <p className="text-xs leading-relaxed text-ink-muted sm:text-sm">
          Footage Kept / Rejected on upload is a separate pass/fail (OpenCV checks) — not this
          0–100 moment score.
        </p>
      </section>

      <section id="pipeline-sound" className="scroll-mt-28 space-y-8 border-t border-ink/10 pt-12">
        <div>
          <h2 className="font-display text-2xl tracking-[-0.02em] text-ink">
            Soundtrack scoring
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
            After the picture lock, Marryo builds music features from the cut (mood, emotion
            histogram, cut density), scores every catalog track, and surfaces the top five.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MUSIC_WEIGHTS.map((item) => (
            <div
              key={item.title}
              className="border border-ink/10 bg-ivory/50 px-4 py-5 text-center"
            >
              <p className="font-display text-3xl tracking-[-0.03em] text-bronze">{item.w}</p>
              <p className="mt-3 text-sm font-medium text-ink">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="border border-ink/10 bg-film px-4 py-5 text-ivory">
          <p className="mono-readout text-[10px] tracking-[0.16em] text-ivory/45 uppercase">
            Track score
          </p>
          <p className="mt-3 font-display text-lg text-ivory/90 sm:text-xl">
            0.40·mood + 0.30·emotion + 0.25·tempo + 0.05·length
          </p>
          <p className="mt-3 text-xs text-ivory/50">
            Sorted descending → top 5 remixed onto the picture → pick or auto-select
          </p>
        </div>
      </section>

      <section id="pipeline-grade" className="scroll-mt-28 space-y-8 border-t border-ink/10 pt-12">
        <div>
          <h2 className="font-display text-2xl tracking-[-0.02em] text-ink">
            Color grading
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
            After the silent picture is cut, FFmpeg applies a grade from{" "}
            <span className="text-ink">render_presets.json</span>:{" "}
            <span className="text-ink">visual_tone</span> filters first, then{" "}
            <span className="text-ink">mood</span> colorbalance. An ungraded twin is kept so the
            Grade step can compare before and after.
          </p>
        </div>

        <div className="flex flex-col gap-3 border border-ink/10 bg-ivory/45 px-5 py-5 sm:flex-row sm:flex-wrap sm:items-center">
          {[
            "Picture lock",
            "Tone vf",
            "Mood colorbalance",
            "Graded + ungraded twins",
            "Compare → confirm",
          ].map((label, i, arr) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-sm text-ink">{label}</span>
              {i < arr.length - 1 ? (
                <span aria-hidden className="hidden text-bronze sm:inline">
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <div>
          <p className="text-sm font-medium text-ink">Visual tone</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {GRADE_TONES.map((item) => (
              <li key={item.title} className="border border-ink/10 bg-ivory/50 px-4 py-4">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-ink">Mood cast</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {GRADE_MOODS.map((item) => (
              <li key={item.title} className="border-l-2 border-bronze/40 pl-4">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted sm:text-sm">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="border border-ink/10 bg-film px-4 py-5 text-ivory">
          <p className="mono-readout text-[10px] tracking-[0.16em] text-ivory/45 uppercase">
            Before / after
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ivory/85">
            Before = ungraded stitch · After = tone + mood filters on the same cut. Title/ending
            card colors also follow the mood preset. Confirming grade keeps the graded short film as the
            session output.
          </p>
        </div>
      </section>

      <section id="pipeline-studio" className="scroll-mt-28 space-y-8 border-t border-ink/10 pt-12">
        <div>
          <h2 className="font-display text-2xl tracking-[-0.02em] text-ink">
            Studio steps
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
            What the user sees in the step rail — completed steps stay open for read-only review.
          </p>
        </div>

        <ol className="flex flex-wrap items-center gap-2">
          {STUDIO_STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span className="border border-ink/15 bg-ivory/60 px-3 py-2 text-sm text-ink">
                <span className="mono-readout mr-2 text-[10px] text-bronze">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {label}
              </span>
              {i < STUDIO_STEPS.length - 1 ? (
                <span aria-hidden className="text-ink-muted/50">
                  —
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function TechStackPanel({ hideEyebrow = false }: { hideEyebrow?: boolean }) {
  const layers = [
    {
      title: "Interface & API",
      items: [
        { name: "Next.js 16 + React 19", note: "Studio UI and route handlers" },
        { name: "Auth.js (Google)", note: "Studio gated behind sign-in" },
        { name: "Tailwind CSS 4", note: "Design tokens, studio + homepage shell" },
      ],
    },
    {
      title: "Data & storage",
      items: [
        { name: "Prisma + SQLite", note: "Projects, clips, identity, renders, films" },
        { name: "Google Cloud Storage", note: "Private raw clips, renders, posters" },
        {
          name: "ClickHouse",
          note: "scenes, video_moments, moment_scores — analytics for ranking and MCP query tools",
        },
        { name: "MCP Database Toolbox", note: "Query top moments / scenes from ClickHouse for the agent" },
      ],
    },
    {
      title: "Agent & models",
      items: [
        {
          name: "Google ADK",
          note: "Agent Development Kit — Film Director agent, tools, orchestrator in Python",
        },
        {
          name: "Gemini",
          note: "Scene understanding (analyze_clip) via Vertex AI or AI Studio — capped ≤12 scenes/project, analyzed in parallel",
        },
        {
          name: "Hybrid director loop",
          note: "analyze → score_moments → query candidates → generate_story → plan_edit → validate_edl",
        },
        {
          name: "Upload limit",
          note: "MAX_CLIPS_PER_PROJECT=6 — keeps Direct→soundtrack near one minute",
        },
      ],
    },
    {
      title: "Algorithms & CV",
      items: [
        {
          name: "Brightness gate",
          note: "Mean luma 0–1 on sampled frames; pass band 0.08–0.92 (near-black / overexposed rejects)",
        },
        {
          name: "Laplacian variance",
          note: "Sharpness score; reject when variance < 15 (blur / soft focus)",
        },
        {
          name: "Haar cascade faces",
          note: "Frontal-face detections across samples; need ≥ 1 for Kept",
        },
        {
          name: "Identity clustering",
          note: "Haar boxes + LBP histogram embeddings, cosine distance merge across clips",
        },
        {
          name: "PySceneDetect ContentDetector",
          note: "Shot boundaries (≤6 scenes/clip); ffmpeg scene filter + whole-clip fallback; parallel per clip",
        },
        {
          name: "Theme-weighted moment scoring",
          note: "romantic / cinematic / fun weights: couple presence, emotion, lighting, shot, duration, penalties (0–100)",
        },
        {
          name: "Soundtrack match",
          note: "0.4·mood + 0.3·emotion + 0.25·tempo + 0.05·length → top 5 remuxes in parallel",
        },
        {
          name: "Typography policy scorer",
          note: "Feature-driven font / layout / motion from EDL + mood (OFL catalog)",
        },
      ],
    },
    {
      title: "Render & music",
      items: [
        { name: "FFmpeg", note: "ffprobe, parallel normalize, xfade+grade stitch, silent AAC, parallel soundtrack remux" },
        { name: "Pillow text cards", note: "Title / ending cards with chosen type" },
        { name: "Mixkit Free License catalog", note: "Curated wedding-safe library files" },
      ],
    },
  ] as const;

  return (
    <div className="space-y-12">
      <div>
        <InfoTitle
          eyebrow="Tech stack"
          title="Platform, agents, and algorithms"
          updated="6 Sep 2026"
          hideEyebrow={hideEyebrow}
        />
        <InfoLead>
          Marryo combines a Next.js studio, shared TypeScript services, ClickHouse analytics, and a
          Python agent/CV layer — Google ADK + Gemini for understanding (capped &amp; parallel),
          OpenCV and deterministic scorers for gates and ranking, FFmpeg for a fast picture lock and
          soundtrack remux.
        </InfoLead>
      </div>

      <div className="space-y-10 border-t border-ink/10 pt-10">
        {layers.map((layer) => (
          <section key={layer.title}>
            <p className="text-[11px] tracking-[0.18em] text-bronze uppercase">{layer.title}</p>
            <ul className="mt-4 divide-y divide-ink/8 border-y border-ink/8">
              {layer.items.map((item) => (
                <li
                  key={item.name}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8"
                >
                  <span className="shrink-0 text-sm font-medium text-ink">{item.name}</span>
                  <span className="text-sm text-ink-muted sm:text-right">{item.note}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
