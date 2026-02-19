import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { sage, rose, honey, stone, charcoal, sky } from '../palette';

// Posture state
let calibrated = false;
let calibratingCountdown = 0;
const CALIBRATE_HOLD = 1.5;
let baselineMatY = 0;   // rawTransformMatrix[13] baseline
let baselinePitch = 0;

// Current smoothed values
let smoothMatX = 0;      // smoothed m[12] from transform matrix
let smoothMatY = 0;      // smoothed m[13]
let smoothMatZ = 0;      // smoothed m[14]
let smoothPitch = 0;
const SMOOTH = 0.85;

// Separate drift signals
// m[13] is in cm-ish units; ~3cm of head drop = full slouch
const Y_THRESHOLD = 3.0;
const PITCH_DEADZONE = 0.17; // ~10° of pitch ignored before drift starts
const PITCH_THRESHOLD = 0.15; // radians of forward tilt beyond dead zone
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
    smoothMatX = 0;
    smoothMatY = 0;
    smoothMatZ = 0;
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

    // Track all three translation components from the transformation matrix
    const m = face.rawTransformMatrix;
    const matX = m ? m[12] : 0;
    const matY = m ? m[13] : 0;
    const matZ = m ? m[14] : 0;
    smoothMatX = smoothMatX * SMOOTH + matX * (1 - SMOOTH);
    smoothMatY = smoothMatY * SMOOTH + matY * (1 - SMOOTH);
    smoothMatZ = smoothMatZ * SMOOTH + matZ * (1 - SMOOTH);
    smoothPitch = smoothPitch * SMOOTH + face.headPitch * (1 - SMOOTH);

    if (!calibrated) {
      if (mouthOpen(face)) {
        calibratingCountdown += dt;
        if (calibratingCountdown >= CALIBRATE_HOLD) {
          baselineMatY = smoothMatY;
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

    // Separate drift signals
    // m[13] decreases as head sinks in camera space, so negative delta = slouching
    yDriftNorm = Math.min(1, Math.max(0, (baselineMatY - smoothMatY) / Y_THRESHOLD));
    const rawPitchDrift = smoothPitch - baselinePitch - PITCH_DEADZONE;
    pitchDriftNorm = Math.min(1, Math.max(0, rawPitchDrift / PITCH_THRESHOLD));

    setTones(yDriftNorm, pitchDriftNorm);
  },

  demo() {
    calibrated = true;
    baselineMatY = 0;
    baselinePitch = 0;
    smoothMatY = 1.35;  // ~45% of Y_THRESHOLD
    smoothPitch = 0.12;
    yDriftNorm = 0.45;
    pitchDriftNorm = 0.55;
    time = 3;
  },

  draw(ctx, _w, _h, debug) {
    if (!calibrated) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2);

      pxText(ctx, "posture check", w / 2, h * 0.3, "600 0.5px Fredoka, sans-serif", charcoal, "center");
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
    // Amplify for visibility — scale matrix Y delta into game units
    const visualYShift = ((baselineMatY - smoothMatY) / Y_THRESHOLD) * 1.5;
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

    // Debug overlay: transform matrix translation (toggle with 'v' key)
    if (debug) {
      pxText(ctx, `x: ${smoothMatX.toFixed(1)}`, 0.3, 0.4, "0.2px Sora, sans-serif", stone, "left");
      pxText(ctx, `y: ${smoothMatY.toFixed(1)}`, 0.3, 0.7, "0.2px Sora, sans-serif", stone, "left");
      pxText(ctx, `z: ${smoothMatZ.toFixed(1)}`, 0.3, 1.0, "0.2px Sora, sans-serif", stone, "left");
      pxText(ctx, `p: ${(smoothPitch * 180 / Math.PI).toFixed(0)}°`, 0.3, 1.3, "0.2px Sora, sans-serif", stone, "left");
    }

    // Recalibrate hint
    pxText(ctx, "recalibrate: \u{1F62E}", cx, h - 0.5, "0.18px Sora, sans-serif", stone, "center");
  },
};
