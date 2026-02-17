import type { Page } from "@playwright/test";

/**
 * Override getUserMedia to return a video stream from a static image.
 * The image is loaded from the given URL (served by Vite's static server).
 * FaceMesh receives a repeating frame and stabilizes after a few detections.
 */
export async function setupFakeCamera(page: Page, imageUrl: string) {
  await page.addInitScript((url: string) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load fixture: ${url}`));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      // Redraw periodically so captureStream produces new frames
      // (some browsers pause streams from static canvases)
      setInterval(() => {
        ctx.drawImage(img, 0, 0);
      }, 100);

      return canvas.captureStream(10) as MediaStream;
    };
  }, imageUrl);
}
