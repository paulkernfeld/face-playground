import type { Experiment, FaceData, Blendshapes } from "../types";
import { GameRoughCanvas } from '../rough-scale';

// Blendshapes we think indicate facial tension
const TENSION_NAMES = [
  "jawClench",
  "mouthClose",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthShrugUpper",
  "mouthShrugLower",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "browDownLeft",
  "browDownRight",
  "browInnerUp",
  "eyeSquintLeft",
  "eyeSquintRight",
  "noseSneerLeft",
  "noseSneerRight",
  "cheekSquintLeft",
  "cheekSquintRight",
];

// Blendshapes that might be interesting but we're not sure yet
const MAYBE_NAMES = [
  "jawOpen",
  "jawLeft",
  "jawRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthPucker",
  "mouthLeft",
  "mouthRight",
  "eyeWideLeft",
  "eyeWideRight",
  "cheekPuff",
];

// Map each tension blendshape to a relaxation instruction
const RELAXATION_INSTRUCTIONS: Record<string, string> = {
  jawClench: "unclench your jaw",
  mouthClose: "let your lips part",
  mouthPressLeft: "soften your lips",
  mouthPressRight: "soften your lips",
  mouthShrugUpper: "relax your upper lip",
  mouthShrugLower: "relax your lower lip",
  mouthStretchLeft: "ease the corners of your mouth",
  mouthStretchRight: "ease the corners of your mouth",
  mouthFrownLeft: "let your mouth go neutral",
  mouthFrownRight: "let your mouth go neutral",
  browDownLeft: "smooth your forehead",
  browDownRight: "smooth your forehead",
  browInnerUp: "relax your inner brows",
  eyeSquintLeft: "soften your eyes",
  eyeSquintRight: "soften your eyes",
  noseSneerLeft: "relax your nose",
  noseSneerRight: "relax your nose",
  cheekSquintLeft: "soften your cheeks",
  cheekSquintRight: "soften your cheeks",
};

const TENSION_SET = new Set(TENSION_NAMES);
const MAYBE_SET = new Set(MAYBE_NAMES);

let latestBlendshapes: Blendshapes = new Map();
let showAll = false;
let rc: GameRoughCanvas;

