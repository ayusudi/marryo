import Link from "next/link";
import { Suspense } from "react";

import { isGoogleAuthConfigured } from "@/auth";
import { BeginFilmCta, SignInPromptGate } from "@/components/begin-film-server";
import { HomeHashLink, HomeInfoFooterLinks, HomeInfoSection } from "@/components/home-info";
import { LandingNav } from "@/components/landing-nav";
import { PublicFilmsGallery } from "@/components/public-films";

/** Secrets (AUTH_GOOGLE_*) exist only at Cloud Run runtime — never bake at build. */
export const dynamic = "force-dynamic";

/** Wedding atmosphere only — florals / venue, no faces. */
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=2400&q=80";

export default function LandingPage() {
  const googleConfigured = isGoogleAuthConfigured();
  return (
    <main className="bg-film text-ivory">
      <Suspense fallback={null}>
        <SignInPromptGate />
      </Suspense>

      <div className="relative min-h-dvh overflow-x-hidden">
        <div className="absolute inset-0 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={HERO_IMAGE}
            alt=""
            className="animate-hero-drift h-full w-full object-cover object-[70%_40%]"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-film via-film/78 to-film/25 sm:via-film/70 sm:to-transparent"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-film via-film/20 to-film/55"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            }}
          />
        </div>

        <div className="relative z-20 mx-auto flex min-h-dvh max-w-6xl flex-col px-6 pb-8 pt-10 sm:px-10 lg:px-14">
          <header className="animate-fade relative z-30 flex items-baseline justify-between gap-6">
            <p className="font-display text-3xl tracking-[0.02em] text-ivory sm:text-4xl">Marryo</p>
            <LandingNav />
          </header>

          <section className="flex flex-1 flex-col justify-end pb-8 pt-24 sm:justify-center sm:pb-16 sm:pt-0">
            <div className="max-w-2xl">
              <h1 className="font-display animate-rise text-[2.35rem] leading-[1.12] tracking-[-0.02em] text-balance sm:text-5xl lg:text-[3.35rem]">
                Your memories already contain the story. Marryo turns them into a film.
              </h1>
              <p
                className="animate-rise mt-6 max-w-md text-base leading-relaxed text-ivory/70 sm:text-lg"
                style={{ animationDelay: "120ms" }}
              >
                Upload your footage. We find the moments, shape the cut, and score the soundtrack —
                a cinematic edit that feels like you.
              </p>
              <div
                className="animate-rise mt-10 flex flex-wrap items-center gap-x-8 gap-y-4"
                style={{ animationDelay: "220ms" }}
              >
                <BeginFilmCta />
                <HomeHashLink
                  hash="about"
                  className="text-sm tracking-[0.06em] text-ivory/55 transition hover:text-ivory"
                >
                  About us
                </HomeHashLink>
              </div>
            </div>
          </section>
        </div>
      </div>

      <PublicFilmsGallery />

      <HomeInfoSection googleConfigured={googleConfigured} />

      <footer className="border-t border-ivory/10 bg-film px-6 py-10 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-ivory/45">
          <Link href="/" className="font-display text-lg tracking-[0.04em] text-ivory/70">
            Marryo
          </Link>
          <HomeInfoFooterLinks />
        </div>
      </footer>
    </main>
  );
}
