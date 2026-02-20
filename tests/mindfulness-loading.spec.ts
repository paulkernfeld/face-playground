import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";

/**
 * Verify mindfulness experiment loads AND FaceMesh detects a face.
 *
 *   npx playwright test tests/mindfulness-loading.spec.ts
 *   npx playwright test tests/mindfulness-loading.spec.ts --headed
 */

test("mindfulness: FaceMesh loads and detects a face", async ({ page }) => {
  test.setTimeout(15_000);

  await setupFakeCamera(page, "/fixtures/straight.png");
  await page.goto("/?exp=8");

  const canvas = page.locator("#canvas:not(.hidden)");
  await canvas.waitFor({ timeout: 10_000 });

  // Wait for #angles to contain "pitch" — proves detectForVideo returned a face.
  // Generous timeout: WASM inference can be slow under resource pressure.
  const detected = await page.waitForFunction(() => {
    const el = document.getElementById("angles");
    return el?.textContent?.includes("pitch") ? el.textContent : false;
  }, undefined, { timeout: 8_000 });

  const text = await detected.jsonValue();
  expect(text).toContain("pitch");
  console.log(`Face detected — angles: ${text}`);
});
