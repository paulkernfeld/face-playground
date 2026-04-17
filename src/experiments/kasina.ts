import type { Experiment, FaceData, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { lavender, cream, stone, honey, rose } from '../palette';

const CALIBRATE_TIME = 2.0;
const MOVE_THRESHOLD = 0.1;
const BLINK_THRESHOLD = 0.2;
const MAX_BLINK_TIME = 0.5;
const POST_BLINK_GRACE = 0.25;
const MOVE_GRACE = 0.25;

const GAZE_SHAPES = [
  'eyeLookUpLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft',
  'eyeLookUpRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight',
] as const;

type Phase = 'waiting' | 'calibrating' | 'active';

export const kasina: Experiment = {
  name: "kasina",

  ...(() => {
    let phase: Phase;
    let calibrateTimer: number;
    let baseline: Map<string, number>;
    let streak: number;
    let best: number;
    let w: number;
    let h: number;
    let rc: GameRoughCanvas;
    let blinkDuration: number;
    let lastResetReason: string;
    let isBlinking: boolean;
    let postBlinkTimer: number;
    let moveDuration: number;
    let moveOffender: string;
    let loseSnapshot: HTMLCanvasElement | null;
    let loseLandmarks: Landmarks | null;
    let lastLandmarks: Landmarks | null;
    let keyHandler: ((e: KeyboardEvent) => void) | null = null;

    function captureVideo(): HTMLCanvasElement | null {
      const video = document.getElementById('webcam') as HTMLVideoElement | null;
      if (!video || video.readyState < 2) return null;
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d')!.drawImage(video, 0, 0);
      return c;
    }

    function startCalibration() {
      phase = 'calibrating';
      calibrateTimer = 0;
      blinkDuration = 0;
    }

    function resetStreak(reason: string) {
      if (streak > best) best = streak;
      lastResetReason = reason;
      loseSnapshot = captureVideo();
      loseLandmarks = lastLandmarks;
      phase = 'waiting';
      streak = 0;
      blinkDuration = 0;
    }

    function readGaze(face: FaceData): Map<string, number> {
      const m = new Map<string, number>();
      for (const name of GAZE_SHAPES) {
        m.set(name, face.blendshapes.get(name) ?? 0);
      }
      return m;
    }

    return {
      setup(ctx: CanvasRenderingContext2D, gw: number, gh: number) {
        w = gw;
        h = gh;
        rc = new GameRoughCanvas(ctx.canvas);
        phase = 'waiting';
        calibrateTimer = 0;
        baseline = new Map();
        streak = 0;
        best = 0;
        blinkDuration = 0;
        lastResetReason = '';
        isBlinking = false;
        postBlinkTimer = 0;
        moveDuration = 0;
        moveOffender = '';
        loseSnapshot = null;
        loseLandmarks = null;
        lastLandmarks = null;

        if (keyHandler) document.removeEventListener('keydown', keyHandler);
        keyHandler = (e: KeyboardEvent) => {
          if (e.code === 'Space' && phase === 'waiting') {
            e.preventDefault();
            startCalibration();
          }
        };
        document.addEventListener('keydown', keyHandler);
      },

      update(face: FaceData | null, dt: number) {
        if (phase === 'waiting') return;

        if (!face) {
          if (phase === 'active') resetStreak('no face detected');
          return;
        }

        lastLandmarks = face.landmarks;

        const blinkL = face.blendshapes.get("eyeBlinkLeft") ?? 0;
        const blinkR = face.blendshapes.get("eyeBlinkRight") ?? 0;
        const blinking = blinkL > BLINK_THRESHOLD || blinkR > BLINK_THRESHOLD;
        isBlinking = blinking;

        if (phase === 'calibrating') {
          calibrateTimer += dt;
          if (calibrateTimer >= CALIBRATE_TIME) {
            baseline = readGaze(face);
            phase = 'active';
            streak = 0;
          }
          return;
        }

        if (blinking) {
          blinkDuration += dt;
          postBlinkTimer = POST_BLINK_GRACE;
          if (blinkDuration > MAX_BLINK_TIME) {
            resetStreak('eyes closed too long');
          } else {
            streak += dt;
          }
          return;
        }
        blinkDuration = 0;

        if (postBlinkTimer > 0) {
          postBlinkTimer -= dt;
          streak += dt;
          return;
        }

        const current = readGaze(face);
        let outOfBounds = false;
        let offender = '';
        for (const name of GAZE_SHAPES) {
          const diff = Math.abs((current.get(name) ?? 0) - (baseline.get(name) ?? 0));
          if (diff > MOVE_THRESHOLD) {
            outOfBounds = true;
            offender = name;
            break;
          }
        }

        if (outOfBounds) {
          moveOffender = offender;
          moveDuration += dt;
          if (moveDuration >= MOVE_GRACE) {
            const val = current.get(moveOffender) ?? 0;
            const base = baseline.get(moveOffender) ?? 0;
            resetStreak(`${moveOffender}: ${base.toFixed(3)} → ${val.toFixed(3)}`);
          } else {
            streak += dt;
          }
        } else {
          moveDuration = 0;
          moveOffender = '';
          streak += dt;
        }
      },

      draw(ctx: CanvasRenderingContext2D, gw: number, gh: number, debug?: boolean) {
        if (!debug) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, gw, gh);
        }

        const cx = gw / 2;
        const cy = gh * 0.25;

        // fixation dot
        const dotColor = phase === 'calibrating' ? honey : lavender;
        rc.circle(cx, cy, 0.4, { fill: dotColor, fillStyle: 'solid', stroke: stone, strokeWidth: 0.02 });

        if (phase === 'waiting') {
          const msg = lastResetReason ? `${lastResetReason} — space to restart` : 'press space to start';
          pxText(ctx, msg, cx, cy + 1.2, '0.4px Fredoka', stone, 'center');
          if (loseSnapshot) {
            const snapW = 4;
            const snapH = snapW * (loseSnapshot.height / loseSnapshot.width);
            const snapX = cx - snapW / 2;
            const snapY = cy + 2;
            ctx.drawImage(loseSnapshot, snapX, snapY, snapW, snapH);

            if (loseLandmarks) {
              for (let i = 0; i < loseLandmarks.length; i++) {
                const lm = loseLandmarks[i];
                const x = snapX + lm.x * snapW;
                const y = snapY + lm.y * snapH;
                const isIris = i >= 468 && i <= 477;
                ctx.fillStyle = isIris ? rose : stone;
                const r = isIris ? 0.04 : 0.015;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        } else if (phase === 'calibrating') {
          const remaining = Math.ceil(Math.max(0, CALIBRATE_TIME - calibrateTimer));
          pxText(ctx, `look at the dot... ${remaining}s`, cx, cy + 1.2, '0.4px Fredoka', stone, 'center');
        } else if (isBlinking) {
          pxText(ctx, 'open your eyes', cx, cy - 1.2, '0.8px Fredoka', cream, 'center');
        } else {
          pxText(ctx, Math.floor(streak) + 's', cx, cy - 1.2, '0.8px Fredoka', cream, 'center');
          if (best > 0) {
            pxText(ctx, `best: ${Math.floor(best)}s`, cx, cy + 1.2, '0.35px Fredoka', stone, 'center');
          }
        }
      },

      extraButtons: [
        { label: 'start', key: ' ', onClick: () => { if (phase === 'waiting') startCalibration(); } },
      ],

      demo() {
        phase = 'active';
        streak = 4;
        best = 7;
      },

      cleanup() {
        if (keyHandler) {
          document.removeEventListener('keydown', keyHandler);
          keyHandler = null;
        }
      },
    };
  })(),
};
