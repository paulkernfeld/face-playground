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

/**
 * Override getUserMedia to return a video stream from a video file.
 * The video is loaded from the given URL (served by Vite's static server).
 * Frames are pumped to a canvas via rAF so FaceMesh sees changing frames.
 */
export async function setupFakeVideoCamera(page: Page, videoUrl: string) {
  await page.addInitScript((url: string) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.src = url;

      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(`Failed to load video fixture: ${url}`));
      });
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d")!;

      // Pump video frames to canvas so captureStream emits them
      const pump = () => {
        if (!video.paused && !video.ended) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        requestAnimationFrame(pump);
      };
      pump();

      return canvas.captureStream(30) as MediaStream;
    };
  }, videoUrl);
}
