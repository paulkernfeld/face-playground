import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { sage, rose, honey, stone, charcoal, lavender, sky, teal } from '../palette';

// Constants
const NOSE_TIP = 1;
const EYES_CLOSED_THRESHOLD = 0.5;
const STILLNESS_THRESHOLD = 0.015; // below this = perfectly still, no decay
const DECAY_SCALE = 40; // multiplier: decay per second = (noseDelta - threshold) * scale
const EYES_OPEN_DECAY = 3; // seconds of progress lost per second with eyes open
const SMOOTH = 0.8;

// Read ?duration=N from URL, default 10
const TARGET_DURATION = (() => {
  const p = new URLSearchParams(window.location.search).get('duration');
  return p ? Math.max(1, Number(p)) : 10;
})();

// State type for phase tracking
type Phase = 'waiting' | 'active' | 'complete';

export const mindfulness: Experiment = {
  name: "mindfulness",

  // All mutable state lives here, initialized in setup()
  // We use closure vars set in setup() to avoid module-level mutables
  ...(() => {
    // State variables
    let phase: Phase;
    let eyesClosed: boolean;
    let isStill: boolean;
    let closedStillTime: number;
    let lastNoseX: number;
    let lastNoseY: number;
    let smoothNoseX: number;
    let smoothNoseY: number;
    let noseDelta: number;
    let blinkL: number;
    let blinkR: number;
    let time: number;
    let w: number;
    let h: number;
    let rc: GameRoughCanvas;
    let hasHadFace: boolean;
    let breathPhase: number; // 0..1 cycling for breathing animation
    let peakTime: number; // best session time
    let interruptReason: string; // why the session was interrupted
    let prevPhase: Phase; // track phase transitions for audio

    // Audio state — continuous drone while eyes closed + still
    let audioCtx: AudioContext | null = null;
    let droneOsc: OscillatorNode | null = null;
    let droneGain: GainNode | null = null;
    const DRONE_FREQ = 220; // Hz — low, gentle hum
    const DRONE_VOLUME = 0.06;

    function getAudioCtx(): AudioContext | null {
      if (!audioCtx) {
        try {
          audioCtx = new AudioContext();
        } catch {
          return null;
        }
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    }

    function startDrone() {
      const ctx = getAudioCtx();
      if (!ctx || droneOsc) return;
      droneOsc = ctx.createOscillator();
      droneGain = ctx.createGain();
      droneOsc.type = 'sine';
      droneOsc.frequency.value = DRONE_FREQ;
      droneGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      droneGain.gain.exponentialRampToValueAtTime(DRONE_VOLUME, ctx.currentTime + 0.3);
      droneOsc.connect(droneGain);
      droneGain.connect(ctx.destination);
      droneOsc.start();
    }

    function stopDrone() {
      if (!droneGain || !droneOsc || !audioCtx) return;
      const t = audioCtx.currentTime;
      droneGain.gain.cancelScheduledValues(t);
      droneGain.gain.setValueAtTime(droneGain.gain.value, t);
      droneGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      const osc = droneOsc;
      setTimeout(() => { try { osc.stop(); } catch {} }, 300);
      droneOsc = null;
      droneGain = null;
    }

    function playCompleteTone() {
      stopDrone();
      const ctx = getAudioCtx();
      if (!ctx) return;
      const t = ctx.currentTime;
      for (const freq of [660, 880]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.1);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.8);
      }
    }

    function reset() {
      phase = 'waiting';
      prevPhase = 'waiting';
      eyesClosed = false;
      isStill = true;
      closedStillTime = 0;
      lastNoseX = 8;
      lastNoseY = 4.5;
      smoothNoseX = 8;
      smoothNoseY = 4.5;
      noseDelta = 0;
      blinkL = 0;
      blinkR = 0;
      time = 0;
      hasHadFace = false;
      breathPhase = 0;
      peakTime = 0;
      interruptReason = '';
    }

    return {
      extraButtons: [
        { label: 'restart', key: 'r', onClick: () => { reset(); hasHadFace = true; } },
      ],

      setup(ctx: CanvasRenderingContext2D, ww: number, hh: number) {
        w = ww;
        h = hh;
        rc = new GameRoughCanvas(ctx.canvas);
        reset();
      },

      update(face: FaceData | null, dt: number) {
        time += dt;

        // Expose phase for CLI gate / tests (before early returns)
        (window as any).__mindfulnessPhase = phase;

        // Breathing animation always advances (slow cycle: ~4s inhale, ~4s exhale)
        breathPhase = (breathPhase + dt / 8) % 1;

        // No face detected for full duration → auto-complete (away doing a chore, dark room)
        if (!hasHadFace && time >= TARGET_DURATION) {
          phase = 'complete';
          return;
        }

        if (!face) {
          // No face detected — pause but don't reset if we were active
          if (phase === 'active') {
            interruptReason = 'face lost';
            // Give a short grace period before resetting
          }
          return;
        }

        hasHadFace = true;

        // Read blendshapes
        blinkL = face.blendshapes.get("eyeBlinkLeft") ?? 0;
        blinkR = face.blendshapes.get("eyeBlinkRight") ?? 0;
        eyesClosed = blinkL > EYES_CLOSED_THRESHOLD && blinkR > EYES_CLOSED_THRESHOLD;

        // Track nose position for stillness
        const nose = face.landmarks[NOSE_TIP];
        const noseX = nose.x;
        const noseY = nose.y;
        smoothNoseX = smoothNoseX * SMOOTH + noseX * (1 - SMOOTH);
        smoothNoseY = smoothNoseY * SMOOTH + noseY * (1 - SMOOTH);

        const dx = smoothNoseX - lastNoseX;
        const dy = smoothNoseY - lastNoseY;
        noseDelta = Math.sqrt(dx * dx + dy * dy);
        isStill = noseDelta < STILLNESS_THRESHOLD;

        lastNoseX = smoothNoseX;
        lastNoseY = smoothNoseY;

        // Phase logic
        if (phase === 'complete') {
          // Locked — don't auto-reset. Only reset() via restart button/key.
          return;
        }

        // Eyes must close to leave waiting phase
        if (!eyesClosed && phase === 'waiting') {
          return;
        }
        phase = 'active';
        interruptReason = '';

        if (eyesClosed && isStill) {
          closedStillTime += dt;
        } else if (!eyesClosed) {
          // Eyes open — decay progress
          closedStillTime = Math.max(0, closedStillTime - EYES_OPEN_DECAY * dt);
        } else {
          // Eyes closed but moving — partial progress with motion decay
          const excess = noseDelta - STILLNESS_THRESHOLD;
          const decay = excess * DECAY_SCALE * dt;
          closedStillTime = Math.max(0, closedStillTime + dt - decay);
        }

        if (closedStillTime > peakTime) {
          peakTime = closedStillTime;
        }

        if (closedStillTime >= TARGET_DURATION) {
          phase = 'complete';
        }

        // Audio: drone while making progress, stop when progress drops
        if (phase === 'active' && closedStillTime > 0.5) {
          startDrone();
        } else if (closedStillTime < 0.3) {
          stopDrone();
        }
        if (phase === 'complete' && prevPhase !== 'complete') {
          playCompleteTone();
        }
        prevPhase = phase;
      },

      draw(ctx: CanvasRenderingContext2D, _w: number, _h: number) {
        const cx = w / 2;
        const cy = h / 2;

        // Breathing circle — always visible, serves as a focus/ambient element
        // Smooth sine-based breathing: expands on inhale, contracts on exhale
        const breathT = Math.sin(breathPhase * Math.PI * 2) * 0.5 + 0.5; // 0..1
        const baseRadius = 1.2;
        const breathRadius = baseRadius + breathT * 0.6;

        if (phase === 'complete') {
          // Success state — warm, expanded circle
          rc.circle(cx, cy, breathRadius * 2.5, {
            stroke: sage, strokeWidth: 0.04, fill: 'none',
            roughness: 0.6, seed: 10,
          });
          rc.circle(cx, cy, breathRadius * 1.5, {
            stroke: sage, strokeWidth: 0.03, fill: 'none',
            roughness: 0.8, seed: 11,
          });
          rc.circle(cx, cy, breathRadius * 0.7, {
            fill: sage, fillStyle: 'solid', stroke: 'none',
            roughness: 0.5, seed: 12,
          });

          pxText(ctx, `${TARGET_DURATION}s`, cx, cy - 2.2,
            "600 0.6px Fredoka, sans-serif", sage, "center");
          pxText(ctx, "well done", cx, cy + 2.5,
            "600 0.35px Sora, sans-serif", charcoal, "center");

          // Show best time
          if (peakTime > 0.5) {
            pxText(ctx, `best: ${peakTime.toFixed(1)}s`, cx, cy + 3.1,
              "0.2px Sora, sans-serif", stone, "center");
          }

          pxText(ctx, "press restart to try again", cx, cy + 3.6,
            "0.18px Sora, sans-serif", stone, "center");
          return;
        }

        if (phase === 'active') {
          // Active meditation — circle breathes, progress shown
          const progress = closedStillTime / TARGET_DURATION;

          // Outer progress ring (partial arc)
          // Guard: rough.js arc hangs when sweep is near-zero under the full
          // game-loop context (FaceMesh + canvas transforms + rough.js).
          // Can't reproduce standalone — requires resource pressure of the
          // full loop. Removing this guard causes deterministic loop stall.
          if (progress > 0.01) {
            const arcEnd = -Math.PI / 2 + progress * Math.PI * 2;
            rc.arc(cx, cy, 4.0, 4.0, -Math.PI / 2, arcEnd, false, {
              stroke: lavender, strokeWidth: 0.04, roughness: 0.5, seed: 20,
            });
          }

          // Breathing circle — gets more vivid as session progresses
          const circleColor = progress > 0.7 ? sage : (progress > 0.3 ? sky : lavender);
          rc.circle(cx, cy, breathRadius * 2, {
            stroke: circleColor, strokeWidth: 0.035, fill: 'none',
            roughness: 0.7, seed: 21,
          });
          rc.circle(cx, cy, breathRadius * 0.8, {
            fill: circleColor, fillStyle: 'solid', stroke: 'none',
            roughness: 0.4, seed: 22,
          });

          // Time display
          const secs = Math.floor(closedStillTime);
          pxText(ctx, `${secs}s`, cx, cy - 2.5,
            "600 0.5px Fredoka, sans-serif", charcoal, "center");

          // Gentle encouragement
          const msg = progress > 0.7 ? "almost there..." :
                      progress > 0.4 ? "steady..." :
                      "breathe...";
          pxText(ctx, msg, cx, cy + 2.8,
            "0.25px Sora, sans-serif", stone, "center");
          return;
        }

        // Waiting phase — instructions and status
        const breathColor = hasHadFace ? teal : stone;
        rc.circle(cx, cy, breathRadius * 2, {
          stroke: breathColor, strokeWidth: 0.03, fill: 'none',
          roughness: 0.9, seed: 30,
        });
        rc.circle(cx, cy, breathRadius * 0.6, {
          fill: breathColor, fillStyle: 'solid', stroke: 'none',
          roughness: 0.5, seed: 31,
        });

        pxText(ctx, "mindfulness", cx, cy - 2.5,
          "600 0.5px Fredoka, sans-serif", charcoal, "center");

        if (!hasHadFace) {
          pxText(ctx, "waiting for face...", cx, cy + 2.0,
            "0.25px Sora, sans-serif", stone, "center");
        } else {
          pxText(ctx, "close your eyes", cx, cy + 1.8,
            "600 0.28px Sora, sans-serif", honey, "center");
          pxText(ctx, "and stay still", cx, cy + 2.3,
            "600 0.28px Sora, sans-serif", honey, "center");
          pxText(ctx, `for ${TARGET_DURATION} seconds`, cx, cy + 2.8,
            "0.22px Sora, sans-serif", stone, "center");

          // Show status indicators (keep above button bar at bottom)
          const eyeLabel = eyesClosed ? "eyes: closed" : "eyes: open";
          const eyeColor = eyesClosed ? sage : rose;
          pxText(ctx, eyeLabel, cx, cy + 3.2,
            "0.2px Sora, sans-serif", eyeColor, "center");

          const stillLabel = isStill ? "body: still" : "body: moving";
          const stillColor = isStill ? sage : rose;
          pxText(ctx, stillLabel, cx, cy + 3.55,
            "0.2px Sora, sans-serif", stillColor, "center");

          // Show interrupt reason if recently interrupted
          if (interruptReason) {
            pxText(ctx, interruptReason, cx, cy - 1.7,
              "0.22px Sora, sans-serif", rose, "center");
          }

          // Show best time if they've had a session
          if (peakTime > 0.5) {
            pxText(ctx, `best: ${peakTime.toFixed(1)}s`, cx, h - 1.3,
              "0.18px Sora, sans-serif", stone, "center");
          }
        }
      },

      demo() {
        // Show mid-session state: 5 seconds in, eyes closed, still
        phase = 'active';
        prevPhase = 'active';
        eyesClosed = true;
        isStill = true;
        closedStillTime = 5.0;
        hasHadFace = true;
        breathPhase = 0.3;
        peakTime = 5.0;
        interruptReason = '';
        time = 8;
      },

      cleanup() {
        stopDrone();
        if (audioCtx) {
          audioCtx.close();
          audioCtx = null;
        }
      },
    };
  })(),
};
