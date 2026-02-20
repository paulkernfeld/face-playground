import { test, expect } from "@playwright/test";

/**
 * Verify that the @latest WASM URL resolves to the same version
 * as our pinned npm package. A mismatch causes FaceLandmarker to
 * hang silently during initialization.
 *
 *   npx playwright test tests/wasm-version-match.spec.ts
 */

const PINNED_VERSION = "0.10.32";

test("@latest mediapipe WASM version matches pinned version", async ({ page }) => {
  const result = await page.evaluate(async (pinned) => {
    const resp = await fetch(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/package.json`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const pkg = await resp.json();
    return { latest: pkg.version, pinned };
  }, PINNED_VERSION);

  expect(
    result.latest,
    `WASM @latest is ${result.latest} but we use ${result.pinned}. Pin the WASM URL to fix loading hang.`
  ).toBe(result.pinned);
});
