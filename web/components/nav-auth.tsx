"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

type Variant = "dark" | "light";

export function NavAuth({
  variant = "dark",
  googleConfigured = true,
  active = false,
}: {
  variant?: Variant;
  /** When false, button explains missing OAuth env instead of starting OAuth. */
  googleConfigured?: boolean;
  /** Bold user control when settings (or account) is the active page. */
  active?: boolean;
}) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const muted = variant === "dark" ? "text-ivory/70 hover:text-ivory" : "text-ink-muted hover:text-ink";
  const activeUser =
    variant === "dark" ? "font-semibold text-ivory" : "font-semibold text-ink";
  const solid =
    variant === "dark"
      ? "border-ivory/30 text-ivory/85 hover:border-ivory/55 hover:text-ivory"
      : "border-ink/15 text-ink-muted hover:border-ink/30 hover:text-ink";
  const menuBg =
    variant === "dark"
      ? "border-ivory/15 bg-film text-ivory shadow-lg"
      : "border-ink/10 bg-white text-ink shadow-lg";
  const menuItem =
    variant === "dark"
      ? "text-ivory/80 hover:bg-ivory/10 hover:text-ivory"
      : "text-ink-muted hover:bg-ink/[0.04] hover:text-ink";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading") {
    return <span className={`text-sm tracking-wide ${muted}`}>…</span>;
  }

  if (session?.user) {
    const label = session.user.name || session.user.email || "Account";
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={`flex items-center gap-2.5 text-sm tracking-wide transition ${
            active ? activeUser : muted
          }`}
        >
          {session.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt=""
              className={`h-7 w-7 rounded-full object-cover ${
                variant === "dark" ? "ring-1 ring-ivory/20" : "ring-1 ring-ink/10"
              } ${active ? (variant === "dark" ? "ring-ivory/50" : "ring-bronze/50") : ""}`}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                variant === "dark" ? "bg-ivory/15 text-ivory" : "bg-ink/10 text-ink"
              }`}
            >
              {label.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="max-w-[10rem] truncate">{label}</span>
        </button>

        {open ? (
          <div
            role="menu"
            className={`absolute right-0 top-full z-50 mt-2 min-w-[11rem] overflow-hidden rounded-lg border py-1 ${menuBg}`}
          >
            <Link
              href="/studio/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={`block px-4 py-2.5 text-sm transition ${menuItem} ${
                active ? "font-semibold" : ""
              }`}
            >
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut({ callbackUrl: "/" });
              }}
              className={`block w-full px-4 py-2.5 text-left text-sm transition ${menuItem}`}
            >
              Log out
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!googleConfigured}
      title={
        googleConfigured
          ? "Sign in with Google"
          : "Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env"
      }
      onClick={() => {
        if (!googleConfigured) return;
        void signIn("google", { callbackUrl: "/studio" });
      }}
      className={`rounded-lg border px-3.5 py-1.5 text-sm tracking-[0.04em] transition disabled:cursor-not-allowed disabled:opacity-40 ${solid}`}
    >
      Sign in
    </button>
  );
}
