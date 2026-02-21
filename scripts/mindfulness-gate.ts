/**
 * Mindfulness gate — opens headed Chrome, runs mindfulness experiment,
 * exits 0 when completed. Used by mindfulness-gate.sh.
 *
 * Usage: npx tsx scripts/mindfulness-gate.ts --port 5198 --duration 10
 */

import { chromium } from "playwright";

const args = process.argv.slice(2);
const port = args[args.indexOf("--port") + 1] || "5198";
const duration = args[args.indexOf("--duration") + 1] || "10";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext();
  await context.grantPermissions(["camera"]);
  const page = await context.newPage();

  const url = "http://localhost:" + port + "/face-playground/?exp=8&duration=" + duration;
  console.log("Navigating to " + url);
  await page.goto(url);

  console.log("Waiting for " + duration + "s mindfulness completion...");
  // Poll via page.evaluate — avoids tsx/esbuild __name issues with waitForFunction
  while (true) {
    const phase = await page.evaluate("window.__mindfulnessPhase");
    if (phase === "complete") break;
    await page.waitForTimeout(500);
  }

  console.log("Mindfulness complete!");
  await browser.close();
  process.exit(0);
}

main().catch(function(e) {
  console.error(e);
  process.exit(1);
});
