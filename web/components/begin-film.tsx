"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/** Landing CTA — requires Google sign-in before opening the studio. */
export function BeginFilmButton({
  className = "inline-flex items-center rounded-lg bg-ivory px-7 py-3.5 text-sm font-medium tracking-[0.06em] text-film transition hover:bg-white",
  children = "Begin your short film",
  googleConfigured = true,
}: {
  className?: string;
  children?: ReactNode;
  googleConfigured?: boolean;
}) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <span className={`${className} opacity-60`} aria-busy>
        Loading…
      </span>
    );
  }

  if (session?.user) {
    return (
      <Link href="/studio" className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
      disabled={!googleConfigured}
      title={
        googleConfigured
          ? "Sign in with Google to open the studio"
          : "Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env"
      }
      onClick={() => {
        if (!googleConfigured) return;
        void signIn("google", { callbackUrl: "/studio" });
      }}
    >
      {googleConfigured ? children : "Sign in unavailable"}
    </button>
  );
}

/** Auto-start Google sign-in when redirected from /studio with ?signin=1 */
export function SignInPrompt({ googleConfigured = true }: { googleConfigured?: boolean }) {
  const params = useSearchParams();
  const { status } = useSession();

  const signin = params.get("signin");
  const callbackUrl = params.get("callbackUrl") || "/studio";

  useEffect(() => {
    if (!googleConfigured) return;
    if (status === "loading") return;
    if (status === "authenticated") return;
    if (signin !== "1") return;
    void signIn("google", { callbackUrl });
  }, [signin, callbackUrl, status, googleConfigured]);

  return null;
}
