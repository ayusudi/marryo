import { expect, test } from "@playwright/test";

test.describe("Landing", () => {
  test("shows brand, CTA, and public films", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Marryo").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /memories already contain the story/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /begin your film/i }).or(page.getByRole("button", { name: /begin your film/i })).first()).toBeVisible();
    await expect(page.getByText(/featured films/i)).toBeVisible();
  });

  test("studio is gated without a session", async ({ page }) => {
    await page.goto("/studio");
    await expect(page).toHaveURL(/\?signin=1/);
    await expect(page).toHaveURL(/callbackUrl=/);
  });
});
