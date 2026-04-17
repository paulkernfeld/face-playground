import type { Experiment, FaceData, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { lavender, cream, stone, honey, rose, teal } from '../palette';

const CALIBRATE_TIME = 2.0;
const MOVE_THRESHOLD = 0.2;
const BLINK_THRESHOLD = 0.2;
const MAX_BLINK_TIME = 0.5;
const POST_BLINK_GRACE = 0.25;
const MOVE_GRACE = 0.25;

// main.ts remaps landmarks with 5% margin crop — reverse it to get raw video coords
const MARGIN = 0.05;
function toRawVideo(gameVal: number, gameSize: number, videoSize: number): number {
  const normalized = gameVal / gameSize; // 0..1 in remapped space
  const raw = normalized * (1 - 2 * MARGIN) + MARGIN; // 0..1 in raw video space
  return raw * videoSize;
}

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
    let rc: GameRoughCanvas;
    let blinkDuration: number;
    let lastResetReason: string;
    let isBlinking: boolean;
    let postBlinkTimer: number;
    let moveDuration: number;
    let moveOffender: string;
    let calibSnapshot: HTMLCanvasElement | null;
    let calibLandmarks: Landmarks | null;
    let calibGaze: Map<string, number>;
    let loseSnapshot: HTMLCanvasElement | null;
    let loseLandmarks: Landmarks | null;
    let loseGaze: Map<string, number>;
    let lastLandmarks: Landmarks | null;
    let lastGaze: Map<string, number>;
    let hasFace: boolean;
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
      loseGaze = lastGaze;
      phase = 'waiting';
      streak = 0;
      blinkDuration = 0;
    }

    // landmarks are in game units (0..GAME_W, 0..GAME_H)
    // For snapshot: map game coords into snapshot rect (ox,oy,sw,sh) via (gw,gh)
    // For debug: draw directly in game coords (ox=0,oy=0,sw=gw,sh=gh)
    function drawLandmarks(ctx: CanvasRenderingContext2D, landmarks: Landmarks, ox: number, oy: number, sw: number, sh: number, gw: number, gh: number, mirror: boolean) {
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const nx = lm.x / gw;
        const ny = lm.y / gh;
        const x = ox + (mirror ? (1 - nx) : nx) * sw;
        const y = oy + ny * sh;
        const isIris = i >= 468 && i <= 477;
        ctx.fillStyle = isIris ? rose : stone;
        const r = isIris ? 0.04 : 0.015;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const EYE_INDICES = [33, 263, 159, 145, 386, 374];

    // Per-eye gaze blendshape → direction landmark mapping
    // Each entry: [blendshape name, eye center landmark, direction landmark]
    const GAZE_DIRS: [string, number, number][] = [
      ['eyeLookUpLeft', 468, 159],     // left eye up
      ['eyeLookDownLeft', 468, 145],   // left eye down
      ['eyeLookInLeft', 468, 133],     // left eye in (toward nose)
      ['eyeLookOutLeft', 468, 33],     // left eye out
      ['eyeLookUpRight', 473, 386],    // right eye up
      ['eyeLookDownRight', 473, 374],  // right eye down
      ['eyeLookInRight', 473, 362],    // right eye in (toward nose)
      ['eyeLookOutRight', 473, 263],   // right eye out
    ];

    function drawEyeCrop(ctx: CanvasRenderingContext2D, snapshot: HTMLCanvasElement, landmarks: Landmarks, drawX: number, drawY: number, drawW: number, gw: number, gh: number, gaze?: Map<string, number>) {
      const eyePts = EYE_INDICES.map(i => landmarks[i]);
      const minX = Math.min(...eyePts.map(p => p.x));
      const maxX = Math.max(...eyePts.map(p => p.x));
      const minY = Math.min(...eyePts.map(p => p.y));
      const maxY = Math.max(...eyePts.map(p => p.y));
      const eyeH = maxY - minY;
      const padX = eyeH * 0.3;
      const padY = eyeH * 0.5;

      const sx = Math.max(0, toRawVideo(minX - padX, gw, snapshot.width));
      const sy = Math.max(0, toRawVideo(minY - padY, gh, snapshot.height));
      const sx2 = Math.min(snapshot.width, toRawVideo(maxX + padX, gw, snapshot.width));
      const sy2 = Math.min(snapshot.height, toRawVideo(maxY + padY, gh, snapshot.height));
      const sw = sx2 - sx;
      const sh = sy2 - sy;
      const drawH = drawW * (sh / sw);

      ctx.drawImage(snapshot, sx, sy, sw, sh, drawX, drawY, drawW, drawH);

      const cropMinX = Math.max(0, minX - padX);
      const cropMinY = Math.max(0, minY - padY);
      const cropW = (maxX - minX) + padX * 2;
      const cropH = (maxY - minY) + padY * 2;
      // Gaze direction dots (teal, drawn under iris dots)
      if (gaze) {
        for (const [name, centerIdx, dirIdx] of GAZE_DIRS) {
          const val = gaze.get(name) ?? 0;
          if (val < 0.01) continue;
          const center = landmarks[centerIdx];
          const dir = landmarks[dirIdx];
          const lx = center.x + (dir.x - center.x) * val;
          const ly = center.y + (dir.y - center.y) * val;
          const nx = (lx - cropMinX) / cropW;
          const ny = (ly - cropMinY) / cropH;
          if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
          ctx.fillStyle = teal;
          ctx.beginPath();
          ctx.arc(drawX + nx * drawW, drawY + ny * drawH, 0.03, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Landmark dots (iris in rose, rest in stone)
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const nx = (lm.x - cropMinX) / cropW;
        const ny = (lm.y - cropMinY) / cropH;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        const isIris = i >= 468 && i <= 477;
        ctx.fillStyle = isIris ? rose : stone;
        const r = isIris ? 0.03 : 0.015;
        ctx.beginPath();
        ctx.arc(drawX + nx * drawW, drawY + ny * drawH, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return drawH;
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
        calibSnapshot = null;
        calibLandmarks = null;
        calibGaze = new Map();
        loseSnapshot = null;
        loseLandmarks = null;
        loseGaze = new Map();
        lastLandmarks = null;
        lastGaze = new Map();
        hasFace = false;

        if (keyHandler) document.removeEventListener('keydown', keyHandler);
        keyHandler = (e: KeyboardEvent) => {
          if (e.code === 'Space' && phase === 'waiting' && hasFace && !isBlinking) {
            e.preventDefault();
            startCalibration();
          }
        };
        document.addEventListener('keydown', keyHandler);
      },

      update(face: FaceData | null, dt: number) {
        if (!face) {
          hasFace = false;
          isBlinking = false;
          if (phase === 'active') resetStreak('no face detected');
          return;
        }

        lastLandmarks = face.landmarks;
        lastGaze = readGaze(face);
        hasFace = true;

        const blinkL = face.blendshapes.get("eyeBlinkLeft") ?? 0;
        const blinkR = face.blendshapes.get("eyeBlinkRight") ?? 0;
        const blinking = blinkL > BLINK_THRESHOLD || blinkR > BLINK_THRESHOLD;
        isBlinking = blinking;

        if (phase === 'waiting') return;

        if (phase === 'calibrating') {
          calibrateTimer += dt;
          if (calibrateTimer >= CALIBRATE_TIME) {
            baseline = readGaze(face);
            calibSnapshot = captureVideo();
            calibLandmarks = face.landmarks;
            calibGaze = readGaze(face);
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
          const startMsg = !hasFace ? 'show your face' : isBlinking ? 'open your eyes' : 'press space to start';
          const msg = lastResetReason ? `${lastResetReason} — ${startMsg}` : startMsg;
          pxText(ctx, msg, cx, cy + 1.2, '0.4px Fredoka', stone, 'center');
          const cropY = cy + 2;
          const cropW = 3.5;
          const gap = 0.5;
          if (calibSnapshot && calibLandmarks) {
            pxText(ctx, 'calibrated', cx - gap / 2 - cropW / 2, cropY - 0.3, '0.25px Fredoka', stone, 'center');
            drawEyeCrop(ctx, calibSnapshot, calibLandmarks, cx - gap / 2 - cropW, cropY, cropW, gw, gh, calibGaze);
          }
          if (loseSnapshot && loseLandmarks) {
            pxText(ctx, 'lost', cx + gap / 2 + cropW / 2, cropY - 0.3, '0.25px Fredoka', stone, 'center');
            drawEyeCrop(ctx, loseSnapshot, loseLandmarks, cx + gap / 2, cropY, cropW, gw, gh, loseGaze);
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

        if (debug && lastLandmarks) {
          drawLandmarks(ctx, lastLandmarks, 0, 0, gw, gh, gw, gh, true);
        }
      },

      extraButtons: [
        { label: 'start', key: ' ', onClick: () => { if (phase === 'waiting' && hasFace && !isBlinking) startCalibration(); } },
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
