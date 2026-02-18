import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';

// Directions: up, down, left, right
type Dir = 'up' | 'down' | 'left' | 'right';

interface Arrow {
  dir: Dir;
  spawnTime: number;    // when arrow was created
  targetTime: number;   // when arrow should reach center
  hit?: 'perfect' | 'good' | 'miss';
  hitTime?: number;
}

// Timing windows (seconds)
const PERFECT_WINDOW = 0.12;
const GOOD_WINDOW = 0.25;
const MISS_WINDOW = 0.4;

// Head movement thresholds (radians)
const PITCH_THRESH = 0.25;
const YAW_THRESH = 0.2;

// Arrow travel time from edge to center
const TRAVEL_TIME = 1.5;

// Spawn timing
const MIN_SPAWN_INTERVAL = 0.6;
const MAX_SPAWN_INTERVAL = 1.4;

// Arrow visual
const ARROW_SIZE = 0.6;
const TARGET_SIZE = 0.7;

// Colors per direction
const DIR_COLORS: Record<Dir, string> = {
  up: '#FF6B6B',
  down: '#2EC4B6',
  left: '#7C5CFF',
  right: '#FFD93D',
};

// Target positions (center of screen)
const TARGET_X = 8;
const TARGET_Y = 4.5;

// Start positions per direction (edges)
function getStartPos(dir: Dir): { x: number; y: number } {
  switch (dir) {
    case 'up': return { x: TARGET_X, y: -0.5 };
    case 'down': return { x: TARGET_X, y: 9.5 };
    case 'left': return { x: -0.5, y: TARGET_Y };
    case 'right': return { x: 16.5, y: TARGET_Y };
  }
}

let arrows: Arrow[] = [];
let score = 0;
let combo = 0;
let maxCombo = 0;
let nextSpawnIn = 1.0;
let gameTime = 0;
let feedbackMsg = '';
let feedbackTime = 0;
let feedbackColor = '';
let w = 16, h = 9;
let rc: GameRoughCanvas;
let lastDir: Dir | null = null;
let dirHeld = false;

// Which direction is the head pointing?
function getHeadDir(pitch: number, yaw: number): Dir | null {
  // pitch positive = looking down, negative = looking up
  // yaw positive = turned left, negative = turned right
  const ap = Math.abs(pitch);
  const ay = Math.abs(yaw);

  if (ap < PITCH_THRESH && ay < YAW_THRESH) return null;

  if (ap > ay) {
    return pitch > 0 ? 'down' : 'up';
  } else {
    return yaw > 0 ? 'left' : 'right';
  }
}

function showFeedback(msg: string, color: string) {
  feedbackMsg = msg;
  feedbackTime = gameTime;
  feedbackColor = color;
}

function spawnArrow() {
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  const dir = dirs[Math.floor(Math.random() * dirs.length)];
  arrows.push({
    dir,
    spawnTime: gameTime,
    targetTime: gameTime + TRAVEL_TIME,
  });
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Dir, size: number, color: string, alpha: number, seed: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  // Rotate based on direction
  const rotations: Record<Dir, number> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };
  ctx.rotate(rotations[dir]);

  // Draw arrow pointing up using rough.js
  const s = size / 2;
  rc.polygon([
    [0, -s],
    [s * 0.8, s * 0.3],
    [s * 0.3, s * 0.1],
    [s * 0.3, s],
    [-s * 0.3, s],
    [-s * 0.3, s * 0.1],
    [-s * 0.8, s * 0.3],
    [0, -s],
  ], {
    fill: color, fillStyle: 'solid',
    stroke: '#333', strokeWidth: 0.03,
    roughness: 1.2, seed,
  });

  ctx.restore();
}

