import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import type { YogaPose } from "../src/yoga-classify";

const fixtures: { name: string; expected: YogaPose }[] = [
  { name: "mountain", expected: "mountain" },
  { name: "volcano", expected: "volcano" },
  { name: "tpose", expected: "tpose" },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, "..", "fixtures");

for (const fixture of fixtures) {
  const pngPath = path.join(fixtureDir, `${fixture.name}.png`);
  const exists = fs.existsSync(pngPath);

  test(`yoga pose: ${fixture.name}`, async ({ page }) => {
    test.skip(!exists, `Fixture missing: fixtures/${fixture.name}.png — capture with ?capture&prompt=${fixture.name}`);
    test.setTimeout(60_000);

    await setupFakeCamera(page, `/fixtures/${fixture.name}.png`);
    await page.goto("/?poseTest");

    // Wait for pose detection — pose div gets data attribute
    const poseDiv = page.locator("#pose[data-pose]");
    await poseDiv.waitFor({ timeout: 45_000 });

    // Let PoseLandmarker stabilize
    await page.waitForTimeout(3000);

    const detected = await poseDiv.getAttribute("data-pose");
    console.log(`${fixture.name}: detected=${detected}, expected=${fixture.expected}`);
    expect(detected, `Expected ${fixture.expected} but got ${detected}`).toBe(fixture.expected);
  });
}
