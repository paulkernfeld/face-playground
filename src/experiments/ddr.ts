import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';

interface Arrow {
  // Times are in game seconds (relative to audioStartTime)
  spawnTime: number;
  targetTime: number;
  hit?: 'hit' | 'miss';
  hitTime?: number;
}

// Head pitch threshold for "nodding down" (radians)
const NOD_THRESH = 0.25;

// Arrow travel time (2 bars at 60 BPM = 8 beats = 8s)
const TRAVEL_TIME = 8;

// Beat grid
const BPM = 60;
const BEAT_INTERVAL = 60 / BPM; // 1.0s

// How far ahead to schedule audio (seconds)
const SCHEDULE_AHEAD = 0.2;

// --- Web Audio ---
let audioCtx: AudioContext | null = null;
let audioStartTime = 0;
let scheduledUpToBeat = 0;
let nextSpawnBeat = 1;
// Track which arrows we've already judged at their beat
let nextJudgeBeat = 1;

function ensureAudio(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function beatTime(beat: number): number {
  return audioStartTime + beat * BEAT_INTERVAL;
}

function now(): number {
  if (!audioCtx) return 0;
  return audioCtx.currentTime - audioStartTime;
}

function scheduleKick(atTime: number, accent: boolean) {
  const ctx = ensureAudio();

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(accent ? 160 : 120, atTime);
  osc.frequency.exponentialRampToValueAtTime(30, atTime + 0.08);

  const gain = ctx.createGain();
  const vol = accent ? 0.3 : 0.25;
  gain.gain.setValueAtTime(vol, atTime);
  gain.gain.exponentialRampToValueAtTime(0.001, atTime + 0.15);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + 0.2);
}

function playHit() {
  const ctx = ensureAudio();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.05);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.15);
}

function playMiss() {
  const ctx = ensureAudio();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.25);
}

function scheduleBeats() {
  const ctx = ensureAudio();
  const horizon = ctx.currentTime + SCHEDULE_AHEAD;

  while (beatTime(scheduledUpToBeat) < horizon) {
    const t = beatTime(scheduledUpToBeat);
    if (t >= ctx.currentTime - 0.05) {
      const accent = scheduledUpToBeat % 4 === 0;
      scheduleKick(Math.max(t, ctx.currentTime), accent);
    }

    if (scheduledUpToBeat >= nextSpawnBeat) {
      spawnArrowOnBeat(scheduledUpToBeat);
      nextSpawnBeat = scheduledUpToBeat + 1;
    }

    scheduledUpToBeat++;
  }
}

// Arrow visual
const ARROW_SIZE = 1.2;
const TARGET_SIZE = 1.4;

// Target position — arrows fall from top to this line
const TARGET_X = 8;
const TARGET_Y = 7;

function getStartPos(): { x: number; y: number } {
  return { x: TARGET_X, y: -1 };
}

let arrows: Arrow[] = [];
let score = 0;
let combo = 0;
let maxCombo = 0;
let feedbackMsg = '';
let feedbackTime = 0;
let feedbackColor = '';
let w = 16, h = 9;
let rc: GameRoughCanvas;
let currentPitch = 0;

function showFeedback(msg: string, color: string) {
  feedbackMsg = msg;
  feedbackTime = now();
  feedbackColor = color;
}

