import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { sage, rose, honey, stone, cream, lavender } from '../palette';

// Landmark indices
const NOSE_TIP = 1;

// Posture state
let calibrated = false;
let calibratingCountdown = 0; // seconds remaining in calibration hold
const CALIBRATE_HOLD = 1.5; // how long to hold the gesture
let baselineNoseY = 0;
let baselinePitch = 0;

// Current smoothed values
let smoothNoseY = 4.5;
let smoothPitch = 0;
const SMOOTH = 0.85;

// Drift detection
const DRIFT_THRESHOLD = 0.4; // game units of nose drop
const PITCH_THRESHOLD = 0.15; // radians of forward tilt
let driftAmount = 0; // 0..1, how far off posture is

// Audio
let audioCtx: AudioContext | null = null;
let toneActive = false;
let gainNode: GainNode | null = null;
let oscNode: OscillatorNode | null = null;

// Visual state
let w = 16;
let h = 9;
let rc: GameRoughCanvas;
let time = 0;

// Blendshape detection
function mouthOpen(face: FaceData): boolean {
  return (face.blendshapes.get("jawOpen") ?? 0) > 0.4;
}
function eyesClosed(face: FaceData): boolean {
  const l = face.blendshapes.get("eyeBlinkLeft") ?? 0;
  const r = face.blendshapes.get("eyeBlinkRight") ?? 0;
  return l > 0.4 && r > 0.4;
}

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(audioCtx.destination);
  oscNode = audioCtx.createOscillator();
  oscNode.type = "sine";
  oscNode.frequency.value = 320; // gentle mid-range tone
  oscNode.connect(gainNode);
  oscNode.start();
}

function setTone(on: boolean, intensity: number) {
  if (!audioCtx || !gainNode) return;
  const target = on ? 0.06 * intensity : 0;
  gainNode.gain.setTargetAtTime(target, audioCtx.currentTime, 0.3);
  toneActive = on;
}

export const posture: Experiment = {
  name: "posture",

  setup(ctx, ww, hh) {
    w = ww;
    h = hh;
    calibrated = false;
    calibratingCountdown = 0;
    smoothNoseY = h / 2;
    smoothPitch = 0;
    driftAmount = 0;
    time = 0;
    rc = new GameRoughCanvas(ctx.canvas);
    // Audio is created on first face detection (needs user gesture)
  },

  update(face: FaceData | null, dt: number) {
    time += dt;

    if (!face) {
      setTone(false, 0);
      return;
    }

    ensureAudio();

    const noseY = face.landmarks[NOSE_TIP].y;
    smoothNoseY = smoothNoseY * SMOOTH + noseY * (1 - SMOOTH);
    smoothPitch = smoothPitch * SMOOTH + face.headPitch * (1 - SMOOTH);

    if (!calibrated) {
      // Check for calibration gesture: mouth open + eyes closed
      if (mouthOpen(face) && eyesClosed(face)) {
        calibratingCountdown += dt;
        if (calibratingCountdown >= CALIBRATE_HOLD) {
          baselineNoseY = smoothNoseY;
          baselinePitch = smoothPitch;
          calibrated = true;
          calibratingCountdown = 0;
        }
      } else {
        calibratingCountdown = Math.max(0, calibratingCountdown - dt * 2);
      }
      setTone(false, 0);
      return;
    }

    // Measure drift from baseline
    const yDrift = (smoothNoseY - baselineNoseY) / DRIFT_THRESHOLD;
    const pitchDrift = (smoothPitch - baselinePitch) / PITCH_THRESHOLD;
    // Only care about downward/forward drift (positive values)
    const rawDrift = Math.max(0, Math.max(yDrift, pitchDrift));
    driftAmount = Math.min(1, rawDrift);

    if (driftAmount > 0.3) {
      setTone(true, driftAmount);
    } else {
      setTone(false, 0);
    }
  },

  demo() {
    calibrated = true;
    driftAmount = 0.15;
    smoothNoseY = 4.5;
    smoothPitch = 0;
    time = 3;
  },

  draw(ctx, _w, _h) {
    if (!calibrated) {
      // Calibration instructions
      const pulse = 0.5 + 0.5 * Math.sin(time * 2);

      pxText(ctx, "posture check", w / 2, h * 0.3, "600 0.5px Fredoka, sans-serif", cream, "center");
      pxText(ctx, "sit up straight, then", w / 2, h * 0.45, "0.25px Sora, sans-serif", stone, "center");
      pxText(ctx, "open mouth + close eyes", w / 2, h * 0.55, "600 0.28px Sora, sans-serif", honey, "center");
      pxText(ctx, "to set your baseline", w / 2, h * 0.65, "0.25px Sora, sans-serif", stone, "center");

      // Progress indicator
      if (calibratingCountdown > 0) {
        const progress = calibratingCountdown / CALIBRATE_HOLD;
        const barW = 3;
        const barH = 0.15;
        const bx = w / 2 - barW / 2;
        const by = h * 0.75;
        rc.rectangle(bx, by, barW, barH, {
          stroke: stone, strokeWidth: 0.02, roughness: 0.8, fill: 'none', seed: 200,
        });
        rc.rectangle(bx, by, barW * progress, barH, {
          fill: sage, fillStyle: 'solid', stroke: 'none', roughness: 0.5, seed: 201,
        });
      } else {
        // Gentle pulsing hint
        const alpha = 0.3 + 0.3 * pulse;
        pxText(ctx, "😮😑", w / 2, h * 0.78, `0.4px sans-serif`, `rgba(255,255,255,${alpha})`, "center");
      }
      return;
    }

    // Calibrated — show posture status
    const cx = w / 2;
    const cy = h / 2;

    // Status indicator — a gentle arc/circle
    const good = driftAmount < 0.3;
    const color = good ? sage : (driftAmount > 0.6 ? rose : honey);
    const radius = 1.2;

    // Outer ring
    rc.circle(cx, cy, radius * 2, {
      stroke: color, strokeWidth: 0.04, fill: 'none', roughness: 1.2, seed: 300,
    });

    // Inner fill based on goodness
    if (good) {
      rc.circle(cx, cy, 0.3, {
        fill: sage, fillStyle: 'solid', stroke: 'none', roughness: 0.6, seed: 301,
      });
    }

    // Drift meter — small arc showing how far off
    if (driftAmount > 0.05) {
      const meterY = cy + radius + 0.5;
      const meterW = 2.5;
      const meterH = 0.12;
      const mx = cx - meterW / 2;
      rc.rectangle(mx, meterY, meterW, meterH, {
        stroke: stone, strokeWidth: 0.015, roughness: 0.6, fill: 'none', seed: 310,
      });
      rc.rectangle(mx, meterY, meterW * driftAmount, meterH, {
        fill: color, fillStyle: 'solid', stroke: 'none', roughness: 0.4, seed: 311,
      });
    }

    // Status text
    const msg = good ? "good posture" : (driftAmount > 0.6 ? "sit up!" : "drifting...");
    pxText(ctx, msg, cx, cy - radius - 0.3, "600 0.3px Sora, sans-serif", color, "center");

    // Subtle breathing circle when posture is good
    if (good) {
      const breath = 0.8 + 0.2 * Math.sin(time * 0.8);
      rc.circle(cx, cy, radius * breath * 2, {
        stroke: `rgba(140, 192, 160, 0.2)`, strokeWidth: 0.02, fill: 'none', roughness: 1.5, seed: 320,
      });
    }

    // Recalibrate hint
    pxText(ctx, "recalibrate: 😮😑", cx, h - 0.5, "0.18px Sora, sans-serif", stone, "center");
  },
};
