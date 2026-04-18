import type { Experiment, FaceData, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { lavender, charcoal, stone, honey, rose, teal } from '../palette';

const CALIBRATE_TIME = 2.0;
const MOVE_THRESHOLD = 0.15;
const BLINK_THRESHOLD = 0.2;
const MAX_BLINK_TIME = 0.5;
const POST_BLINK_GRACE = 0.25;
const MOVE_GRACE = 0.15;

const LEVELS: [number, string][] = [
  [8 * 60 * 60, 'buddha'],
  [5 * 60 * 60, 'guanyin'],
  [3 * 60 * 60, 'tara'],
  [2 * 60 * 60, 'jizo'],
  [80 * 60, 'manjushri'],
  [50 * 60, 'arhat'],
  [30 * 60, 'anagami'],
  [20 * 60, 'sakadagami'],
  [13 * 60, 'sotapanna'],
  [8 * 60, 'garuda'],
  [5 * 60, 'naga'],
  [3 * 60, 'asura'],
  [2 * 60, 'yaksha'],
  [80, 'dragon'],
  [50, 'tiger'],
  [30, 'wolf'],
  [20, 'horse'],
  [13, 'monkey'],
  [8, 'cat'],
  [5, 'pigeon'],
  [3, 'rat'],
  [2, 'goldfish'],
  [0, 'mosquito'],
];

function getLevel(seconds: number): string {
  for (const [threshold, label] of LEVELS) {
    if (seconds >= threshold) return label;
  }
  return 'noob';
}

enum Gaze {
  UpLeft = 'eyeLookUpLeft',
  DownLeft = 'eyeLookDownLeft',
  InLeft = 'eyeLookInLeft',
  OutLeft = 'eyeLookOutLeft',
  UpRight = 'eyeLookUpRight',
  DownRight = 'eyeLookDownRight',
  InRight = 'eyeLookInRight',
  OutRight = 'eyeLookOutRight',
}

const GAZE_SHAPES = Object.values(Gaze);

function describeGaze(g: Gaze, positive: boolean): string {
  switch (g) {
    case Gaze.UpLeft:    return positive ? 'up'    : 'down';
    case Gaze.DownLeft:  return positive ? 'down'  : 'up';
    case Gaze.InLeft:    return positive ? 'right' : 'left';
    case Gaze.OutLeft:   return positive ? 'left'  : 'right';
    case Gaze.UpRight:   return positive ? 'up'    : 'down';
    case Gaze.DownRight: return positive ? 'down'  : 'up';
    case Gaze.InRight:   return positive ? 'left'  : 'right';
    case Gaze.OutRight:  return positive ? 'right' : 'left';
  }
}

// main.ts remaps landmarks with 5% margin crop — reverse it to get raw video coords
const MARGIN = 0.05;
function toRawVideo(gameVal: number, gameSize: number, videoSize: number): number {
  const normalized = gameVal / gameSize; // 0..1 in remapped space
  const raw = normalized * (1 - 2 * MARGIN) + MARGIN; // 0..1 in raw video space
  return raw * videoSize;
}

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
    let moveOffender: Gaze | '';
    let gazeWarning: string;
    let lastRoundTime: number;
    let loseOffender: Gaze | '';
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

    function resetStreak(reason: string, offender?: Gaze) {
      lastRoundTime = streak;
      if (streak > best) best = streak;
      lastResetReason = reason;
      loseSnapshot = captureVideo();
      loseLandmarks = lastLandmarks;
      loseGaze = lastGaze;
      loseOffender = offender ?? '';
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

    // Left eye: outer=33, inner=133; Right eye: outer=263, inner=362
    const LEFT_EYE_CORNERS = [33, 133] as const;
    const RIGHT_EYE_CORNERS = [263, 362] as const;

    // Per-eye gaze blendshape → direction landmark mapping
    // Per-eye gaze: [blendshape, dx, dy in mirrored draw space]
    const LEFT_GAZE_DIRS: [Gaze, number, number][] = [
      [Gaze.UpLeft, 0, -1],
      [Gaze.DownLeft, 0, 1],
      [Gaze.InLeft, 1, 0],     // in = toward nose = looking right = draws left in mirror
      [Gaze.OutLeft, -1, 0],   // out = away from nose = looking left = draws right in mirror
    ];
    const RIGHT_GAZE_DIRS: [Gaze, number, number][] = [
      [Gaze.UpRight, 0, -1],
      [Gaze.DownRight, 0, 1],
      [Gaze.InRight, -1, 0],   // in = toward nose = looking left = draws right in mirror
      [Gaze.OutRight, 1, 0],   // out = away from nose = looking right = draws left in mirror
    ];

    function drawEyeCrop(ctx: CanvasRenderingContext2D, snapshot: HTMLCanvasElement, landmarks: Landmarks, drawX: number, drawY: number, drawW: number, gw: number, gh: number, corners: readonly [number, number], gazeDirs: [Gaze, number, number][], gaze?: Map<string, number>, offender?: Gaze | '') {
      const outer = landmarks[corners[0]];
      const inner = landmarks[corners[1]];
      const eyeCx = (outer.x + inner.x) / 2;
      const eyeCy = (outer.y + inner.y) / 2;
      const eyeWidth = Math.abs(outer.x - inner.x);
      const eyeHeight = eyeWidth / 3;
      const minX = eyeCx - eyeWidth / 2;
      const maxX = eyeCx + eyeWidth / 2;
      const minY = eyeCy - eyeHeight / 2;
      const maxY = eyeCy + eyeHeight / 2;

      const sx = Math.max(0, toRawVideo(minX, gw, snapshot.width));
      const sy = Math.max(0, toRawVideo(minY, gh, snapshot.height));
      const sx2 = Math.min(snapshot.width, toRawVideo(maxX, gw, snapshot.width));
      const sy2 = Math.min(snapshot.height, toRawVideo(maxY, gh, snapshot.height));
      const sw = sx2 - sx;
      const sh = sy2 - sy;
      const drawH = drawW * (sh / sw);

      ctx.save();
      ctx.translate(drawX + drawW, drawY);
      ctx.scale(-1, 1);
      ctx.drawImage(snapshot, sx, sy, sw, sh, 0, 0, drawW, drawH);
      ctx.restore();

      const cropMinX = minX;
      const cropMinY = minY;
      const cropW = maxX - minX;
      const cropH = maxY - minY;
      if (gaze) {
        const centerDrawX = drawX + drawW / 2;
        const centerDrawY = drawY + drawH / 2;
        for (const [name, dx, dy] of gazeDirs) {
          const val = gaze.get(name) ?? 0;
          if (val < 0.01) continue;
          const lenX = val * drawW / 2;
          const lenY = val * drawH / 2;
          ctx.strokeStyle = (offender && name === offender) ? rose : teal;
          ctx.lineWidth = 0.03;
          ctx.beginPath();
          ctx.moveTo(centerDrawX, centerDrawY);
          ctx.lineTo(centerDrawX + dx * lenX, centerDrawY + dy * lenY);
          ctx.stroke();
        }
      }

      // Landmark dots (iris in rose, rest in stone)
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const nx = (lm.x - cropMinX) / cropW;
        const ny = (lm.y - cropMinY) / cropH;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        const isIris = i >= 468 && i <= 477;
        ctx.fillStyle = isIris ? lavender : stone;
        const r = isIris ? 0.03 : 0.015;
        ctx.beginPath();
        ctx.arc(drawX + (1 - nx) * drawW, drawY + ny * drawH, r, 0, Math.PI * 2);
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
        gazeWarning = '';
        lastRoundTime = 0;
        loseOffender = '';
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
        let halfOffender: Gaze | '' = '';
        let halfPositive = true;
        let offender: Gaze | '' = '';
        let offenderPositive = true;
        for (const name of GAZE_SHAPES) {
          const raw = (current.get(name) ?? 0) - (baseline.get(name) ?? 0);
          const diff = Math.abs(raw);
          if (diff > MOVE_THRESHOLD) {
            outOfBounds = true;
            offender = name;
            offenderPositive = raw > 0;
            break;
          } else if (diff > MOVE_THRESHOLD / 2 && !halfOffender) {
            halfOffender = name;
            halfPositive = raw > 0;
          }
        }

        gazeWarning = outOfBounds && offender
          ? `don't look ${describeGaze(offender, offenderPositive)}`
          : halfOffender
          ? `don't look ${describeGaze(halfOffender, halfPositive)}`
          : '';

        if (outOfBounds && offender) {
          moveOffender = offender;
          moveDuration += dt;
          if (moveDuration >= MOVE_GRACE) {
            const base = Math.round((baseline.get(offender) ?? 0) * 100);
            const cur = Math.round((current.get(offender) ?? 0) * 100);
            resetStreak(`looked ${describeGaze(offender, offenderPositive)} (${offender} ${base}% → ${cur}%)`, offender);
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

        const cx = gw / 2;
        const cy = gh * 0.25;

        // fixation dot
        const dotColor = phase === 'calibrating' ? honey : lavender;
        rc.circle(cx, cy, 0.4, { fill: dotColor, fillStyle: 'solid', stroke: stone, strokeWidth: 0.02 });

        if (phase === 'waiting') {
          if (lastRoundTime > 0) {
            pxText(ctx, `${Math.floor(lastRoundTime)}s — ${getLevel(lastRoundTime)}`, cx, cy - 1.2, '0.6px Fredoka', charcoal, 'center');
          }
          const startMsg = !hasFace ? 'show your face' : isBlinking ? 'open your eyes' : 'press space to start';
          const msg = lastResetReason ? `${lastResetReason} — ${startMsg}` : startMsg;
          pxText(ctx, msg, cx, cy + 1.2, '0.4px Fredoka', stone, 'center');
          const cropY = cy + 2;
          const eyeW = 3.5;
          const gap = 0.3;
          const totalW = eyeW * 2 + gap;
          const rowGap = 0.3;
          if (calibSnapshot && calibLandmarks) {
            pxText(ctx, 'calibrated', cx, cropY - 0.3, '0.25px Fredoka', stone, 'center');
            const leftH = drawEyeCrop(ctx, calibSnapshot, calibLandmarks, cx - totalW / 2, cropY, eyeW, gw, gh, LEFT_EYE_CORNERS, LEFT_GAZE_DIRS, calibGaze, loseOffender);
            drawEyeCrop(ctx, calibSnapshot, calibLandmarks, cx - totalW / 2 + eyeW + gap, cropY, eyeW, gw, gh, RIGHT_EYE_CORNERS, RIGHT_GAZE_DIRS, calibGaze, loseOffender);
            if (loseSnapshot && loseLandmarks) {
              const lostY = cropY + leftH + rowGap;
              pxText(ctx, 'lost', cx, lostY - 0.3, '0.25px Fredoka', stone, 'center');
              drawEyeCrop(ctx, loseSnapshot, loseLandmarks, cx - totalW / 2, lostY, eyeW, gw, gh, LEFT_EYE_CORNERS, LEFT_GAZE_DIRS, loseGaze, loseOffender);
              drawEyeCrop(ctx, loseSnapshot, loseLandmarks, cx - totalW / 2 + eyeW + gap, lostY, eyeW, gw, gh, RIGHT_EYE_CORNERS, RIGHT_GAZE_DIRS, loseGaze, loseOffender);
            }
          }
        } else if (phase === 'calibrating') {
          const remaining = Math.ceil(Math.max(0, CALIBRATE_TIME - calibrateTimer));
          pxText(ctx, `look at the dot... ${remaining}s`, cx, cy + 1.2, '0.4px Fredoka', stone, 'center');
        } else if (isBlinking) {
          pxText(ctx, 'open your eyes', cx, cy - 1.2, '0.8px Fredoka', charcoal, 'center');
        } else if (gazeWarning) {
          pxText(ctx, gazeWarning, cx, cy - 1.2, '0.8px Fredoka', stone, 'center');
        } else {
          pxText(ctx, Math.floor(streak) + 's', cx, cy - 1.2, '0.8px Fredoka', charcoal, 'center');
          if (best > 0) {
            pxText(ctx, `best: ${Math.floor(best)}s — ${getLevel(best)}`, cx, cy + 1.2, '0.35px Fredoka', stone, 'center');
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
