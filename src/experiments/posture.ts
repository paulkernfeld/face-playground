import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { sage, rose, honey, stone, cream, sky } from '../palette';

// Landmark 10 = top of forehead (stable under pitch changes, unlike nose tip)
const FOREHEAD = 10;

// Posture state
let calibrated = false;
let calibratingCountdown = 0;
const CALIBRATE_HOLD = 1.5;
let baselineForeheadY = 0;
let baselinePitch = 0;

// Current smoothed values
let smoothForeheadY = 4.5;
let smoothPitch = 0;
const SMOOTH = 0.85;

// Separate drift signals
const Y_THRESHOLD = 0.4;     // game units of forehead drop
const PITCH_THRESHOLD = 0.15; // radians of forward tilt
let yDriftNorm = 0;   // 0..1, how far head has sunk
let pitchDriftNorm = 0; // 0..1, how far head has tilted

// Audio — two oscillators at different pitches
let audioCtx: AudioContext | null = null;
let yGain: GainNode | null = null;
let pitchGain: GainNode | null = null;
let yOsc: OscillatorNode | null = null;
let pitchOsc: OscillatorNode | null = null;

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

  // Low tone for sinking/slouching
  yGain = audioCtx.createGain();
  yGain.gain.value = 0;
  yGain.connect(audioCtx.destination);
  yOsc = audioCtx.createOscillator();
  yOsc.type = "sine";
  yOsc.frequency.value = 240;
  yOsc.connect(yGain);
  yOsc.start();

  // Higher tone for forward tilt
  pitchGain = audioCtx.createGain();
  pitchGain.gain.value = 0;
  pitchGain.connect(audioCtx.destination);
  pitchOsc = audioCtx.createOscillator();
  pitchOsc.type = "sine";
  pitchOsc.frequency.value = 380;
  pitchOsc.connect(pitchGain);
  pitchOsc.start();
}

function stopAudio() {
  if (!audioCtx) return;
  yOsc?.stop();
  pitchOsc?.stop();
  audioCtx.close();
  audioCtx = null;
  yGain = null;
  pitchGain = null;
  yOsc = null;
  pitchOsc = null;
}

function setTones(yAmount: number, pitchAmount: number) {
  if (!audioCtx) return;
  const yTarget = yAmount > 0.3 ? 0.15 * yAmount : 0;
  const pTarget = pitchAmount > 0.3 ? 0.15 * pitchAmount : 0;
  yGain!.gain.setTargetAtTime(yTarget, audioCtx.currentTime, 0.3);
  pitchGain!.gain.setTargetAtTime(pTarget, audioCtx.currentTime, 0.3);
}

