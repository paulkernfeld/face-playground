import type { Experiment, FaceData } from "../types";

// Nose tip is landmark index 1
const NOSE_TIP = 1;

let cursorX = 8;
let cursorY = 4.5;
// Smoothing factor: 0 = no smoothing, 1 = frozen
const SMOOTH = 0.7;

let trail: { x: number; y: number }[] = [];
const TRAIL_LEN = 20;
let tracking = false;
let w = 16;
let h = 9;
let pitch = 0;
let yaw = 0;

export const headCursor: Experiment = {
  name: "head cursor",

  setup(_ctx, ww, hh) {
    w = ww;
    h = hh;
    cursorX = w / 2;
    cursorY = h / 2;
    trail = [];
  },

  update(face: FaceData | null, _dt: number) {
    tracking = !!face;
    if (!face) return;
    const nose = face.landmarks[NOSE_TIP];
    // Mirror X so moving right moves cursor right
    const targetX = w - nose.x;
    const targetY = nose.y;
    cursorX = Math.max(0, Math.min(w, cursorX * SMOOTH + targetX * (1 - SMOOTH)));
    cursorY = Math.max(0, Math.min(h, cursorY * SMOOTH + targetY * (1 - SMOOTH)));

    pitch = face.headPitch;
    yaw = face.headYaw;

    trail.push({ x: cursorX, y: cursorY });
    if (trail.length > TRAIL_LEN) trail.shift();
  },

  draw(ctx, _w, _h) {
    // Draw trail
    for (let i = 0; i < trail.length; i++) {
      const t = i / trail.length;
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, 0.05 + t * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 255, 100, ${t * 0.5})`;
      ctx.fill();
    }

    // Draw cursor
    const cx = cursorX;
    const cy = cursorY;
    ctx.beginPath();
    ctx.arc(cx, cy, 0.22, 0, Math.PI * 2);
    const color = tracking ? "#0f0" : "#666";
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.04;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 0.05, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Crosshair lines
    ctx.beginPath();
    ctx.moveTo(cx - 0.35, cy);
    ctx.lineTo(cx - 0.12, cy);
    ctx.moveTo(cx + 0.12, cy);
    ctx.lineTo(cx + 0.35, cy);
    ctx.moveTo(cx, cy - 0.35);
    ctx.lineTo(cx, cy - 0.12);
    ctx.moveTo(cx, cy + 0.12);
    ctx.lineTo(cx, cy + 0.35);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.03;
    ctx.stroke();

    // Head angle debug
    if (tracking) {
      const deg = (r: number) => (r * 180 / Math.PI).toFixed(1);
      ctx.font = "0.25px monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "#888";
      ctx.fillText(`pitch ${deg(pitch)}°  yaw ${deg(yaw)}°`, 0.3, h - 0.3);
    }
  },
};
