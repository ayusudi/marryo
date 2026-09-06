import type { APIRequestContext, Page } from "@playwright/test";

const E2E_SECRET = process.env.E2E_AUTH_SECRET ?? "marryo-e2e-secret";

/** Establish an Auth.js session via the E2E credentials provider. */
export async function loginE2E(request: APIRequestContext): Promise<void> {
  const csrfRes = await request.get("/api/auth/csrf");
  if (!csrfRes.ok()) {
    throw new Error(`csrf failed: ${csrfRes.status()} ${await csrfRes.text()}`);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const loginRes = await request.post("/api/auth/callback/e2e", {
    form: {
      csrfToken,
      secret: E2E_SECRET,
      callbackUrl: "/studio",
      json: "true",
    },
  });

  // Auth.js returns 200 with JSON `{ url }` when json=true, or 302 otherwise.
  if (!loginRes.ok() && loginRes.status() !== 302) {
    throw new Error(`e2e login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
}

export async function loginE2EInBrowser(page: Page): Promise<void> {
  await loginE2E(page.request);
  await page.goto("/studio");
  await page.waitForURL(/\/studio\/?$/);
}
