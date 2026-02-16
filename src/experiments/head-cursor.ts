import type { Experiment, Landmarks } from "../types";

// Nose tip is landmark index 1
const NOSE_TIP = 1;

let cursorX = 0.5;
let cursorY = 0.5;
// Smoothing factor: 0 = no smoothing, 1 = frozen
const SMOOTH = 0.7;

let trail: { x: number; y: number }[] = [];
const TRAIL_LEN = 20;

export const headCursor: Experiment = {
  name: "head cursor",

  setup(_ctx, w, h) {
    cursorX = w / 2;
    cursorY = h / 2;
    trail = [];
  },

  update(landmarks: Landmarks | null, _dt: number) {
    if (!landmarks) return;
    const nose = landmarks[NOSE_TIP];
    // Mirror X so moving right moves cursor right
    const targetX = 1 - nose.x;
    const targetY = nose.y;
    cursorX = cursorX * SMOOTH + targetX * (1 - SMOOTH);
    cursorY = cursorY * SMOOTH + targetY * (1 - SMOOTH);

    trail.push({ x: cursorX, y: cursorY });
    if (trail.length > TRAIL_LEN) trail.shift();
  },

  draw(ctx, w, h) {
    // Draw trail
    for (let i = 0; i < trail.length; i++) {
      const t = i / trail.length;
      const px = trail[i].x * w;
      const py = trail[i].y * h;
      ctx.beginPath();
      ctx.arc(px, py, 4 + t * 12, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 255, 100, ${t * 0.5})`;
      ctx.fill();
    }

    // Draw cursor
    const cx = cursorX * w;
    const cy = cursorY * h;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#0f0";
    ctx.fill();

    // Crosshair lines
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy);
    ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 28, cy);
    ctx.moveTo(cx, cy - 28);
    ctx.lineTo(cx, cy - 10);
    ctx.moveTo(cx, cy + 10);
    ctx.lineTo(cx, cy + 28);
    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 2;
    ctx.stroke();
  },
};
