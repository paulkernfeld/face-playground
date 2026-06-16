import { test } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";

// One-off probe: boot MorphCast and dump the raw `firstPayloads` so we can
// see actual field shapes (affects98, affects38, features, pose, HD emotion,
// aggregator) without guessing from doc snippets. Not a real assertion — just
// prints to console.

test("morphcast: dump raw firstPayloads", async ({ page }) => {
  test.setTimeout(90_000);
  await setupFakeCamera(page, "/fixtures/straight.png");

  page.on("console", (msg) => {
    if (msg.text().startsWith("[morphcast]")) console.log("FROM PAGE:", msg.text());
  });

  await page.goto("/?exp=11");

  await page.waitForFunction(() => {
    const m = (window as any).__morphcast;
    return m && (m.status === 'running' || m.status === 'error');
  }, undefined, { timeout: 45_000 });

  // Give every module time to fire at least once (~10s usually).
  await page.waitForFunction(() => {
    const m = (window as any).__morphcast;
    const counts = m?.evtCounts ?? {};
    // Want AV at minimum; others may take longer.
    return (counts.av ?? 0) >= 3;
  }, undefined, { timeout: 30_000 });

  // Wait an extra beat to let slower modules (features, pose, aggregator) emit.
  await page.waitForTimeout(8_000);

  const dump = await page.evaluate(() => {
    const m = (window as any).__morphcast;
    return {
      status: m.status,
      evtCounts: m.evtCounts,
      firstPayloads: m.firstPayloads,
    };
  });

  console.log("===== MORPHCAST PROBE DUMP =====");
  console.log(JSON.stringify(dump, null, 2));
  console.log("===== END DUMP =====");
});
