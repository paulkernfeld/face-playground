import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";

/**
 * Loading diagnostics — run when the app gets stuck at "loading face model…"
 *
 *   npx playwright test tests/diagnose-loading.spec.ts
 *
 * Produces a human-readable diagnosis. Stays in the repo as a permanent
 * regression tool for loading issues (CDN drift, WASM version mismatch,
 * network problems, GPU failures).
 */

const PINNED_VERSION = "0.10.32";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision`;
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

test.describe("Loading diagnostics", () => {
  test("A — WASM @latest version check", async ({ page }) => {
    const result = await page.evaluate(async (pinned) => {
      try {
        const resp = await fetch(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/package.json`
        );
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        const pkg = await resp.json();
        return {
          latestVersion: pkg.version,
          pinnedVersion: pinned,
          match: pkg.version === pinned,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    }, PINNED_VERSION);

    console.log("=== Test A: WASM @latest version ===");
    console.log(JSON.stringify(result, null, 2));

    if ("error" in result) {
      test.info().annotations.push({
        type: "diagnosis",
        description: `Could not fetch @latest version: ${result.error}`,
      });
    } else if (!result.match) {
      test.info().annotations.push({
        type: "diagnosis",
        description: `VERSION MISMATCH: @latest=${result.latestVersion}, pinned=${result.pinnedVersion}. This is likely the root cause.`,
      });
    } else {
      test.info().annotations.push({
        type: "diagnosis",
        description: `Versions match: ${result.latestVersion}`,
      });
    }

    expect(true).toBe(true);
  });

  test("B — Network reachability", async ({ page }) => {
    const urls = [
      {
        label: "WASM runtime (pinned)",
        url: `${WASM_BASE}@${PINNED_VERSION}/wasm/vision_wasm_internal.js`,
      },
      {
        label: "WASM runtime (@latest)",
        url: `${WASM_BASE}@latest/wasm/vision_wasm_internal.js`,
      },
      { label: "Face model", url: FACE_MODEL_URL },
    ];

    const results = await page.evaluate(async (urls) => {
      const out: Array<{
        label: string;
        url: string;
        status?: number;
        ok?: boolean;
        timeMs?: number;
        error?: string;
      }> = [];
      for (const { label, url } of urls) {
        const start = Date.now();
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10_000);
          const resp = await fetch(url, {
            method: "HEAD",
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          out.push({
            label,
            url,
            status: resp.status,
            ok: resp.ok,
            timeMs: Date.now() - start,
          });
        } catch (e: any) {
          out.push({
            label,
            url,
            error: e.message,
            timeMs: Date.now() - start,
          });
        }
      }
      return out;
    }, urls);

    console.log("=== Test B: Network reachability ===");
    for (const r of results) {
      const status = r.error
        ? `ERROR: ${r.error}`
        : `HTTP ${r.status} (${r.timeMs}ms)`;
      console.log(`  ${r.label}: ${status}`);
      test.info().annotations.push({
        type: "diagnosis",
        description: `${r.label}: ${status}`,
      });
    }

    expect(true).toBe(true);
  });

  test("C — Full load with console capture", async ({ page }) => {
    test.setTimeout(45_000);

    const logs: string[] = [];
    page.on("console", (msg) => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      logs.push(`[PAGE ERROR] ${err.message}`);
    });
    page.on("requestfailed", (req) => {
      logs.push(
        `[NET FAIL] ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`
      );
    });

    // Use fake camera so we don't depend on headless Chrome's camera behavior
    await setupFakeCamera(page, "/fixtures/straight.png");

    await page.goto("/?exp=1");

    // Poll loading text every 1s for up to 30s
    const stages: string[] = [];
    const start = Date.now();
    let loaded = false;

    for (let i = 0; i < 30; i++) {
      const loadingVisible = await page
        .locator("#loading")
        .isVisible()
        .catch(() => false);
      if (!loadingVisible) {
        loaded = true;
        break;
      }
      const text = await page
        .locator(".loading-text")
        .textContent()
        .catch(() => null);
      if (text && (stages.length === 0 || stages[stages.length - 1] !== text)) {
        stages.push(text);
        console.log(`  [${((Date.now() - start) / 1000).toFixed(1)}s] ${text}`);
      }
      await page.waitForTimeout(1000);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log("=== Test C: Full load ===");
    console.log(`  Loaded: ${loaded} (${elapsed}s)`);
    console.log(`  Loading stages seen: ${stages.join(" → ")}`);

    if (!loaded) {
      console.log(`  Console output (${logs.length} messages):`);
      for (const l of logs) console.log(`    ${l}`);
      test.info().annotations.push({
        type: "diagnosis",
        description: `STUCK after ${elapsed}s. Last stage: "${stages[stages.length - 1] ?? "unknown"}". ${logs.length} console messages — check output.`,
      });
    } else {
      test.info().annotations.push({
        type: "diagnosis",
        description: `Loaded OK in ${elapsed}s`,
      });
    }

    expect(loaded, `Loading did not complete after ${elapsed}s`).toBe(true);
  });

  test("D — Load with pinned WASM version", async ({ page }) => {
    test.setTimeout(45_000);

    // Intercept @latest URL and rewrite to pinned version
    await page.route("**/tasks-vision@latest/**", (route) => {
      const url = route.request().url().replace("@latest", `@${PINNED_VERSION}`);
      route.continue({ url });
    });

    const logs: string[] = [];
    page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) =>
      logs.push(`[PAGE ERROR] ${err.message}`)
    );
    page.on("requestfailed", (req) =>
      logs.push(
        `[NET FAIL] ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`
      )
    );

    // Use fake camera
    await setupFakeCamera(page, "/fixtures/straight.png");

    await page.goto("/?exp=1");

    const stages: string[] = [];
    const start = Date.now();
    let loaded = false;

    for (let i = 0; i < 30; i++) {
      const loadingVisible = await page
        .locator("#loading")
        .isVisible()
        .catch(() => false);
      if (!loadingVisible) {
        loaded = true;
        break;
      }
      const text = await page
        .locator(".loading-text")
        .textContent()
        .catch(() => null);
      if (text && (stages.length === 0 || stages[stages.length - 1] !== text)) {
        stages.push(text);
        console.log(`  [${((Date.now() - start) / 1000).toFixed(1)}s] ${text}`);
      }
      await page.waitForTimeout(1000);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log("=== Test D: Pinned WASM version ===");
    console.log(`  Loaded: ${loaded} (${elapsed}s)`);

    if (loaded) {
      test.info().annotations.push({
        type: "diagnosis",
        description: `Pinned WASM loaded OK in ${elapsed}s. If Test C failed, @latest version drift is the cause — pin the WASM URL.`,
      });
    } else {
      console.log(`  Console output (${logs.length} messages):`);
      for (const l of logs) console.log(`    ${l}`);
      test.info().annotations.push({
        type: "diagnosis",
        description: `Pinned WASM also failed after ${elapsed}s. Problem is NOT version drift — check network/GPU.`,
      });
    }

    expect(loaded, `Pinned WASM load did not complete after ${elapsed}s`).toBe(
      true
    );
  });

  test("E — All experiments smoke test", async ({ page }) => {
    // 30s for first experiment (model load) + 10s each for remaining 7 + buffer
    test.setTimeout(120_000);

    // Intercept @latest → pinned (so version drift doesn't block this test)
    await page.route("**/tasks-vision@latest/**", (route) => {
      const url = route.request().url().replace("@latest", `@${PINNED_VERSION}`);
      route.continue({ url });
    });

    // Use fake camera
    await setupFakeCamera(page, "/fixtures/straight.png");

    const results: Array<{
      exp: number;
      loaded: boolean;
      elapsed: string;
      error?: string;
    }> = [];

    for (let exp = 1; exp <= 8; exp++) {
      const errors: string[] = [];
      const errorHandler = (err: Error) => errors.push(err.message);
      page.on("pageerror", errorHandler);

      await page.goto(`/?exp=${exp}`);

      const start = Date.now();
      let loaded = false;

      // 30s for first (model load), 10s for rest (model cached)
      const maxWaitS = exp === 1 ? 30 : 10;
      for (let i = 0; i < maxWaitS; i++) {
        const loadingVisible = await page
          .locator("#loading")
          .isVisible()
          .catch(() => false);
        if (!loadingVisible) {
          loaded = true;
          break;
        }
        await page.waitForTimeout(1000);
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results.push({
        exp,
        loaded,
        elapsed,
        error: errors.length > 0 ? errors.join("; ") : undefined,
      });

      page.off("pageerror", errorHandler);

      console.log(
        `  exp=${exp}: ${loaded ? "OK" : "STUCK"} (${elapsed}s)${errors.length ? ` errors: ${errors.join("; ")}` : ""}`
      );

      // If first experiment loads, the rest should be fast (model cached).
      // If first fails, skip the rest to save time.
      if (exp === 1 && !loaded) {
        console.log("  Skipping remaining experiments — first one failed.");
        for (let skip = 2; skip <= 8; skip++) {
          results.push({ exp: skip, loaded: false, elapsed: "0", error: "skipped" });
        }
        break;
      }
    }

    console.log("=== Test E: All experiments ===");
    const failed = results.filter((r) => !r.loaded);
    if (failed.length === 0) {
      test.info().annotations.push({
        type: "diagnosis",
        description: "All 8 experiments loaded successfully.",
      });
    } else if (failed.length === results.length) {
      test.info().annotations.push({
        type: "diagnosis",
        description: `ALL experiments failed to load. Universal issue (WASM/model/GPU).`,
      });
    } else {
      test.info().annotations.push({
        type: "diagnosis",
        description: `${failed.length}/8 experiments failed: ${failed.map((r) => `exp=${r.exp}`).join(", ")}`,
      });
    }

    expect(
      failed.length,
      `${failed.length} experiments failed to load`
    ).toBe(0);
  });
});
