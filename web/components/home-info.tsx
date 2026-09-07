"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BeginFilmButton } from "@/components/begin-film";
import {
  AboutPanel,
  PipelinePanel,
  PrivacyPanel,
  TechStackPanel,
  TermsPanel,
  TutorialPanel,
} from "@/components/info-panels";

const NAV = [
  { hash: "about", label: "About us" },
  { hash: "tutorial", label: "Tutorial" },
  { hash: "terms", label: "Terms and conditions" },
  { hash: "privacy", label: "Privacy policy" },
  { hash: "pipeline", label: "Pipeline" },
  { hash: "tech", label: "Tech stack" },
] as const;

type HashId = (typeof NAV)[number]["hash"];

export function isInfoHash(value: string): value is HashId {
  return NAV.some((item) => item.hash === value);
}

/** True for main info hashes and in-panel anchors (e.g. pipeline-flow). */
export function isInfoSectionHash(value: string): boolean {
  if (isInfoHash(value)) return true;
  return value.startsWith("pipeline-");
}

function isHashId(value: string): value is HashId {
  return isInfoHash(value);
}

function readHash(): HashId {
  if (typeof window === "undefined") return "about";
  const raw = window.location.hash.replace(/^#/, "");
  if (isHashId(raw)) return raw;
  // Sub-nav inside Pipeline must not leave the panel or unhide Featured short films.
  if (raw.startsWith("pipeline-")) return "pipeline";
  return "about";
}

function Panel({
  id,
  googleConfigured,
}: {
  id: HashId;
  googleConfigured: boolean;
}) {
  const ctaClass =
    "inline-flex items-center rounded-lg bg-ink px-7 py-3.5 text-sm font-medium tracking-[0.06em] text-ivory transition hover:bg-bronze-deep";

  switch (id) {
    case "tutorial":
      return (
        <TutorialPanel
          hideEyebrow
          cta={<BeginFilmButton className={ctaClass} googleConfigured={googleConfigured} />}
        />
      );
    case "about":
      return <AboutPanel hideEyebrow />;
    case "terms":
      return <TermsPanel hideEyebrow />;
    case "privacy":
      return <PrivacyPanel hideEyebrow />;
    case "pipeline":
      return <PipelinePanel hideEyebrow />;
    case "tech":
      return <TechStackPanel hideEyebrow />;
  }
}

const eyebrowRowClass =
  "flex shrink-0 items-center border-b border-ink/8 px-6 pt-10 pb-5 text-[11px] tracking-[0.22em] text-ink-muted uppercase sm:px-8 lg:px-6";

/** Homepage nested info: sidebar + hash panels (#about #tutorial #terms #privacy #pipeline #tech). */
export function HomeInfoSection({ googleConfigured = true }: { googleConfigured?: boolean }) {
  const [active, setActive] = useState<HashId>("about");
  const [mobileOpen, setMobileOpen] = useState(false);

  const syncFromHash = useCallback(() => {
    const next = readHash();
    setActive(next);
    setMobileOpen(false);
    const raw = window.location.hash.replace(/^#/, "");
    if (raw.startsWith("pipeline-")) {
      // Wait for Pipeline panel to paint, then scroll to the sub-section.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(raw)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      return;
    }
    if (raw && isHashId(raw)) {
      requestAnimationFrame(() => {
        // Stable section id — do not bind id to `active` (SSR/HMR hydration mismatch).
        document.getElementById("info")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  useEffect(() => {
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [syncFromHash]);

  const activeLabel = NAV.find((item) => item.hash === active)?.label ?? "About us";

  return (
    <section id="info" className="relative scroll-mt-0 border-t border-ink/8 bg-white text-ink">
      {/* Hash targets for /#about etc. so native scroll still lands on this block. */}
      {NAV.map((item) => (
        <span
          key={item.hash}
          id={item.hash}
          className="pointer-events-none absolute top-0 left-0 h-0 w-0 overflow-hidden"
          aria-hidden
        />
      ))}
      <div className="mx-auto grid max-w-6xl lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-stretch">
        <aside className="flex flex-col border-ink/8 bg-white lg:border-r">
          <div className={`${eyebrowRowClass} justify-between lg:justify-start`}>
            <p>Navigate</p>
            <button
              type="button"
              className="mono-readout text-[11px] tracking-[0.14em] text-bronze lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? "CLOSE" : "MENU"}
            </button>
          </div>

          <div
            className={`flex flex-1 flex-col px-6 pb-8 sm:px-8 lg:px-6 lg:pb-12 lg:pt-6 ${
              mobileOpen ? "block" : "hidden lg:flex"
            }`}
          >
            <nav aria-label="Homepage sections">
              <ul className="space-y-1">
                {NAV.map((item) => {
                  const isActive = item.hash === active;
                  return (
                    <li key={item.hash}>
                      <a
                        href={`#${item.hash}`}
                        onClick={() => {
                          setActive(item.hash);
                          setMobileOpen(false);
                        }}
                        className={`group flex h-11 items-center border-l-2 pl-4 text-sm transition duration-300 ${
                          isActive
                            ? "border-bronze font-medium text-ink"
                            : "border-transparent text-ink-muted hover:border-ink/15 hover:text-ink"
                        }`}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col bg-white">
          <div className={`${eyebrowRowClass} sm:px-10`}>{activeLabel}</div>
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <div
              key={active}
              className={`info-pane-enter pb-12 ${
                active === "pipeline" ? "max-w-5xl" : "max-w-2xl"
              }`}
            >
              <Panel id={active} googleConfigured={googleConfigured} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomeInfoFooterLinks() {
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-2">
      <a
        href="https://devpost.com/software/marryo"
        target="_blank"
        rel="noopener noreferrer"
        className="transition hover:text-ivory"
      >
        Devpost project
      </a>
    </nav>
  );
}

export function HomeHashLink({
  hash,
  children,
  className,
}: {
  hash: HashId;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={`#${hash}`} className={className}>
      {children}
    </a>
  );
}
