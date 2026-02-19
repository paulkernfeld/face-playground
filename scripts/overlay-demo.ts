/**
 * Render an experiment using real fixture landmarks, overlaid on the fixture photo.
 *
 * Usage:
 *   npx tsx scripts/overlay-demo.ts <experiment-number> <fixture-basename>
 *
 * Example:
 *   npx tsx scripts/overlay-demo.ts 3 yoga-mountain
 *   npx tsx scripts/overlay-demo.ts 6 yoga-volcano
 *
 * Expects (in fixtures/):
 *   <basename>.png                  — the photo
 *   <basename>.image-landmarks.json — image-space pose landmarks (0..1 coords, 33 points)
 *
 * Output: .screenshots/overlay-<basename>.png (opened in Preview)
 *
 * Requires dev server running on port 5199.
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const expNum = process.argv[2];
const basename = process.argv[3];

if (!expNum || !basename) {
  console.error("Usage: npx tsx scripts/overlay-demo.ts <experiment-number> <fixture-basename>");
  console.error("Example: npx tsx scripts/overlay-demo.ts 3 yoga-mountain");
  process.exit(1);
}

const photoPath = `fixtures/${basename}.png`;
const landmarksPath = `fixtures/${basename}.image-landmarks.json`;

if (!fs.existsSync(photoPath)) {
  console.error(`Photo not found: ${photoPath}`);
  process.exit(1);
}
if (!fs.existsSync(landmarksPath)) {
  console.error(`Landmarks not found: ${landmarksPath}`);
  console.error("Run: npx playwright test tests/extract-landmarks.spec.ts");
  process.exit(1);
}

// Game-unit space (must match main.ts)
const GAME_W = 16;
const GAME_H = 9;
const W = 1280;
const H = 608;

const outPath = `.screenshots/overlay-${basename}.png`;

interface ImageLandmark {
  x: number; // 0..1
  y: number; // 0..1
  z: number;
  visibility: number;
}

function imageToGameUnits(landmarks: ImageLandmark[]): { x: number; y: number; z: number }[] {
  // Image landmarks are in 0..1 normalized coords.
  // main.ts maps them to game units: x * GAME_W, y * GAME_H
  return landmarks.map((l) => ({
    x: l.x * GAME_W,
    y: l.y * GAME_H,
    z: l.z,
  }));
}

async function main() {
  const landmarks: ImageLandmark[] = JSON.parse(fs.readFileSync(landmarksPath, "utf-8"));
  const gamePoints = imageToGameUnits(landmarks);

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();

  // Inject pose data before page loads — main.ts checks __overridePoses each frame
  await page.addInitScript(
    `window.__overridePoses = [${JSON.stringify(gamePoints)}];`
  );

  // Navigate to ?play=N (game loop, no camera)
  console.log(`Loading ?play=${expNum} with ${basename} landmarks...`);
  await page.goto(`http://localhost:5199/face-playground/?play=${expNum}`);

  // Wait for experiment to render with the injected pose
  await page.waitForTimeout(2500);

  // Take screenshot of the experiment rendering
  const expBuffer = await page.screenshot();

  // Composite: photo background + experiment overlay
  console.log("Compositing...");
  const photoB64 = fs.readFileSync(path.resolve(photoPath)).toString("base64");
  const expB64 = expBuffer.toString("base64");

  await page.setContent(`<canvas id="c" width="${W}" height="${H}" style="display:block"></canvas>`);
  await page.evaluate(
    `(async (args) => {
      var canvas = document.getElementById("c");
      var ctx = canvas.getContext("2d");

      function loadImg(src) {
        return new Promise(function(res, rej) {
          var img = new Image();
          img.onload = function() { res(img); };
          img.onerror = rej;
          img.src = src;
        });
      }

      var photo = await loadImg("data:image/png;base64," + args.photoB64);
      var exp = await loadImg("data:image/png;base64," + args.expB64);

      // Photo background — scaled to fit, clearly visible
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, ${W}, ${H});
      var scale = Math.min(${W} / photo.width, ${H} / photo.height);
      var pw = photo.width * scale;
      var ph = photo.height * scale;
      ctx.globalAlpha = 0.6;
      ctx.drawImage(photo, (${W} - pw) / 2, (${H} - ph) / 2, pw, ph);

      // Experiment overlay (semi-transparent so photo shows through)
      ctx.globalAlpha = 0.8;
      ctx.drawImage(exp, 0, 0, ${W}, ${H});
      ctx.globalAlpha = 1.0;
    })(${JSON.stringify({ photoB64, expB64 })})`
  );

  fs.mkdirSync(".screenshots", { recursive: true });
  await page.screenshot({ path: outPath });
  await browser.close();

  console.log("Saved: " + outPath);
  execSync('open -a Preview "' + path.resolve(outPath) + '"');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
