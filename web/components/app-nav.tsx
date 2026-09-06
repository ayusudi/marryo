"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

import { NavAuth } from "@/components/nav-auth";

type Variant = "dark" | "light";

function linkClass(variant: Variant, active: boolean): string {
  if (variant === "dark") {
    return active
      ? "text-sm font-semibold tracking-wide text-ivory"
      : "text-sm tracking-wide text-ivory/70 transition hover:text-ivory";
  }
  return active
    ? "text-sm font-semibold tracking-[0.04em] text-ink"
    : "text-sm tracking-[0.04em] text-ink-muted transition hover:text-ink";
}

/** Shared top-right nav: Dashboard / About / User when signed in. */
export function AppNav({
  variant = "dark",
  googleConfigured = true,
}: {
  variant?: Variant;
  googleConfigured?: boolean;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const onHome = pathname === "/";
  const onSettings = pathname.startsWith("/studio/settings");
  const onDashboard =
    pathname === "/studio" || (pathname.startsWith("/studio/") && !onSettings);

  if (status === "loading") {
    return (
      <nav className="flex items-center gap-5 sm:gap-7">
        <span
          className={
            variant === "dark" ? "text-sm text-ivory/50" : "text-sm text-ink-muted"
          }
        >
          …
        </span>
      </nav>
    );
  }

  if (!session?.user) {
    return (
      <nav className="flex items-center gap-5 sm:gap-7">
        <NavAuth variant={variant} googleConfigured={googleConfigured} />
        <Link href="/#about" className={linkClass(variant, onHome)}>
          About
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-5 sm:gap-7">
      <Link href="/studio" className={linkClass(variant, onDashboard)}>
        Dashboard
      </Link>
      <Link href="/#about" className={linkClass(variant, onHome)}>
        About
      </Link>
      <NavAuth variant={variant} active={onSettings} />
    </nav>
  );
}
