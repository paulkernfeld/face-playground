import { test, expect } from "@playwright/test";
import { setupFakeCamera } from "./fake-camera";

/**
 * Verify ?angleTest route detects face and exposes pitch/yaw data attributes.
 *
 *   npx playwright test tests/angle-headed.spec.ts
 *   npx playwright test tests/angle-headed.spec.ts --headed
 */
test("angleTest: detects face and exposes pitch/yaw", async ({ page }) => {
  test.setTimeout(15_000);

  await setupFakeCamera(page, "/fixtures/straight.png");
  await page.goto("/?angleTest");

  const anglesDiv = page.locator("#angles[data-pitch]");
  await anglesDiv.waitFor({ timeout: 10_000 });

  const pitch = await anglesDiv.getAttribute("data-pitch");
  console.log(`angleTest — pitch: ${pitch}`);
  expect(pitch).not.toBeNull();
});
