import { test, expect } from "@playwright/test";

test("DDR spawns arrows with correct fixed pattern directions", async ({ page }) => {
  // Auto-resume AudioContext for headless Chrome
  await page.addInitScript(() => {
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor() {
        super();
        this.resume();
      }
    } as any;
  });

  // ?play=5 runs DDR live with no camera (face=null)
  await page.goto("/?play=5");

  // Wait for arrows to spawn
  await page.waitForFunction(() => {
    const arrows = (window as any).__ddrArrows;
    return arrows && arrows.length >= 8;
  }, { timeout: 15000 });

  const directions = await page.evaluate(() => {
    const arrows = (window as any).__ddrArrows;
    return arrows.map((a: any) => a.direction);
  });

  const expected = ["up", "center", "down", "center", "left", "right", "left", "right"];
  expect(directions.slice(0, 8)).toEqual(expected);
});
