import type { Experiment, FaceData, Blendshapes } from "../types";

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

const TENSION_SET = new Set(TENSION_NAMES);

let latestBlendshapes: Blendshapes = new Map();
let showAll = false;

export const blendshapeDebug: Experiment = {
  name: "tension",

  setup() {
    latestBlendshapes = new Map();
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
      const threshold = name.startsWith("eyeSquint") ? 0.2 : name.startsWith("mouthStretch") ? 0.05 : 0.1;
      if (val > threshold) {
        active.push({ name, val });
      }
    }
    active.sort((a, b) => b.val - a.val);

    const tense = active.length > 0;

    // Big tense/relaxed indicator
    ctx.font = "bold 48px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = tense ? "#f44" : "#0f0";
    ctx.fillText(tense ? "TENSE" : "RELAXED", w / 2, 60);

    // Active tension blendshapes
    if (active.length > 0) {
      ctx.font = "18px monospace";
      ctx.textAlign = "left";
      const LEFT = 40;
      const BAR_MAX = w * 0.4;

      for (let i = 0; i < active.length; i++) {
        const y = 100 + i * 28;
        const { name, val } = active[i];

        // Label
        ctx.fillStyle = "#fff";
        ctx.fillText(name, LEFT, y + 18);

        // Bar
        const barX = LEFT + 240;
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(barX, y + 2, BAR_MAX, 20);
        ctx.fillStyle = val > 0.5 ? "#f44" : "#f44" + "99";
        ctx.fillRect(barX, y + 2, val * BAR_MAX, 20);

        // Value
        ctx.fillStyle = "#fff";
        ctx.font = "14px monospace";
        ctx.fillText(val.toFixed(2), barX + val * BAR_MAX + 8, y + 18);
        ctx.font = "18px monospace";
      }
    }

    // Show all blendshapes toggle
    if (showAll) {
      const all = Array.from(latestBlendshapes.entries())
        .filter(([name]) => !TENSION_SET.has(name))
        .sort((a, b) => b[1] - a[1]);

      const startY = Math.max(100 + active.length * 28 + 40, h * 0.45);
      ctx.fillStyle = "#fa0";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "left";
      ctx.fillText("── OTHER BLENDSHAPES ──", 40, startY);

      ctx.font = "12px monospace";
      const ROW_H = 18;
      const BAR_MAX = w * 0.3;

      for (let i = 0; i < all.length; i++) {
        const y = startY + 10 + i * ROW_H;
        if (y > h - 20) break;
        const [name, val] = all[i];

        ctx.fillStyle = val > 0.01 ? "#ccc" : "#555";
        ctx.textAlign = "right";
        ctx.fillText(name, 220, y + ROW_H * 0.7);

        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(228, y + 2, BAR_MAX, ROW_H - 4);
        if (val > 0.1) {
          ctx.fillStyle = "#fa0" + "66";
          ctx.fillRect(228, y + 2, val * BAR_MAX, ROW_H - 4);
        }
      }
    }

    // Hint
    ctx.fillStyle = "#555";
    ctx.font = "14px monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `[i] ${showAll ? "hide" : "show"} other blendshapes  |  ${latestBlendshapes.size} total`,
      40,
      h - 20
    );
  },
};

// Listen for 'i' key to toggle all blendshapes
document.addEventListener("keydown", (e) => {
  if (e.key === "i") {
    showAll = !showAll;
  }
});
