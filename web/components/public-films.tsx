"use client";

import { useCallback, useEffect, useState } from "react";

import { isInfoHash } from "@/components/home-info";

type PublicFilm = {
  film_id: string;
  title: string | null;
  couple_label: string | null;
  track_title: string | null;
  playback_url?: string;
  thumbnail_url?: string;
  orientation: string | null;
};

function useInfoHashOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      const raw = window.location.hash.replace(/^#/, "");
      setOpen(isInfoHash(raw));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return open;
}

function useVisibleCount() {
  const [count, setCount] = useState(3);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 640) setCount(1);
      else if (w < 1024) setCount(2);
      else setCount(3);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return count;
}

function FilmCard({
  film,
  isPlaying,
  onPlay,
}: {
  film: PublicFilm;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  const portrait = film.orientation === "portrait";
  const frame = portrait
    ? "mx-auto aspect-[9/16] max-h-[28rem] w-full"
    : "aspect-video w-full";

  return (
    <article className="space-y-3">
      <div className="group relative overflow-hidden rounded-2xl bg-black/40">
        {isPlaying && film.playback_url ? (
          <video
            src={film.playback_url}
            controls
            autoPlay
            playsInline
            poster={film.thumbnail_url}
            className={`${frame} object-contain`}
          />
        ) : (
          <button
            type="button"
            onClick={onPlay}
            className={`relative block ${frame} overflow-hidden text-left`}
            aria-label={`Play ${film.track_title || film.title || "film"}`}
          >
            {film.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={film.thumbnail_url}
                alt=""
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2a241c] to-[#12100e] text-sm text-ivory/40">
                {film.track_title || "Film"}
              </div>
            )}
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-ivory/30 bg-black/35 text-ivory backdrop-blur-sm transition group-hover:scale-105 group-hover:border-ivory/50">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5.14v13.72L19 12 8 5.14z" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
      <div>
        <p className="font-display text-lg text-ivory">
          {film.track_title || film.title || "Wedding film"}
        </p>
        {film.couple_label ? (
          <p className="text-sm text-ivory/50">{film.couple_label}</p>
        ) : null}
      </div>
    </article>
  );
}

export function PublicFilmsGallery() {
  const [films, setFilms] = useState<PublicFilm[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const visible = useVisibleCount();
  const infoHashOpen = useInfoHashOpen();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/films/public?limit=12", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { films?: PublicFilm[] };
        if (!cancelled) setFilms(data.films ?? []);
      } catch {
        /* gallery is optional on landing */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxIndex = Math.max(0, films.length - visible);

  useEffect(() => {
    setIndex((i) => Math.min(i, maxIndex));
  }, [maxIndex]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
    setPlayingId(null);
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(maxIndex, i + 1));
    setPlayingId(null);
  }, [maxIndex]);

  if (infoHashOpen) return null;
  if (!loaded || films.length === 0) return null;

  const canSlide = films.length > visible;

  return (
    <section className="border-t border-ivory/10 bg-film px-6 py-20 text-ivory sm:px-10 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs tracking-[0.2em] text-ivory/45 uppercase">Featured films</p>
            <h2 className="font-display mt-3 max-w-xl text-3xl tracking-[-0.02em] text-balance sm:text-4xl">
              Films made from real weddings.
            </h2>
          </div>
          {canSlide ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={goPrev}
                disabled={index === 0}
                aria-label="Previous films"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-ivory/25 text-ivory transition hover:border-ivory/50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={index >= maxIndex}
                aria-label="Next films"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-ivory/25 text-ivory transition hover:border-ivory/50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>

        <div className="-mr-8 mt-12 overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: `translateX(-${(index * 100) / visible}%)` }}
          >
            {films.map((film) => (
              <div
                key={film.film_id}
                className="box-border shrink-0 pr-8"
                style={{ width: `${100 / visible}%` }}
              >
                <FilmCard
                  film={film}
                  isPlaying={playingId === film.film_id}
                  onPlay={() => setPlayingId(film.film_id)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
