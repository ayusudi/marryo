import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

import { AppNav } from "@/components/app-nav";

const DEVPOST_URL = "https://devpost.com/software/marryo";

export function StudioChrome({
  title,
  subtitle,
  backHref,
  backLabel = "Back to Dashboard",
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Shown above the Studio eyebrow (e.g. project page → dashboard). */
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="studio-shell relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="studio-grid pointer-events-none absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-bronze/40 to-transparent"
      />

      <header className="relative z-30 border-b border-ink/8 bg-ivory/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 pt-10 pb-6 sm:px-10">
          <Link
            href="/"
            className="font-display text-3xl tracking-[0.02em] sm:text-4xl"
          >
            Marryo
          </Link>
          <AppNav variant="light" />
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-10 sm:py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4 animate-fade">
          <div className="min-w-0 max-w-2xl">
            {backHref ? (
              <div className="mb-4">
                <Link
                  href={backHref}
                  className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
                >
                  <span aria-hidden className="text-base leading-none">
                    ←
                  </span>
                  {backLabel}
                </Link>
              </div>
            ) : null}
            <p className="text-[11px] tracking-[0.22em] text-ink-muted uppercase">Studio</p>
            <h1 className="font-display mt-2 text-3xl tracking-[-0.03em] text-ink sm:text-[2.5rem]">
              {title}
            </h1>
            {subtitle ? (
              <p className="mono-readout mt-2 text-[11px] tracking-[0.08em] text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 sm:pt-6">{actions}</div> : null}
        </div>
        {children}
      </main>

      <footer className="relative z-10 border-t border-ink/8 bg-ivory/50 px-6 py-8 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-ink-muted">
          <Link href="/" className="font-display text-lg tracking-[0.04em] text-ink/70">
            Marryo
          </Link>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/#terms" className="transition hover:text-ink">
              Terms and conditions
            </Link>
            <Link href="/#privacy" className="transition hover:text-ink">
              Privacy policy
            </Link>
            <a
              href={DEVPOST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-ink"
            >
              Devpost project
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  pending = false,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
        onClick={pending ? undefined : onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-body"
        className="relative z-10 w-full max-w-md border border-ink/10 bg-ivory px-6 py-6 shadow-[0_24px_60px_rgba(20,16,12,0.18)]"
      >
        <div className="flex gap-4">
          {danger ? (
            <div
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink"
            >
              <TrashIcon className="h-5 w-5" />
            </div>
          ) : null}
          <div className="min-w-0">
            <h2 id="confirm-modal-title" className="font-display text-xl tracking-[-0.02em] text-ink">
              {title}
            </h2>
            <p id="confirm-modal-body" className="mt-2 text-sm leading-relaxed text-ink-muted">
              {body}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <GhostButton disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </GhostButton>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={`inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-medium tracking-[0.04em] text-ivory transition disabled:cursor-not-allowed disabled:opacity-40 ${
              danger ? "bg-ink hover:bg-bronze-deep" : "bg-ink hover:bg-bronze-deep"
            }`}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Single-action notice (e.g. session ended). */
export function NoticeModal({
  open,
  title,
  children,
  acknowledgeLabel = "Got it",
  onAcknowledge,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  acknowledgeLabel?: string;
  onAcknowledge: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
        onClick={onAcknowledge}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-modal-title"
        className="relative z-10 w-full max-w-lg border border-ink/10 bg-ivory px-6 py-6 shadow-[0_24px_60px_rgba(20,16,12,0.18)]"
      >
        <h2 id="notice-modal-title" className="font-display text-xl tracking-[-0.02em] text-ink">
          {title}
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted">{children}</div>
        <div className="mt-6 flex justify-end">
          <PrimaryButton onClick={onAcknowledge}>{acknowledgeLabel}</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function PrimaryButton({
  children,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg bg-ink px-6 py-3 text-sm font-medium tracking-[0.04em] text-ivory transition hover:bg-bronze-deep disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg border border-ink/15 bg-transparent px-6 py-3 text-sm font-medium tracking-[0.04em] text-ink transition hover:border-ink/35 hover:bg-ink/[0.03] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-2 block text-[11px] tracking-[0.16em] text-ink-muted uppercase">
      {children}
    </label>
  );
}

export function FieldInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-ink/12 bg-white/50 px-4 py-3 text-ink outline-none transition placeholder:text-ink-muted/50 focus:border-bronze/45 focus:bg-white/80 ${props.className ?? ""}`}
    />
  );
}

export function FieldSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full appearance-none rounded-lg border border-ink/12 bg-white/50 bg-[length:12px_8px] bg-[position:right_1rem_center] bg-no-repeat py-3 pr-11 pl-4 text-ink outline-none transition focus:border-bronze/45 focus:bg-white/80 ${props.className ?? ""}`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23141311' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
        ...props.style,
      }}
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-4 border border-alert/25 bg-alert-soft/80 px-4 py-3 text-sm leading-relaxed text-alert">
      {children}
    </p>
  );
}

export function StepRail({
  steps,
  active,
  unlockedIds,
  onSelect,
}: {
  steps: Array<{ id: string; label: string }>;
  active: string;
  /** Steps the user may open to review (or continue). */
  unlockedIds?: string[];
  onSelect?: (id: string) => void;
}) {
  const activeIdx = Math.max(
    0,
    steps.findIndex((s) => s.id === active),
  );
  const unlocked = new Set(unlockedIds ?? steps.slice(0, activeIdx + 1).map((s) => s.id));
  return (
    <ol className="mb-10 flex flex-wrap items-center gap-x-1 gap-y-3 border-b border-ink/10 pb-6">
      {steps.map((step, i) => {
        const done = i < activeIdx;
        const current = step.id === active;
        const canOpen = unlocked.has(step.id);
        const label = (
          <>
            <span
              className={`mono-readout text-[10px] tracking-[0.2em] ${
                current ? "text-bronze" : ""
              }`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={`text-sm ${current ? "font-medium" : ""}`}>{step.label}</span>
            {current ? (
              <span
                aria-hidden
                className="ml-1 inline-block h-1 w-1 animate-pulse-soft rounded-[1px] bg-bronze"
              />
            ) : null}
          </>
        );
        return (
          <li key={step.id} className="flex items-center gap-1">
            {canOpen && onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                aria-current={current ? "step" : undefined}
                className={`flex items-baseline gap-2 rounded-md px-2 py-1 transition ${
                  current
                    ? "text-ink"
                    : done
                      ? "text-ink-muted hover:text-ink"
                      : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ) : (
              <div
                className={`flex items-baseline gap-2 px-2 py-1 transition ${
                  current
                    ? "text-ink"
                    : done
                      ? "text-ink-muted"
                      : "text-ink-muted/40"
                }`}
              >
                {label}
              </div>
            )}
            {i < steps.length - 1 ? (
              <span aria-hidden className="mx-1 hidden h-px w-6 bg-ink/10 sm:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
