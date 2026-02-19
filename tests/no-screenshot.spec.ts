import { test, expect } from "@playwright/test";

test("touch bar has no screenshot button", async ({ page }) => {
  await page.goto("/");

  // The touch bar is created at module load — check its HTML content
  const btnScreenshot = page.locator("#btn-screenshot");
  await expect(btnScreenshot).toHaveCount(0);

  // Back and debug buttons should exist
  await expect(page.locator("#btn-back")).toHaveCount(1);
  await expect(page.locator("#btn-debug")).toHaveCount(1);
});
