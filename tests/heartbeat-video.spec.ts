import { test, expect } from "@playwright/test";
import { setupFakeVideoCamera } from "./fake-camera";

/**
 * Feed a real video fixture through the full heartbeat pipeline:
 * fake video camera → FaceMesh → heartbeat experiment → read BPM.
 * The fixture is a ~30s clip with heart rate in the high-80s to mid-70s range.
 *
 * Must run with fullyParallel=false — multiple FaceMesh instances competing
 * for CPU tanks frame rate below usable levels for rPPG.
 */
test.describe.configure({ mode: 'serial' });

test("heartbeat: video fixture produces BPM in plausible range", async ({ page }) => {
  test.setTimeout(120_000);

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await setupFakeVideoCamera(page, "/fixtures/heartbeat-high-80s-to-mid-70s.mov");
  await page.goto("/?exp=9");

  // Wait for FaceMesh to detect a face (angles span gets populated, but it's hidden in the HUD)
  await expect.poll(
    () => page.locator("#angles").textContent(),
    { timeout: 45_000, intervals: [500] }
  ).toContain("pitch");

  // Wait for enough buffer to accumulate (at least 10s of green signal)
  await expect.poll(
    () => page.evaluate("window.__heartbeatBufferDuration"),
    { timeout: 60_000, intervals: [1000] }
  ).toBeGreaterThanOrEqual(10);

  // Wait for BPM to be a number (not null)
  await expect.poll(
    () => page.evaluate("window.__heartbeatBpm"),
    { timeout: 30_000, intervals: [1000] }
  ).not.toBeNull();

  const bpm = await page.evaluate("window.__heartbeatBpm") as number;
  const bufferLen = await page.evaluate("window.__heartbeatBufferLength") as number;
  const bufferDur = await page.evaluate("window.__heartbeatBufferDuration") as number;

  const sampleRate = bufferLen / bufferDur;
  console.log(`Heartbeat result: BPM=${bpm}, buffer=${bufferLen} samples over ${bufferDur.toFixed(1)}s (${sampleRate.toFixed(1)} fps)`);

  // Guard: if CPU pressure caused too few frames, the signal is unreliable.
  // 10 fps is the minimum for useful rPPG (Nyquist for 3Hz/180BPM is 6Hz,
  // but we need margin for windowing and noise).
  expect(sampleRate, `Sample rate ${sampleRate.toFixed(1)} fps too low — CPU backpressure?`).toBeGreaterThanOrEqual(10);

  // Generous range — pipeline validation, not medical accuracy
  expect(bpm, `BPM ${bpm} outside plausible range 50-120`).toBeGreaterThanOrEqual(50);
  expect(bpm, `BPM ${bpm} outside plausible range 50-120`).toBeLessThanOrEqual(120);

  expect(errors).toHaveLength(0);
});
