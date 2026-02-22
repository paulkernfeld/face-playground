import { test, expect } from "@playwright/test";

/**
 * Test that mindfulness experiment auto-completes when no face is detected
 * for the full duration. Uses ?play=8 (game loop, no camera, face=null).
 */

test("mindfulness auto-completes with no face after duration elapses", async ({ page }) => {
  test.setTimeout(15_000);

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/?play=8&duration=3");

  // Wait for phase to be set (play loop calls update() which sets the global)
  await page.waitForFunction(
    'typeof window.__mindfulnessPhase === "string"',
    { timeout: 10_000 }
  );

  // Phase starts as 'waiting' (no face yet)
  const initialPhase = await page.evaluate("window.__mindfulnessPhase");
  expect(initialPhase).toBe("waiting");

  // After ~3s of wall-clock time with no face, phase should auto-complete
  await page.waitForFunction(
    'window.__mindfulnessPhase === "complete"',
    { timeout: 10_000 }
  );

  expect(errors).toHaveLength(0);
});
