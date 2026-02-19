import type { Experiment, Landmarks } from "./types";
import { pxText } from "./px-text";
import { GameRoughCanvas } from "./rough-scale";
import type { PersonState } from "./experiments/creature-shared";
import { updatePeople, drawPerson } from "./experiments/creature-shared";

// Capture tool for saving raw video frames as fixture images.
// Activate via ?capture URL param. Press Space to save raw video frame to fixtures/.

let w = 16, h = 9;
let rc: GameRoughCanvas;
let people: PersonState[] = [];
let flashUntil = 0;
let flashMsg = '';
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let countdownEnd = 0; // timestamp when countdown fires (0 = inactive)
const COUNTDOWN_SECS = 10;

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

      flashUntil = performance.now() + 400;
      flashMsg = `saved fixtures/${label}.png`;
    };

    // Keyboard: Space = start countdown (or cancel if running)
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (countdownEnd > 0) {
          countdownEnd = 0; // cancel
        } else {
          countdownEnd = performance.now() + COUNTDOWN_SECS * 1000;
        }
      }
    };
    document.addEventListener('keydown', keyHandler);
  },

  update() {
    // Fire capture when countdown reaches zero
    if (countdownEnd > 0 && performance.now() >= countdownEnd) {
      countdownEnd = 0;
      (window as any).__capture?.();
    }
  },

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

    // Countdown display
    if (countdownEnd > 0) {
      const remaining = Math.ceil((countdownEnd - now) / 1000);
      pxText(ctx, `${remaining}`, w / 2, h / 2, "bold 2px sans-serif", "#FFD93D", "center");
      pxText(ctx, "Space = cancel", w / 2, h / 2 + 1.5, "0.25px sans-serif", "#666", "center");
    } else {
      // Instructions
      pxText(ctx, `Space = ${COUNTDOWN_SECS}s timer then capture`, w / 2, h / 2, "0.3px sans-serif", "#ccc", "center");
      pxText(ctx, "v = toggle video feed", w / 2, h / 2 + 0.6, "0.25px sans-serif", "#666", "center");
    }

    // Capture flash
    if (now < flashUntil) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(0, 0, w, h);
      pxText(ctx, flashMsg, w / 2, h - 1.5, "bold 0.4px sans-serif", "#0f0", "center");
    }
  },

  cleanup() {},
};
