import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";

/** Read at call time — Cloud Run injects secrets at runtime, not at `next build`. */
export function isGoogleAuthConfigured(): boolean {
  const id = process.env.AUTH_GOOGLE_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim();
  const secret =
    process.env.AUTH_GOOGLE_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

/** @deprecated Use isGoogleAuthConfigured() — kept for gradual call-site updates. */
export const googleAuthConfigured = isGoogleAuthConfigured();

/** Playwright / local E2E only — never enable in production. */
export function isE2eAuthEnabled(): boolean {
  return process.env.E2E_AUTH === "1" && Boolean(process.env.E2E_AUTH_SECRET?.trim());
}

export const e2eAuthEnabled = isE2eAuthEnabled();

function buildProviders(): Provider[] {
  const providers: Provider[] = [];
  const googleId = process.env.AUTH_GOOGLE_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim();
  const googleSecret =
    process.env.AUTH_GOOGLE_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (googleId && googleSecret) {
    providers.push(
      Google({
        clientId: googleId,
        clientSecret: googleSecret,
      }),
    );
  }

  if (isE2eAuthEnabled()) {
    providers.push(
      Credentials({
        id: "e2e",
        name: "E2E",
        credentials: {
          secret: { label: "Secret", type: "password" },
        },
        authorize(credentials) {
          const expected = process.env.E2E_AUTH_SECRET?.trim();
          if (!expected || credentials?.secret !== expected) return null;
          return {
            id: "e2e-user",
            name: "E2E Tester",
            email: "e2e@marryo.test",
          };
        },
      }),
    );
  }

  return providers;
}

/**
 * Auth.js requires AUTH_SECRET even to serve /api/auth/session.
 * Google sign-in additionally needs AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET.
 * Set E2E_AUTH=1 + E2E_AUTH_SECRET for Playwright credentials login.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || undefined,
  providers: buildProviders(),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/",
    error: "/",
  },
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      if (account?.provider === "google" && account.providerAccountId) {
        token.sub = account.providerAccountId;
      }
      if (account && profile) {
        token.picture = (profile as { picture?: string }).picture ?? token.picture;
      }
      if (user?.email) token.email = user.email;
      if (user?.name) token.name = user.name;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub as string | undefined) ?? "";
        session.user.image = (token.picture as string | undefined) ?? session.user.image;
        if (token.email) session.user.email = token.email as string;
        if (token.name) session.user.name = token.name as string;
      }
      return session;
    },
  },
});
