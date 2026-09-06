import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loginE2EInBrowser } from "./helpers/auth";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sampleClip = path.join(root, "scripts", "sample-clips", "good-1.mp4");

test.describe("Studio upload", () => {
  test.beforeEach(async ({ page }) => {
    await loginE2EInBrowser(page);
  });

  test("create project, upload clip with progress, continue", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByPlaceholder("Name").first().fill("Mya");
    await page.getByPlaceholder("Name").nth(1).fill("Myazan");
    await page.getByTestId("create-project").click();

    await expect(page).toHaveURL(/\/studio\/prj_/, { timeout: 30_000 });
    await expect(page.getByText("Footage").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /continue with 0 clips/i })).toBeDisabled();

    await page.getByTestId("footage-input").setInputFiles(sampleClip);

    await expect(page.getByText(/uploading|validating/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("progressbar")).toBeVisible();

    // Validation shells out to Python CV — allow time on cold start.
    await expect(page.getByText("good-1.mp4")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: /continue with \d+ clip/i })).toBeEnabled({
      timeout: 90_000,
    });

    await page.getByRole("button", { name: /continue with \d+ clip/i }).click();
    await expect(page.getByText(/bride and groom|finding people|people/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
