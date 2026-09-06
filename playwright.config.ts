import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.WEB_URL ?? "http://localhost:3100";

/**
 * Browser + API E2E against the Next.js app on :3100.
 * Requires E2E_AUTH=1 and E2E_AUTH_SECRET (see .env.example).
 */
export default defineConfig({
  testDir: path.join(root, "e2e"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  outputDir: "e2e-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "api",
      testMatch: /api\.spec\.ts/,
    },
    {
      name: "chromium",
      testIgnore: /api\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev --workspace web",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: root,
    env: {
      ...process.env,
      E2E_AUTH: process.env.E2E_AUTH ?? "1",
      E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? "marryo-e2e-secret",
    },
  },
});