export const ddr: Experiment = {
  name: "rhythm",

  setup(ctx, ww, hh) {
    w = ww; h = hh;
    rc = new GameRoughCanvas(ctx.canvas);
    arrows = [];
    score = 0;
    combo = 0;
    maxCombo = 0;
    nextSpawnIn = 1.5;
    gameTime = 0;
    feedbackMsg = '';
    lastDir = null;
    dirHeld = false;
  },

  update(face: FaceData | null, dt: number) {
    gameTime += dt;

    // Spawn arrows
    nextSpawnIn -= dt;
    if (nextSpawnIn <= 0) {
      spawnArrow();
      nextSpawnIn = MIN_SPAWN_INTERVAL + Math.random() * (MAX_SPAWN_INTERVAL - MIN_SPAWN_INTERVAL);
      // Speed up over time
      const speedup = Math.min(0.4, gameTime / 120);
      nextSpawnIn = Math.max(0.4, nextSpawnIn - speedup);
    }

    // Get current head direction
    let currentDir: Dir | null = null;
    if (face) {
      currentDir = getHeadDir(face.headPitch, face.headYaw);
    }

    // Detect direction change (trigger on new direction, not hold)
    const justMoved = currentDir !== null && (currentDir !== lastDir || !dirHeld);
    if (currentDir !== lastDir) dirHeld = false;
    if (currentDir !== null && !dirHeld) dirHeld = true;
    lastDir = currentDir;

    // Check for hits on direction change
    if (justMoved && currentDir) {
      let bestArrow: Arrow | null = null;
      let bestDelta = Infinity;

      for (const arrow of arrows) {
        if (arrow.hit) continue;
        if (arrow.dir !== currentDir) continue;
        const delta = Math.abs(gameTime - arrow.targetTime);
        if (delta < MISS_WINDOW && delta < bestDelta) {
          bestArrow = arrow;
          bestDelta = delta;
        }
      }

      if (bestArrow) {
        if (bestDelta < PERFECT_WINDOW) {
          bestArrow.hit = 'perfect';
          bestArrow.hitTime = gameTime;
          score += 100 * (1 + Math.floor(combo / 10));
          combo++;
          showFeedback('PERFECT!', '#FFD93D');
        } else if (bestDelta < GOOD_WINDOW) {
          bestArrow.hit = 'good';
          bestArrow.hitTime = gameTime;
          score += 50 * (1 + Math.floor(combo / 10));
          combo++;
          showFeedback('GOOD', '#2EC4B6');
        }
        maxCombo = Math.max(maxCombo, combo);
      }
    }

    // Mark missed arrows
    for (const arrow of arrows) {
      if (!arrow.hit && gameTime > arrow.targetTime + MISS_WINDOW) {
        arrow.hit = 'miss';
        arrow.hitTime = gameTime;
        combo = 0;
        showFeedback('MISS', '#FF6B6B');
      }
    }

    // Clean up old arrows
    arrows = arrows.filter(a => {
      if (!a.hit) return true;
      return gameTime - (a.hitTime ?? 0) < 0.5;
    });
  },

  demo() {
    gameTime = 5;
    score = 1250;
    combo = 8;
    maxCombo = 12;
    feedbackMsg = 'PERFECT!';
    feedbackTime = gameTime - 0.1;
    feedbackColor = '#FFD93D';
    arrows = [
      { dir: 'up', spawnTime: gameTime - 0.8, targetTime: gameTime + 0.7 },
      { dir: 'left', spawnTime: gameTime - 0.5, targetTime: gameTime + 1.0 },
      { dir: 'right', spawnTime: gameTime - 0.2, targetTime: gameTime + 1.3 },
      { dir: 'down', spawnTime: gameTime - 1.2, targetTime: gameTime + 0.3 },
      // A just-hit arrow fading out
      { dir: 'up', spawnTime: gameTime - 2, targetTime: gameTime - 0.05, hit: 'perfect', hitTime: gameTime - 0.1 },
    ];
  },

  draw(ctx, ww, hh) {
    w = ww; h = hh;

    // Target zone — faint outlines for each direction
    for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) {
      const color = DIR_COLORS[dir];
      // Offset target slightly in the direction it comes from
      const offsets: Record<Dir, { x: number; y: number }> = {
        up: { x: 0, y: -0.9 },
        down: { x: 0, y: 0.9 },
        left: { x: -0.9, y: 0 },
        right: { x: 0.9, y: 0 },
      };
      const off = offsets[dir];
      const tx = TARGET_X + off.x;
      const ty = TARGET_Y + off.y;

      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.translate(tx, ty);
      const rotations: Record<Dir, number> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };
      ctx.rotate(rotations[dir]);

      rc.polygon([
        [0, -TARGET_SIZE / 2],
        [TARGET_SIZE * 0.4, TARGET_SIZE * 0.15],
        [TARGET_SIZE * 0.15, TARGET_SIZE * 0.05],
        [TARGET_SIZE * 0.15, TARGET_SIZE / 2],
        [-TARGET_SIZE * 0.15, TARGET_SIZE / 2],
        [-TARGET_SIZE * 0.15, TARGET_SIZE * 0.05],
        [-TARGET_SIZE * 0.4, TARGET_SIZE * 0.15],
        [0, -TARGET_SIZE / 2],
      ], {
        fill: 'none', stroke: color, strokeWidth: 0.03,
        roughness: 1.5, seed: 500 + ['up', 'down', 'left', 'right'].indexOf(dir),
      });

      ctx.restore();
    }

    // Draw arrows in flight
    for (const arrow of arrows) {
      const start = getStartPos(arrow.dir);
      const offsets: Record<Dir, { x: number; y: number }> = {
        up: { x: 0, y: -0.9 },
        down: { x: 0, y: 0.9 },
        left: { x: -0.9, y: 0 },
        right: { x: 0.9, y: 0 },
      };
      const off = offsets[arrow.dir];
      const targetX = TARGET_X + off.x;
      const targetY = TARGET_Y + off.y;

      const progress = (gameTime - arrow.spawnTime) / TRAVEL_TIME;

      let alpha = 1;
      let x: number, y: number;

      if (arrow.hit) {
        // Hit or miss — show at target and fade
        x = targetX;
        y = targetY;
        const fadeProgress = (gameTime - (arrow.hitTime ?? 0)) / 0.5;
        alpha = Math.max(0, 1 - fadeProgress);
        if (arrow.hit === 'miss') alpha *= 0.3;
      } else {
        // Lerp from start to target
        x = start.x + (targetX - start.x) * Math.min(1, progress);
        y = start.y + (targetY - start.y) * Math.min(1, progress);
        // Fade in at the start
        alpha = Math.min(1, progress * 3);
      }

      const color = arrow.hit === 'miss' ? '#555'
        : arrow.hit === 'perfect' ? '#fff'
        : arrow.hit === 'good' ? '#ccc'
        : DIR_COLORS[arrow.dir];

      const size = arrow.hit ? ARROW_SIZE * (1 + (gameTime - (arrow.hitTime ?? 0)) * 0.5) : ARROW_SIZE;

      drawArrow(ctx, x, y, arrow.dir, size, color, alpha, Math.floor(arrow.spawnTime * 100));
    }

    // Score (top right)
    pxText(ctx, `${score}`, w - 0.3, 0.6, "bold 0.4px monospace", "#fff", "right");

    // Combo (top left)
    if (combo > 1) {
      pxText(ctx, `${combo}x combo`, 0.3, 0.6, "bold 0.3px monospace", "#FFD93D");
    }

    // Max combo (below combo)
    if (maxCombo > 1) {
      pxText(ctx, `best: ${maxCombo}x`, 0.3, 1.0, "0.18px monospace", "rgba(255,255,255,0.3)");
    }

    // Feedback message (center, fades out)
    if (feedbackMsg && gameTime - feedbackTime < 0.6) {
      const alpha = Math.max(0, 1 - (gameTime - feedbackTime) / 0.6);
      const yOff = (gameTime - feedbackTime) * -0.5;
      ctx.globalAlpha = alpha;
      pxText(ctx, feedbackMsg, w / 2, h / 2 + yOff, "bold 0.5px Fredoka, sans-serif", feedbackColor, "center");
      ctx.globalAlpha = 1;
    }

    // Instructions at bottom
    pxText(ctx, "move your head in the arrow direction", w / 2, h - 0.3, "0.18px monospace", "rgba(255,255,255,0.25)", "center");
  },
};
