import { test, expect } from "@playwright/test";

test("shows error state when camera is unavailable", async ({ page }) => {
  // Override getUserMedia to simulate camera failure
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });

  await page.goto("/");

  // Menu should be visible
  await expect(page.locator(".menu-title")).toBeVisible();

  // Click the first experiment card
  await page.locator(".experiment-card").first().click();

  // Should show the error message and back button
  const loading = page.locator("#loading");
  await expect(loading).toContainText("camera permission was denied");
  const backBtn = loading.locator(".camera-error-back");
  await expect(backBtn).toBeVisible();
  await backBtn.click();

  // Should be back at the menu
  await expect(page.locator(".menu-title")).toBeVisible();
});

test("shows error state for insecure context", async ({ page }) => {
  // Override to simulate missing mediaDevices (HTTP on non-localhost)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined });
  });

  await page.goto("/");
  await page.locator(".experiment-card").first().click();

  const loading = page.locator("#loading");
  await expect(loading).toContainText("camera requires HTTPS");
  await loading.locator(".camera-error-back").click();
  await expect(page.locator(".menu-title")).toBeVisible();
});
