import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Fixture definitions: filename → expected angle ranges (degrees).
// Capture fixtures with: ?capture&prompt=<name>
// e.g. ?capture&prompt=straight → saves fixtures/straight.png
const fixtures: {
  name: string;
  pitchRange?: [number, number]; // [min, max] in degrees
  yawRange?: [number, number];
}[] = [
  {
    name: "straight",
    pitchRange: [-15, 15],
    yawRange: [-15, 15],
  },
  {
    name: "pitch-down",
    pitchRange: [10, 60],
    yawRange: [-25, 25],
  },
  {
    name: "yaw-left",
    pitchRange: [-30, 30],
    yawRange: [15, 90],
  },
  {
    name: "roll-left",
    pitchRange: [-30, 30],
    yawRange: [-30, 30],
  },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, "..", "fixtures");

for (const fixture of fixtures) {
  const pngPath = path.join(fixtureDir, `${fixture.name}.png`);
  const exists = fs.existsSync(pngPath);

  test(`head pose: ${fixture.name}`, async ({ page }) => {
    test.skip(!exists, `Fixture missing: fixtures/${fixture.name}.png — capture with ?capture&prompt=${fixture.name}`);

    // FaceMesh model loading + stabilization can take a while
    test.setTimeout(60_000);

    await setupFakeCamera(page, `/fixtures/${fixture.name}.png`);
    await page.goto("/?angleTest");

    // Wait for face detection — angles div gets data attributes
    const anglesDiv = page.locator("#angles[data-pitch]");
    await anglesDiv.waitFor({ timeout: 45_000 });

    // Let FaceMesh stabilize for a few frames
    await page.waitForTimeout(2000);

    // Read final angles
    const pitchStr = await anglesDiv.getAttribute("data-pitch");
    const yawStr = await anglesDiv.getAttribute("data-yaw");
    expect(pitchStr).not.toBeNull();
    expect(yawStr).not.toBeNull();

    const pitch = parseFloat(pitchStr!);
    const yaw = parseFloat(yawStr!);

    const txStr = await anglesDiv.getAttribute("data-tx");
    const tyStr = await anglesDiv.getAttribute("data-ty");
    const tzStr = await anglesDiv.getAttribute("data-tz");
    console.log(`${fixture.name}: pitch=${pitch.toFixed(1)}° yaw=${yaw.toFixed(1)}° tx=${txStr} ty=${tyStr} tz=${tzStr}`);

    if (fixture.pitchRange) {
      expect(pitch, `pitch ${pitch.toFixed(1)}° outside [${fixture.pitchRange}]`)
        .toBeGreaterThanOrEqual(fixture.pitchRange[0]);
      expect(pitch, `pitch ${pitch.toFixed(1)}° outside [${fixture.pitchRange}]`)
        .toBeLessThanOrEqual(fixture.pitchRange[1]);
    }

    if (fixture.yawRange) {
      expect(yaw, `yaw ${yaw.toFixed(1)}° outside [${fixture.yawRange}]`)
        .toBeGreaterThanOrEqual(fixture.yawRange[0]);
      expect(yaw, `yaw ${yaw.toFixed(1)}° outside [${fixture.yawRange}]`)
        .toBeLessThanOrEqual(fixture.yawRange[1]);
    }
  });
}
