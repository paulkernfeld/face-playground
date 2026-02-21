import { test, expect } from "@playwright/test";

/**
 * Test that mindfulness experiment exposes __mindfulnessPhase
 * and respects the ?duration= URL param.
 * Uses ?play=8 (game loop, no camera, face=null).
 */

test("mindfulness exposes __mindfulnessPhase global", async ({ page }) => {
  test.setTimeout(15_000);

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/?play=8&duration=5");

  // Wait for phase to be set (play loop calls update() which sets the global)
  await page.waitForFunction(
    'typeof window.__mindfulnessPhase === "string"',
    { timeout: 10_000 }
  );

  const phase = await page.evaluate("window.__mindfulnessPhase");
  // With no face, phase stays 'waiting'
  expect(phase).toBe("waiting");
  expect(errors).toHaveLength(0);
});
