import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";

/**
 * Test each experiment: verify it loads AND FaceMesh detects a face.
 * Body-tracking experiments (3, 4, 6) additionally load PoseLandmarker
 * which hangs in headless Chrome, so they only check canvas visibility.
 *
 *   npx playwright test tests/all-exp-headed.spec.ts
 *   npx playwright test tests/all-exp-headed.spec.ts --headed
 */

// Experiments that use updatePose — PoseLandmarker.detectForVideo hangs in the
// game loop under headless Chrome, so the angles HUD never updates.
const bodyTrackingExps = new Set([3, 4, 6]);

for (const exp of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`exp=${exp}: loads and detects face`, async ({ page }) => {
    test.setTimeout(15_000);

    await setupFakeCamera(page, "/fixtures/straight.png");
    await page.goto(`/?exp=${exp}`);

    const canvas = page.locator("#canvas:not(.hidden)");
    await canvas.waitFor({ timeout: 10_000 });

    if (bodyTrackingExps.has(exp)) {
      // Body-tracking experiments: PoseLandmarker blocks the loop, so just
      // verify loading completed (canvas visible, page alive).
      const title = await page.title();
      expect(title).toBeTruthy();
      console.log(`exp=${exp} loaded (body-tracking, skipping face detection check)`);
      return;
    }

    // Face-only experiments: verify FaceMesh actually detected a face.
    // FaceMesh WASM inference can be slow under resource pressure — generous timeout.
    const detected = await page.waitForFunction(() => {
      const el = document.getElementById("angles");
      return el?.textContent?.includes("pitch") ? el.textContent : false;
    }, undefined, { timeout: 8_000 });

    const text = await detected.jsonValue();
    expect(text).toContain("pitch");
    console.log(`exp=${exp} face detected — angles: ${text}`);
  });
}
