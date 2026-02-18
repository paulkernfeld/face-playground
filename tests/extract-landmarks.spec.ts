import { test } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, "..", "fixtures");

// Find all yoga-*.png fixtures
const yogaFixtures = fs.readdirSync(fixtureDir)
  .filter(f => f.startsWith("yoga-") && f.endsWith(".png"))
  .map(f => f.replace(".png", ""));

for (const fixture of yogaFixtures) {
  const jsonPath = path.join(fixtureDir, `${fixture}.landmarks.json`);

  test(`extract landmarks: ${fixture}`, async ({ page }) => {
    test.skip(fs.existsSync(jsonPath), `Already extracted: ${fixture}.landmarks.json`);
    test.setTimeout(60_000);

    await setupFakeCamera(page, `/fixtures/${fixture}.png`);
    await page.goto("/?poseTest");

    // Wait for world landmarks to appear
    const poseDiv = page.locator("#pose[data-worldlandmarks]");
    await poseDiv.waitFor({ timeout: 45_000 });

    // Let PoseLandmarker stabilize
    await page.waitForTimeout(3000);

    const raw = await poseDiv.getAttribute("data-worldlandmarks");
    if (!raw) throw new Error(`No worldlandmarks for ${fixture}`);

    const landmarks = JSON.parse(raw);
    fs.writeFileSync(jsonPath, JSON.stringify(landmarks, null, 2) + "\n");
    console.log(`Wrote ${fixture}.landmarks.json (${landmarks.length} landmarks)`);
  });
}
