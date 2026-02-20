import { test, expect } from "@playwright/test";

/**
 * Test mindfulness demo mode (no camera, no FaceLandmarker)
 * to isolate whether the crash is in rendering vs model loading.
 */

test("mindfulness demo renders without crashing", async ({ page }) => {
  test.setTimeout(10_000);

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/?demo=8");

  // demo mode should show canvas immediately (no loading screen)
  const canvas = page.locator("#canvas");
  await canvas.waitFor({ state: "visible", timeout: 5_000 });

  // Let it render a few frames
  await page.waitForTimeout(1000);

  // Take screenshot to verify rendering
  await page.screenshot({ path: ".screenshots/mindfulness-demo.png" });

  expect(errors).toHaveLength(0);
});
