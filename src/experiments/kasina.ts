import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { lavender, charcoal, stone, honey } from '../palette';

const CALIBRATE_TIME = 2.0;
const MOVE_THRESHOLD = 0.15;

const GAZE_SHAPES = [
  'eyeLookUpLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft',
  'eyeLookUpRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight',
] as const;

type Phase = 'calibrating' | 'active';

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
        phase = 'calibrating';
        calibrateTimer = 0;
        baseline = new Map();
        streak = 0;
        best = 0;
      },

      update(face: FaceData | null, dt: number) {
        if (!face) return;

        if (phase === 'calibrating') {
          calibrateTimer += dt;
          if (calibrateTimer >= CALIBRATE_TIME) {
            baseline = readGaze(face);
            phase = 'active';
            streak = 0;
          }
          return;
        }

        const current = readGaze(face);
        let moved = false;
        for (const name of GAZE_SHAPES) {
          const diff = Math.abs((current.get(name) ?? 0) - (baseline.get(name) ?? 0));
          if (diff > MOVE_THRESHOLD) {
            moved = true;
            break;
          }
        }

        if (moved) {
          if (streak > best) best = streak;
          phase = 'calibrating';
          calibrateTimer = 0;
          streak = 0;
        } else {
          streak += dt;
        }
      },

      draw(ctx: CanvasRenderingContext2D, gw: number, gh: number) {
        const cx = gw / 2;
        const cy = gh / 2;

        // fixation dot
        const dotColor = phase === 'calibrating' ? honey : lavender;
        rc.circle(cx, cy, 0.4, { fill: dotColor, fillStyle: 'solid', stroke: charcoal, strokeWidth: 0.02 });

        if (phase === 'calibrating') {
          const remaining = Math.max(0, CALIBRATE_TIME - calibrateTimer).toFixed(1);
          pxText(ctx, `look at the dot... ${remaining}s`, cx, cy + 1.2, '0.4px Fredoka', stone, 'center');
        } else {
          pxText(ctx, streak.toFixed(1) + 's', cx, cy - 1.2, '0.8px Fredoka', charcoal, 'center');
        }

        if (best > 0) {
          pxText(ctx, `best: ${best.toFixed(1)}s`, cx, gh - 0.5, '0.35px Fredoka', stone, 'center');
        }
      },

      demo() {
        phase = 'active';
        streak = 4.2;
        best = 7.8;
      },

      cleanup() {},
    };
  })(),
};
