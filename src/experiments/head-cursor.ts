import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { teal, stone } from '../palette';

// Nose tip is landmark index 1
const NOSE_TIP = 1;

let cursorX = 8;
let cursorY = 4.5;
// Smoothing factor: 0 = no smoothing, 1 = frozen
const SMOOTH = 0.7;

let tracking = false;
let w = 16;
let h = 9;
let pitch = 0;
let yaw = 0;
let rc: GameRoughCanvas;

export const headCursor: Experiment = {
  name: "head cursor",

  setup(ctx, ww, hh) {
    w = ww;
    h = hh;
    cursorX = w / 2;
    cursorY = h / 2;
    rc = new GameRoughCanvas(ctx.canvas);
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

  },

  demo() {
    tracking = true;
    cursorX = 10;
    cursorY = 3.5;
    pitch = 0.1;
    yaw = -0.05;
  },

  draw(ctx, _w, _h) {
    // Draw cursor
    const cx = cursorX;
    const cy = cursorY;
    const color = tracking ? teal : stone;

    // Outer ring
    rc.circle(cx, cy, 0.44, {
      stroke: color, strokeWidth: 0.04, fill: 'none', roughness: 1.2, seed: 100,
    });
    // Center dot
    rc.circle(cx, cy, 0.1, {
      fill: color, fillStyle: 'solid', stroke: 'none', roughness: 0.5, seed: 101,
    });

    // Crosshair lines
    rc.line(cx - 0.35, cy, cx - 0.12, cy, { stroke: color, strokeWidth: 0.03, roughness: 1, seed: 102 });
    rc.line(cx + 0.12, cy, cx + 0.35, cy, { stroke: color, strokeWidth: 0.03, roughness: 1, seed: 103 });
    rc.line(cx, cy - 0.35, cx, cy - 0.12, { stroke: color, strokeWidth: 0.03, roughness: 1, seed: 104 });
    rc.line(cx, cy + 0.12, cx, cy + 0.35, { stroke: color, strokeWidth: 0.03, roughness: 1, seed: 105 });

    // Head angle debug (show near cursor)
    if (tracking) {
      const deg = (r: number) => (r * 180 / Math.PI).toFixed(1);
      pxText(ctx, `pitch ${deg(pitch)}\u00b0  yaw ${deg(yaw)}\u00b0`, cx, cy - 0.5, "0.2px monospace", stone, "center");
    }
  },

  cleanup() {},
};