export const blendshapeDebug: Experiment = {
  name: "tension",

  setup(ctx) {
    latestBlendshapes = new Map();
    rc = new GameRoughCanvas(ctx.canvas);
  },

  demo() {
    latestBlendshapes = new Map<string, number>([
      ["jawClench", 0.65],
      ["browDownLeft", 0.45],
      ["browDownRight", 0.42],
      ["eyeSquintLeft", 0.38],
      ["eyeSquintRight", 0.35],
      ["mouthPressLeft", 0.2],
      ["jawOpen", 0.15],
      ["cheekPuff", 0.1],
    ]);
  },

  update(face: FaceData | null, _dt: number) {
    if (face) {
      latestBlendshapes = face.blendshapes;
    }
  },

  draw(ctx, w, h) {
    // Find which tension blendshapes are nonzero
    const active: { name: string; val: number }[] = [];
    for (const name of TENSION_NAMES) {
      const val = latestBlendshapes.get(name) ?? 0;
      const threshold = name.startsWith("eyeSquint") ? 0.3 : (name.startsWith("brow") || name.startsWith("mouthStretch")) ? 0 : 0.1;
      if (val > threshold) {
        active.push({ name, val });
      }
    }
    active.sort((a, b) => b.val - a.val);

    const tense = active.length > 0;

    // Big centered indicator with relaxation instruction
    ctx.textAlign = "center";
    if (tense) {
      const instruction = RELAXATION_INSTRUCTIONS[active[0].name] ?? "relax";
      ctx.font = "bold 0.45px monospace";
      ctx.fillStyle = "#f44";
      ctx.fillText(instruction, w / 2, h / 2);
    } else {
      ctx.font = "bold 0.6px monospace";
      ctx.fillStyle = "#0f0";
      ctx.fillText("RELAXED", w / 2, h / 2);
    }

    // Active tension blendshapes
    if (active.length > 0) {
      ctx.font = "0.22px monospace";
      ctx.textAlign = "left";
      const LEFT = 0.5;
      const BAR_MAX = w * 0.4;

      for (let i = 0; i < active.length; i++) {
        const y = 1.2 + i * 0.35;
        const { name, val } = active[i];

        // Label
        ctx.fillStyle = "#fff";
        ctx.fillText(name, LEFT, y + 0.22);

        // Bar background
        const barX = LEFT + 3.0;
        rc.rectangle(barX, y + 0.02, BAR_MAX, 0.25, {
          fill: 'rgba(255,255,255,0.05)', fillStyle: 'solid', stroke: 'none',
          roughness: 0.3, seed: i + 200,
        });
        // Bar fill
        if (val * BAR_MAX > 0.01) {
          rc.rectangle(barX, y + 0.02, val * BAR_MAX, 0.25, {
            fill: val > 0.5 ? '#f44' : '#f4499', fillStyle: 'solid', stroke: 'none',
            roughness: 0.8, seed: i + 300,
          });
        }

        // Value
        ctx.fillStyle = "#fff";
        ctx.font = "0.17px monospace";
        ctx.fillText(val.toFixed(2), barX + val * BAR_MAX + 0.1, y + 0.22);
        ctx.font = "0.22px monospace";
      }
    }

    // Maybe-interesting blendshapes
    const maybeActive: { name: string; val: number }[] = [];
    for (const name of MAYBE_NAMES) {
      const val = latestBlendshapes.get(name) ?? 0;
      if (val > 0.05) maybeActive.push({ name, val });
    }
    maybeActive.sort((a, b) => b.val - a.val);

    if (maybeActive.length > 0) {
      const startY = 1.2 + active.length * 0.35 + 0.4;
      ctx.fillStyle = "#fa0";
      ctx.font = "bold 0.17px monospace";
      ctx.textAlign = "left";
      ctx.fillText("── MAYBE INTERESTING ──", 0.5, startY);

      ctx.font = "0.2px monospace";
      const LEFT = 0.5;
      const BAR_MAX = w * 0.4;

      for (let i = 0; i < maybeActive.length; i++) {
        const y = startY + 0.12 + i * 0.3;
        const { name, val } = maybeActive[i];

        ctx.fillStyle = "#ccc";
        ctx.textAlign = "left";
        ctx.fillText(name, LEFT, y + 0.2);

        const barX = LEFT + 3.0;
        rc.rectangle(barX, y + 0.02, BAR_MAX, 0.22, {
          fill: 'rgba(255,255,255,0.05)', fillStyle: 'solid', stroke: 'none',
          roughness: 0.3, seed: i + 400,
        });
        if (val * BAR_MAX > 0.01) {
          rc.rectangle(barX, y + 0.02, val * BAR_MAX, 0.22, {
            fill: '#fa088', fillStyle: 'solid', stroke: 'none',
            roughness: 0.8, seed: i + 500,
          });
        }

        ctx.fillStyle = "#ccc";
        ctx.font = "0.15px monospace";
        ctx.fillText(val.toFixed(2), barX + val * BAR_MAX + 0.1, y + 0.2);
        ctx.font = "0.2px monospace";
      }
    }

    // Show all blendshapes toggle
    if (showAll) {
      const all = Array.from(latestBlendshapes.entries())
        .filter(([name]) => !TENSION_SET.has(name) && !MAYBE_SET.has(name))
        .sort((a, b) => b[1] - a[1]);

      const maybeH = maybeActive.length > 0 ? maybeActive.length * 0.3 + 0.6 : 0;
      const startY = Math.max(1.2 + active.length * 0.35 + maybeH + 0.5, h * 0.45);
      ctx.fillStyle = "#fa0";
      ctx.font = "bold 0.17px monospace";
      ctx.textAlign = "left";
      ctx.fillText("── OTHER BLENDSHAPES ──", 0.5, startY);

      ctx.font = "0.15px monospace";
      const ROW_H = 0.22;
      const BAR_MAX = w * 0.3;

      for (let i = 0; i < all.length; i++) {
        const y = startY + 0.12 + i * ROW_H;
        if (y > h - 0.25) break;
        const [name, val] = all[i];

        ctx.fillStyle = val > 0.01 ? "#ccc" : "#555";
        ctx.textAlign = "right";
        ctx.fillText(name, 2.75, y + ROW_H * 0.7);

        rc.rectangle(2.85, y + 0.02, BAR_MAX, ROW_H - 0.05, {
          fill: 'rgba(255,255,255,0.05)', fillStyle: 'solid', stroke: 'none',
          roughness: 0.3, seed: i + 600,
        });
        if (val > 0.1) {
          rc.rectangle(2.85, y + 0.02, val * BAR_MAX, ROW_H - 0.05, {
            fill: '#fa066', fillStyle: 'solid', stroke: 'none',
            roughness: 0.8, seed: i + 700,
          });
        }
      }
    }

    // Hint
    ctx.fillStyle = "#555";
    ctx.font = "0.17px monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `[i] ${showAll ? "hide" : "show"} other blendshapes  |  ${latestBlendshapes.size} total`,
      0.5,
      h - 0.25
    );
  },
};

// Listen for 'i' key to toggle all blendshapes
document.addEventListener("keydown", (e) => {
  if (e.key === "i") {
    showAll = !showAll;
  }
});