export const posture: Experiment = {
  name: "posture",

  setup(ctx, ww, hh) {
    w = ww;
    h = hh;
    calibrated = false;
    calibratingCountdown = 0;
    smoothForeheadY = h / 2;
    smoothPitch = 0;
    yDriftNorm = 0;
    pitchDriftNorm = 0;
    time = 0;
    rc = new GameRoughCanvas(ctx.canvas);
  },

  cleanup() {
    stopAudio();
  },

  update(face: FaceData | null, dt: number) {
    time += dt;

    if (!face) {
      setTones(0, 0);
      return;
    }

    ensureAudio();

    const foreheadY = face.landmarks[FOREHEAD].y;
    smoothForeheadY = smoothForeheadY * SMOOTH + foreheadY * (1 - SMOOTH);
    smoothPitch = smoothPitch * SMOOTH + face.headPitch * (1 - SMOOTH);

    if (!calibrated) {
      if (mouthOpen(face)) {
        calibratingCountdown += dt;
        if (calibratingCountdown >= CALIBRATE_HOLD) {
          baselineForeheadY = smoothForeheadY;
          baselinePitch = smoothPitch;
          calibrated = true;
          calibratingCountdown = 0;
        }
      } else {
        calibratingCountdown = Math.max(0, calibratingCountdown - dt * 2);
      }
      setTones(0, 0);
      return;
    }

    // Separate drift signals (only care about downward/forward)
    yDriftNorm = Math.min(1, Math.max(0, (smoothForeheadY - baselineForeheadY) / Y_THRESHOLD));
    pitchDriftNorm = Math.min(1, Math.max(0, (smoothPitch - baselinePitch) / PITCH_THRESHOLD));

    setTones(yDriftNorm, pitchDriftNorm);
  },

  demo() {
    calibrated = true;
    baselineForeheadY = 4.0;
    baselinePitch = 0;
    smoothForeheadY = 4.35;
    smoothPitch = 0.12;
    yDriftNorm = 0.45;
    pitchDriftNorm = 0.55;
    time = 3;
  },

  draw(ctx, _w, _h) {
    if (!calibrated) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2);

      pxText(ctx, "posture check", w / 2, h * 0.3, "600 0.5px Fredoka, sans-serif", cream, "center");
      pxText(ctx, "sit up straight, then", w / 2, h * 0.45, "0.25px Sora, sans-serif", stone, "center");
      pxText(ctx, "open your mouth", w / 2, h * 0.55, "600 0.28px Sora, sans-serif", honey, "center");
      pxText(ctx, "to set your baseline", w / 2, h * 0.65, "0.25px Sora, sans-serif", stone, "center");

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
        const alpha = 0.3 + 0.3 * pulse;
        pxText(ctx, "\u{1F62E}", w / 2, h * 0.78, `0.4px sans-serif`, `rgba(255,255,255,${alpha})`, "center");
      }
      return;
    }

    // --- Calibrated: side-view head comparison ---
    const cx = w / 2;
    const cy = h / 2;

    const headR = 0.8;
    const noseLen = 0.6;
    const neckLen = 0.7;
    // Amplify for visibility
    const visualYShift = (smoothForeheadY - baselineForeheadY) * 3;
    const visualPitchShift = (smoothPitch - baselinePitch) * 3;

    const drawHead = (hx: number, hy: number, angle: number, strokeColor: string, sw: number, seedBase: number) => {
      rc.circle(hx, hy, headR * 2, {
        stroke: strokeColor, strokeWidth: sw, fill: 'none', roughness: 1.0, seed: seedBase,
      });
      // Nose — facing left, pitch tilts it down
      const noseAngle = Math.PI - angle; // subtract so forward lean tilts nose down
      const nx = hx + Math.cos(noseAngle) * (headR + noseLen);
      const ny = hy + Math.sin(noseAngle) * (headR + noseLen);
      const nbaseX = hx + Math.cos(noseAngle) * headR * 0.7;
      const nbaseY = hy + Math.sin(noseAngle) * headR * 0.7;
      rc.line(nbaseX, nbaseY, nx, ny, {
        stroke: strokeColor, strokeWidth: sw, roughness: 0.8, seed: seedBase + 1,
      });
      // Neck
      const neckAngle = Math.PI / 2 + angle * 0.5;
      rc.line(hx, hy + headR, hx + Math.cos(neckAngle) * neckLen * 0.3, hy + headR + neckLen, {
        stroke: strokeColor, strokeWidth: sw, roughness: 0.8, seed: seedBase + 2,
      });
      // Eye
      const eyeAngle = Math.PI - angle - 0.4;
      const ex = hx + Math.cos(eyeAngle) * headR * 0.45;
      const ey = hy + Math.sin(eyeAngle) * headR * 0.45;
      rc.circle(ex, ey, 0.12, {
        fill: strokeColor, fillStyle: 'solid', stroke: 'none', roughness: 0.4, seed: seedBase + 3,
      });
    };

    // Baseline (ghost)
    drawHead(cx, cy, 0, stone, 0.025, 400);

    // Current (solid) — shifted down and tilted
    const yColor = yDriftNorm > 0.6 ? rose : (yDriftNorm > 0.3 ? honey : sage);
    const pColor = pitchDriftNorm > 0.6 ? rose : (pitchDriftNorm > 0.3 ? sky : sage);
    const mainColor = (yDriftNorm > pitchDriftNorm) ? yColor : pColor;
    drawHead(cx, cy + visualYShift, visualPitchShift, mainColor, 0.04, 420);

    // --- Status messages for each signal ---
    const msgY = yDriftNorm > 0.6 ? "sinking" : (yDriftNorm > 0.3 ? "slouching..." : "");
    const msgP = pitchDriftNorm > 0.6 ? "leaning forward" : (pitchDriftNorm > 0.3 ? "tilting..." : "");
    const bothGood = yDriftNorm < 0.3 && pitchDriftNorm < 0.3;

    if (bothGood) {
      pxText(ctx, "good posture", cx, cy - headR - 0.8, "600 0.35px Sora, sans-serif", sage, "center");
    } else {
      let ty = cy - headR - 0.8;
      if (msgY) {
        pxText(ctx, msgY, cx, ty, "600 0.28px Sora, sans-serif", yColor, "center");
        ty += 0.4;
      }
      if (msgP) {
        pxText(ctx, msgP, cx, ty, "600 0.28px Sora, sans-serif", pColor, "center");
      }
    }

    // Recalibrate hint
    pxText(ctx, "recalibrate: \u{1F62E}", cx, h - 0.5, "0.18px Sora, sans-serif", stone, "center");
  },
};
