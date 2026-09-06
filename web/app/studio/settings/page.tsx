"use client";

import { signOut } from "next-auth/react";
import { useEffect, useState, useTransition } from "react";

import {
  ApiError,
  deleteAccount,
  getAccountSettings,
  type AccountSettings,
} from "@/lib/api";
import { ErrorNote, PrimaryButton, StudioChrome } from "@/components/ui";

const ADMIN_EMAIL = "ayusudi.abc@gmail.com";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-ink/8 py-5 last:border-b-0">
      <p className="text-[11px] tracking-[0.16em] text-ink-muted uppercase">{label}</p>
      <p className="mt-1.5 text-base text-ink">{value}</p>
    </div>
  );
}

function GoogleInfoIcon() {
  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label="Data from Google sign-in"
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-ink/[0.05] hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M12 11v5.5M12 8.25h.01"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 z-20 mt-2 w-max max-w-[14rem] rounded-lg border border-ink/10 bg-ink px-3 py-2 text-xs leading-snug text-ivory opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100"
      >
        Data from Google sign-in
      </span>
    </span>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getAccountSettings();
        if (!cancelled) setSettings(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await deleteAccount();
        await signOut({ callbackUrl: "/" });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not delete account");
        setConfirmDelete(false);
      }
    });
  }

  const displayName = settings?.name || "—";

  return (
    <StudioChrome title="Settings">
      <div className="w-full">
        {loading ? (
          <p className="text-sm text-ink-muted">Loading account…</p>
        ) : settings ? (
          <div className="relative rounded-2xl border border-ink/10 bg-white/80 px-6 py-2 sm:px-8">
            <div className="absolute top-5 right-5 sm:top-6 sm:right-6">
              <GoogleInfoIcon />
            </div>

            <div className="border-b border-ink/8 py-5 pr-12">
              <p className="text-[11px] tracking-[0.16em] text-ink-muted uppercase">Profile</p>
              <div className="mt-3 flex items-center gap-4">
                {settings.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={settings.image}
                    alt=""
                    className="h-14 w-14 rounded-full object-cover ring-1 ring-ink/10"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink/10 text-lg font-medium text-ink">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <p className="text-base font-medium tracking-[0.04em] text-ink uppercase">
                  {displayName}
                </p>
              </div>
            </div>

            <ReadOnlyField label="Email" value={settings.email || "—"} />
            <ReadOnlyField label="Joined Marryo" value={formatDate(settings.joined_at)} />
            <ReadOnlyField
              label="First video made"
              value={formatDate(settings.first_video_at)}
            />
          </div>
        ) : null}

        <ErrorNote>{error}</ErrorNote>

        <div className="mt-10">
          <p className="text-[11px] tracking-[0.16em] text-bronze uppercase">Contact admin</p>

          <ul className="mt-4 divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white/80">
            <li>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-sm text-ink marker:content-none [&::-webkit-details-marker]:hidden">
                  <span>How can I delete an account</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 12 8"
                    fill="none"
                    aria-hidden
                    className="shrink-0 text-ink-muted transition group-open:rotate-180"
                  >
                    <path
                      d="M1 1.5L6 6.5L11 1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </summary>
                <div className="border-t border-ink/8 bg-alert-soft/40 px-6 py-5">
                  <p className="text-sm leading-relaxed text-ink-muted">
                    Deleting your account permanently removes your projects and films. This cannot be
                    undone.
                  </p>
                  {confirmDelete ? (
                    <p className="mt-3 text-sm font-medium text-alert">
                      Click again to confirm permanent deletion.
                    </p>
                  ) : null}
                  <div className="mt-4">
                    <PrimaryButton
                      type="button"
                      disabled={pending || loading}
                      onClick={onDelete}
                      className="!bg-alert hover:!bg-alert/90"
                    >
                      {pending
                        ? "Deleting…"
                        : confirmDelete
                          ? "Confirm delete account"
                          : "Delete account"}
                    </PrimaryButton>
                  </div>
                </div>
              </details>
            </li>
            <li>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-sm text-ink marker:content-none [&::-webkit-details-marker]:hidden">
                  <span>I want to talk to admin</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 12 8"
                    fill="none"
                    aria-hidden
                    className="shrink-0 text-ink-muted transition group-open:rotate-180"
                  >
                    <path
                      d="M1 1.5L6 6.5L11 1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </summary>
                <div className="border-t border-ink/8 px-6 py-5">
                  <p className="text-sm leading-relaxed text-ink-muted">
                    Email us and we&apos;ll get back to you.
                  </p>
                  <a
                    href={`mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent("Marryo support")}`}
                    className="mt-3 inline-flex text-sm tracking-[0.04em] text-bronze transition hover:text-bronze-deep"
                  >
                    {ADMIN_EMAIL}
                  </a>
                </div>
              </details>
            </li>
          </ul>
        </div>
      </div>
    </StudioChrome>
  );
}
