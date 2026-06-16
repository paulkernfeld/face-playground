import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";

// MorphCast E2E: verifies the SDK loads, registers modules, claims the camera,
// and starts emitting real events. License key comes from .env (VITE_MORPHCAST_KEY)
// and is compiled into the bundle by Vite — no test-side env wiring needed.
//
//   npx playwright test tests/morphcast.spec.ts
//   npx playwright test tests/morphcast.spec.ts --headed
//
// Skips when no key is set so CI on a fork still passes.

type Snapshot = {
  status: 'no-key' | 'loading' | 'running' | 'error';
  statusMsg: string;
  eventCount: number;
  valence: number;
  arousal: number;
  attention: number;
  wish: number;
  emotion: Record<string, number>;
};

async function getSnapshot(page: import("@playwright/test").Page): Promise<Snapshot | null> {
  return page.evaluate(() => (window as any).__morphcast ?? null);
}

test("morphcast: loads SDK and emits events", async ({ page }) => {
  test.setTimeout(60_000); // SDK download + module init + first inference

  // Fake camera with a face fixture — MorphCast does its own face detection.
  await setupFakeCamera(page, "/fixtures/straight.png");

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/?exp=11");

  // Wait for status to reach 'running' OR 'error'.
  // Use evaluate-poll (not waitForFunction) because tsx-built scripts hit a known
  // __name issue under page.waitForFunction; see CLAUDE.md memory note.
  const reachedTerminal = await page.waitForFunction(() => {
    const m = (window as any).__morphcast;
    return m && (m.status === 'running' || m.status === 'error') ? m.status : false;
  }, undefined, { timeout: 45_000 }).then(h => h.jsonValue() as Promise<string>);

  if (reachedTerminal === 'error') {
    const snap = await getSnapshot(page);
    throw new Error(`MorphCast errored: ${snap?.statusMsg}`);
  }

  expect(reachedTerminal).toBe('running');

  // Wait for at least one real event (proves data plane works — this is the
  // regression for the "_source.getFrame is not a function" bug).
  await page.waitForFunction(() => ((window as any).__morphcast?.eventCount ?? 0) > 0,
    undefined, { timeout: 30_000 });

  // Wait for valence/arousal to drift from initial 0. Module-level smoothness
  // (config in morphcast.ts) means values move slowly — need many events before
  // the EWMA escapes 0. This is also the regression check for the AV payload
  // parsing bug (looked for .output.affects instead of .output).
  await page.waitForFunction(() => {
    const m = (window as any).__morphcast;
    return Math.abs(m?.valence ?? 0) + Math.abs(m?.arousal ?? 0) > 0;
  }, undefined, { timeout: 30_000 });

  const final = await getSnapshot(page);
  expect(final).not.toBeNull();
  expect(final!.eventCount).toBeGreaterThan(0);
  expect(Math.abs(final!.valence) + Math.abs(final!.arousal)).toBeGreaterThan(0);

  console.log("morphcast snapshot:", JSON.stringify({
    status: final!.status,
    eventCount: final!.eventCount,
    evtCounts: (final as any).evtCounts,
    valence: final!.valence,
    arousal: final!.arousal,
    attention: final!.attention,
    wish: final!.wish,
    topEmotion: Object.entries(final!.emotion).sort((a, b) => b[1] - a[1])[0],
  }, null, 2));

  await page.screenshot({ path: ".screenshots/morphcast-e2e.png" });

  // No "instance already running" errors — that's a separate regression we hit
  // when bootMorphcast was re-invoked without proper teardown.
  const dupe = consoleErrors.find(e => /already running|Multiple instances/i.test(e));
  expect(dupe, `unexpected SDK error: ${dupe}`).toBeUndefined();
});

test("morphcast: menu → enter → back → re-enter doesn't double-init", async ({ page }) => {
  test.setTimeout(120_000);
  await setupFakeCamera(page, "/fixtures/straight.png");

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Start at the menu (not kiosk) so q-to-back actually works.
  await page.goto("/");
  await page.locator('.experiment-card[data-exp="10"]').click();
  await page.waitForFunction(() => ((window as any).__morphcast?.status === 'running'),
    undefined, { timeout: 45_000 });

  // q goes back to menu (works because we entered via menu, not ?exp=).
  await page.keyboard.press('q');
  await page.locator('.experiment-card[data-exp="10"]').waitFor({ timeout: 5_000 });

  // Re-enter. The old loader was the trigger for "instance already running".
  await page.locator('.experiment-card[data-exp="10"]').click();
  const status2 = await page.waitForFunction(() => {
    const m = (window as any).__morphcast;
    return m && (m.status === 'running' || m.status === 'error') ? m.status : false;
  }, undefined, { timeout: 45_000 }).then(h => h.jsonValue() as Promise<string>);

  expect(status2).toBe('running');

  const dupe = consoleErrors.find(e => /already running|Multiple instances/i.test(e));
  expect(dupe, `re-init triggered SDK error: ${dupe}`).toBeUndefined();
});
