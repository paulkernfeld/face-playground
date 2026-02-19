import type { Experiment, Landmarks } from "./types";
import { pxText } from "./px-text";
import { GameRoughCanvas } from "./rough-scale";
import type { PersonState } from "./experiments/creature-shared";
import { updatePeople, drawPerson } from "./experiments/creature-shared";

// Capture tool for saving raw video frames as fixture images.
// Activate via ?capture URL param. Press Space to instantly save frame to fixtures/.

let w = 16, h = 9;
let rc: GameRoughCanvas;
let people: PersonState[] = [];
let flashUntil = 0;
let flashMsg = '';
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

export const captureExperiment: Experiment = {
  name: "capture",

  setup(ctx, ww, hh) {
    w = ww; h = hh;
    rc = new GameRoughCanvas(ctx.canvas);
    people = [];

    const win = window as any;

    // Prompt: set via URL param or window.__capturePrompt
    if (!win.__capturePrompt) {
      win.__capturePrompt = new URLSearchParams(window.location.search).get('prompt') || 'capture';
    }

    // Save raw video frame (not canvas overlay)
    win.__capture = async () => {
      const video = document.getElementById('webcam') as HTMLVideoElement;
      if (!video || video.readyState < 2) return;

      // Draw raw video to offscreen canvas at native resolution
      const offscreen = document.createElement('canvas');
      offscreen.width = video.videoWidth || 640;
      offscreen.height = video.videoHeight || 480;
      const offCtx = offscreen.getContext('2d')!;
      offCtx.drawImage(video, 0, 0);

      const pngBlob = await new Promise<Blob>((r) => offscreen.toBlob(b => r(b!), 'image/png'));

      const label = (win.__capturePrompt || 'capture').replace(/\s+/g, '-').toLowerCase();
      await fetch(`/api/fixture/${label}.png`, { method: 'PUT', body: pngBlob });

      flashUntil = performance.now() + 1000;
      flashMsg = `saved fixtures/${label}.png`;
    };

    // Keyboard: Space = instant capture
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        win.__capture?.();
      }
    };
    document.addEventListener('keydown', keyHandler);
  },

  update() {},

  updatePose(poses: Landmarks[], dt: number) {
    updatePeople(poses, people, dt, w);
  },

  draw(ctx, _w: number, _h: number, debug?: boolean) {
    // Only fill background when video feed is not showing
    if (!debug) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, w, h);
    }

    // Draw body creature
    for (let i = 0; i < people.length; i++) {
      drawPerson(ctx, rc, people[i], i, i * 100);
    }

    const prompt = (window as any).__capturePrompt || '';
    const now = performance.now();

    // Title
    pxText(ctx, "CAPTURE", w / 2, 1.2, "bold 0.5px sans-serif", "#FFD93D", "center");

    // Prompt banner
    if (prompt) {
      pxText(ctx, `saving as: ${prompt}.png`, w / 2, 2.2, "0.3px sans-serif", "#888", "center");
    }

    // Instructions
    pxText(ctx, "Space = capture instantly", w / 2, h / 2, "0.3px sans-serif", "#ccc", "center");
    pxText(ctx, "v = toggle video feed", w / 2, h / 2 + 0.6, "0.25px sans-serif", "#666", "center");

    // Capture flash + filename overlay (1s)
    if (now < flashUntil) {
      const elapsed = 1 - (flashUntil - now) / 1000;
      // White flash fades quickly (first 200ms), filename stays for 1s
      const flashAlpha = elapsed < 0.2 ? 0.4 * (1 - elapsed / 0.2) : 0;
      if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
        ctx.fillRect(0, 0, w, h);
      }
      pxText(ctx, flashMsg, w / 2, h - 1.5, "bold 0.35px sans-serif", "#0f0", "center");
    }
  },

  cleanup() {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  },
};