function spawnArrowOnBeat(beat: number) {
  const targetAudioTime = beatTime(beat);
  const spawnAudioTime = targetAudioTime - TRAVEL_TIME;
  arrows.push({
    spawnTime: spawnAudioTime - audioStartTime,
    targetTime: targetAudioTime - audioStartTime,
  });
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha: number, seed: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  // Point downward
  ctx.rotate(Math.PI);

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
    feedbackMsg = '';
    currentPitch = 0;

    const ac = ensureAudio();
    audioStartTime = ac.currentTime;
    scheduledUpToBeat = 0;
    nextSpawnBeat = 1;
    nextJudgeBeat = 1;
  },

  update(face: FaceData | null, _dt: number) {
    const t = now();

    scheduleBeats();

    // Track current head pitch
    if (face) {
      currentPitch = face.headPitch;
    }

    // Judge arrows at their target time: is head nodded down?
    for (const arrow of arrows) {
      if (arrow.hit) continue;
      if (t >= arrow.targetTime) {
        const nodding = currentPitch > NOD_THRESH;
        if (nodding) {
          arrow.hit = 'hit';
          arrow.hitTime = t;
          score += 100 * (1 + Math.floor(combo / 10));
          combo++;
          maxCombo = Math.max(maxCombo, combo);
          showFeedback('HIT!', '#2EC4B6');
          playHit();
        } else {
          arrow.hit = 'miss';
          arrow.hitTime = t;
          combo = 0;
          showFeedback('MISS', '#FF6B6B');
          playMiss();
        }
      }
    }

    // Clean up old arrows
    arrows = arrows.filter(a => {
      if (!a.hit) return true;
      return t - (a.hitTime ?? 0) < 0.5;
    });
  },

  demo() {
    audioStartTime = 0;
    const fakeNow = 5;
    score = 1250;
    combo = 8;
    maxCombo = 12;
    feedbackMsg = 'HIT!';
    feedbackTime = fakeNow - 0.1;
    feedbackColor = '#2EC4B6';
    arrows = [
      { spawnTime: fakeNow - 6, targetTime: fakeNow + 2 },
      { spawnTime: fakeNow - 5, targetTime: fakeNow + 3 },
      { spawnTime: fakeNow - 4, targetTime: fakeNow + 4 },
      { spawnTime: fakeNow - 3, targetTime: fakeNow + 5 },
      { spawnTime: fakeNow - 8, targetTime: fakeNow - 0.05, hit: 'hit', hitTime: fakeNow - 0.1 },
    ];
  },

  draw(ctx, ww, hh) {
    w = ww; h = hh;
    const t = audioCtx ? now() : 5;

    // Target line
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#2EC4B6';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(TARGET_X - 2, TARGET_Y);
    ctx.lineTo(TARGET_X + 2, TARGET_Y);
    ctx.stroke();
    ctx.restore();

    // Target arrow outline
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.translate(TARGET_X, TARGET_Y);
    ctx.rotate(Math.PI);
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
      fill: 'none', stroke: '#2EC4B6', strokeWidth: 0.03,
      roughness: 1.5, seed: 500,
    });
    ctx.restore();

    // Draw arrows in flight
    for (const arrow of arrows) {
      const start = getStartPos();
      const progress = (t - arrow.spawnTime) / TRAVEL_TIME;

      let alpha = 1;
      let x: number, y: number;

      if (arrow.hit) {
        x = TARGET_X;
        y = TARGET_Y;
        const fadeProgress = (t - (arrow.hitTime ?? 0)) / 0.5;
        alpha = Math.max(0, 1 - fadeProgress);
        if (arrow.hit === 'miss') alpha *= 0.3;
      } else {
        x = start.x + (TARGET_X - start.x) * Math.min(1, progress);
        y = start.y + (TARGET_Y - start.y) * Math.min(1, progress);
        alpha = Math.min(1, progress * 3);
      }

      const color = arrow.hit === 'miss' ? '#555'
        : arrow.hit === 'hit' ? '#fff'
        : '#2EC4B6';

      const size = arrow.hit ? ARROW_SIZE * (1 + (t - (arrow.hitTime ?? 0)) * 0.5) : ARROW_SIZE;

      drawArrow(ctx, x, y, size, color, alpha, Math.floor(arrow.spawnTime * 100));
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
    if (feedbackMsg && t - feedbackTime < 0.6) {
      const alpha = Math.max(0, 1 - (t - feedbackTime) / 0.6);
      const yOff = (t - feedbackTime) * -0.5;
      ctx.globalAlpha = alpha;
      pxText(ctx, feedbackMsg, w / 2, h / 2 + yOff, "bold 0.5px Fredoka, sans-serif", feedbackColor, "center");
      ctx.globalAlpha = 1;
    }

    // Instructions at bottom
    pxText(ctx, "nod your head on the beat", w / 2, h - 0.3, "0.18px monospace", "rgba(255,255,255,0.25)", "center");
  },
};
