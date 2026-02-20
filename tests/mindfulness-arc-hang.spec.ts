import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";

/**
 * Regression test: mindfulness near-zero arc hang.
 *
 * Root cause: rough.js rc.arc() with near-zero sweep angle hangs under
 * the full game-loop context (FaceMesh + canvas transforms + rough.js).
 * Cannot reproduce standalone — requires the resource pressure of the
 * full loop. Guard: `if (progress > 0.01)` in mindfulness draw().
 *
 * This test verifies: FaceMesh detects a face, the draw function runs
 * the active branch (progress starts near-zero), and the loop survives.
 * Without the guard, the loop deterministically stalls on frame 1.
 *
 *   npx playwright test tests/mindfulness-arc-hang.spec.ts
 */
test("mindfulness: loop stays alive after face detection (arc hang regression)", async ({ page }) => {
  test.setTimeout(15_000);

  await setupFakeCamera(page, "/fixtures/straight.png");
  await page.goto("/?exp=8");

  await page.locator("#canvas:not(.hidden)").waitFor({ timeout: 10_000 });

  // Face detection proves detectForVideo returned a face AND
  // the loop ran at least 30 frames (angles updates every 30 frames).
  await page.waitForFunction(() => {
    const el = document.getElementById("angles");
    return el?.textContent?.includes("pitch");
  }, undefined, { timeout: 8_000 });

  // Sample frame count twice to prove loop is still alive
  const count1 = await page.evaluate(() => (window as any).__frameCount as number);
  await page.waitForTimeout(500);
  const count2 = await page.evaluate(() => (window as any).__frameCount as number);

  expect(count2).toBeGreaterThan(count1);
  console.log(`Loop alive: frame ${count1} → ${count2} (+${count2 - count1} frames in 500ms)`);
});
