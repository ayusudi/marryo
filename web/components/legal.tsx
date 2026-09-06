import Link from "next/link";
import type { ReactNode } from "react";

import { NavAuth } from "@/components/nav-auth";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-ivory text-ink">
      <header className="border-b border-stone-line/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-5 sm:px-10">
          <Link href="/" className="font-display text-2xl tracking-[0.02em]">
            Marryo
          </Link>
          <nav className="flex items-center gap-5 sm:gap-6">
            <NavAuth variant="light" />
            <Link href="/#about" className="text-sm text-ink-muted transition hover:text-ink">
              About us
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-14 sm:px-10 sm:py-20">
        <p className="text-xs tracking-[0.2em] text-ink-muted uppercase">Legal</p>
        <h1 className="font-display mt-3 text-3xl tracking-[-0.02em] sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-ink-muted">Last updated {updated}</p>
        <div className="prose-legal mt-10 space-y-8 text-base leading-relaxed text-ink-muted">
          {children}
        </div>
      </main>
    </div>
  );
}

export function LegalH2({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-xl text-ink">{children}</h2>;
}
