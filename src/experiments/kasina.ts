import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { lavender, cream, stone, honey } from '../palette';

const CALIBRATE_TIME = 2.0;
const MOVE_THRESHOLD = 0.1;
const BLINK_THRESHOLD = 0.2;
const MAX_BLINK_TIME = 0.5;

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
    let keyHandler: ((e: KeyboardEvent) => void) | null = null;

    function startCalibration() {
      phase = 'calibrating';
      calibrateTimer = 0;
      blinkDuration = 0;
    }

    function resetStreak(reason: string) {
      if (streak > best) best = streak;
      lastResetReason = reason;
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
          if (blinkDuration > MAX_BLINK_TIME) {
            resetStreak('eyes closed too long');
          } else {
            streak += dt;
          }
          return;
        }
        blinkDuration = 0;

        const current = readGaze(face);
        let triggerName = '';
        for (const name of GAZE_SHAPES) {
          const diff = Math.abs((current.get(name) ?? 0) - (baseline.get(name) ?? 0));
          if (diff > MOVE_THRESHOLD) {
            triggerName = name;
            break;
          }
        }

        if (triggerName) {
          const val = current.get(triggerName) ?? 0;
          const base = baseline.get(triggerName) ?? 0;
          resetStreak(`${triggerName}: ${base.toFixed(3)} → ${val.toFixed(3)}`);
        } else {
          streak += dt;
        }
      },

      draw(ctx: CanvasRenderingContext2D, gw: number, gh: number) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, gw, gh);

        const cx = gw / 2;
        const cy = gh * 0.25;

        // fixation dot
        const dotColor = phase === 'calibrating' ? honey : lavender;
        rc.circle(cx, cy, 0.4, { fill: dotColor, fillStyle: 'solid', stroke: stone, strokeWidth: 0.02 });

        if (phase === 'waiting') {
          const msg = lastResetReason ? `${lastResetReason} — space to restart` : 'press space to start';
          pxText(ctx, msg, cx, cy + 1.2, '0.4px Fredoka', stone, 'center');
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
