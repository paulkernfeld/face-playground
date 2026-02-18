import { test, expect } from "@playwright/test";

test("main menu loads with all experiment cards and no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  await expect(page.locator(".menu-title")).toBeVisible();

  // Should have one card per experiment
  const cards = page.locator(".experiment-card");
  await expect(cards).not.toHaveCount(0);

  // Each card should have a name and description
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    await expect(cards.nth(i).locator(".card-name")).toBeVisible();
    await expect(cards.nth(i).locator(".card-desc")).toBeVisible();
  }

  // No JS errors during load
  expect(errors, `Unexpected JS errors: ${errors.join(", ")}`).toHaveLength(0);
});
