import type { Experiment, FaceData } from "../types";
import type { ArrowDirection } from "../ddr-pattern";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { teal, rose, honey, charcoal, stone, cream, sky, lavender } from '../palette';
import { getArrowDirection } from '../ddr-pattern';

interface Arrow {
  // Times are in game seconds (relative to audioStartTime)
  spawnTime: number;
  targetTime: number;
  direction: ArrowDirection; // arrow direction from the fixed pattern
  hit?: 'hit' | 'miss';
  hitTime?: number;
}

// Head movement thresholds (radians) — generous for fun
const NOD_THRESH = 0.15;
const YAW_THRESH = 0.12;

// Arrow travel time (2 bars at 60 BPM = 8 beats = 8s)
const TRAVEL_TIME = 8;

// Beat grid
const BPM = 120;
const BEAT_INTERVAL = 60 / BPM; // 0.5s

// How far ahead to schedule audio (seconds)
const SCHEDULE_AHEAD = 0.2;

// Calibration duration in seconds
const CALIBRATION_DURATION = 3;

// localStorage key for saved calibration
const CALIBRATION_KEY = 'ddr-calibration';

// --- Web Audio ---
let audioCtx: AudioContext | null = null;
let audioStartTime = 0;
let scheduledUpToBeat = 0;
let nextSpawnBeat = 1;
// Track which arrows we've already judged at their beat
let nextJudgeBeat = 1;

// --- Calibration state ---
let calibrating = false;
let calibrationStartTime = 0; // performance.now() when calibration started
let calibrationSamples: { pitch: number; yaw: number }[] = [];
let baselinePitch = 0;
let baselineYaw = 0;
let gameStarted = false; // true once calibration is done and game is running

// --- Key handler ---
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

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

/** Schedule a hit sound on the next beat for clearer rhythmic feedback. */
function scheduleHitOnNextBeat() {
  const ctx = ensureAudio();
  // Find the next beat time after now
  const currentGameTime = now();
  const currentBeat = Math.ceil(currentGameTime / BEAT_INTERVAL);
  const nextBeatAudioTime = beatTime(currentBeat);
  const atTime = Math.max(nextBeatAudioTime, ctx.currentTime + 0.01);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, atTime);
  osc.frequency.exponentialRampToValueAtTime(1200, atTime + 0.05);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, atTime);
  gain.gain.exponentialRampToValueAtTime(0.001, atTime + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + 0.15);
}

/** Schedule a miss sound on the next beat for clearer rhythmic feedback. */
function scheduleMissOnNextBeat() {
  const ctx = ensureAudio();
  const currentGameTime = now();
  const currentBeat = Math.ceil(currentGameTime / BEAT_INTERVAL);
  const nextBeatAudioTime = beatTime(currentBeat);
  const atTime = Math.max(nextBeatAudioTime, ctx.currentTime + 0.01);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, atTime);
  osc.frequency.exponentialRampToValueAtTime(80, atTime + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, atTime);
  gain.gain.exponentialRampToValueAtTime(0.001, atTime + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + 0.25);
}

function scheduleBeats() {
  const ctx = ensureAudio();
  const audioHorizon = ctx.currentTime + SCHEDULE_AHEAD;

  // Schedule audio kicks (short look-ahead for precise timing)
  while (beatTime(scheduledUpToBeat) < audioHorizon) {
    const t = beatTime(scheduledUpToBeat);
    if (t >= ctx.currentTime - 0.05) {
      const accent = scheduledUpToBeat % 4 === 0;
      scheduleKick(Math.max(t, ctx.currentTime), accent);
    }
    scheduledUpToBeat++;
  }

  // Spawn arrows on every beat — direction comes from the fixed 8-step pattern
  const arrowHorizon = ctx.currentTime + TRAVEL_TIME;
  while (beatTime(nextSpawnBeat) < arrowHorizon) {
    spawnArrowOnBeat(nextSpawnBeat);
    nextSpawnBeat++;
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
let currentPitch = 0; // calibrated pitch (raw - baseline)
let currentYaw = 0;   // calibrated yaw (raw - baseline)
let rawPitch = 0;     // raw pitch from face tracking
let rawYaw = 0;       // raw yaw from face tracking

/** Determine the current detected head direction from calibrated pitch/yaw. */
function getDetectedDirection(): ArrowDirection {
  // Check pitch (up/down) first — larger threshold
  if (currentPitch < -NOD_THRESH) return 'up';
  if (currentPitch > NOD_THRESH) return 'down';
  // Check yaw (left/right)
  if (currentYaw > YAW_THRESH) return 'left';
  if (currentYaw < -YAW_THRESH) return 'right';
  return 'center';
}

/** Check if current head pose matches the arrow direction. Generous thresholds. */
function isDirectionMatch(dir: ArrowDirection): boolean {
  switch (dir) {
    case 'down':  return currentPitch > NOD_THRESH;       // nod down
    case 'up':    return currentPitch < -NOD_THRESH;      // look up
    case 'left':  return currentYaw > YAW_THRESH;         // turn left
    case 'right': return currentYaw < -YAW_THRESH;        // turn right
    case 'center': return true;
  }
}

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
    direction: getArrowDirection(beat),
  });
  // Expose for Playwright tests
  (window as any).__ddrArrows = arrows;
}

/** Rotation angle for each arrow direction (points the arrow in the movement direction). */
function directionRotation(dir: ArrowDirection): number {
  switch (dir) {
    case 'down':  return Math.PI;       // point down
    case 'up':    return 0;             // point up (default arrow shape)
    case 'left':  return -Math.PI / 2;  // point left
    case 'right': return Math.PI / 2;   // point right
    case 'center': return Math.PI;      // fallback (not drawn)
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha: number, seed: number, direction: ArrowDirection = 'down') {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(directionRotation(direction));

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
    stroke: charcoal, strokeWidth: 0.03,
    roughness: 1.2, seed,
  });

  ctx.restore();
}

/** Load saved calibration from localStorage, returns true if found. */
function loadCalibration(): boolean {
  try {
    const saved = localStorage.getItem(CALIBRATION_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (typeof data.pitch === 'number' && typeof data.yaw === 'number') {
        baselinePitch = data.pitch;
        baselineYaw = data.yaw;
        return true;
      }
    }
  } catch (_) {
    // ignore parse errors
  }
  return false;
}

/** Save calibration to localStorage. */
function saveCalibration() {
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify({
      pitch: baselinePitch,
      yaw: baselineYaw,
    }));
  } catch (_) {
    // ignore storage errors
  }
}

/** Start or restart calibration. */
function startCalibration() {
  calibrating = true;
  calibrationStartTime = performance.now();
  calibrationSamples = [];
  gameStarted = false;

  // Reset game state for fresh start after calibration
  arrows = [];
  score = 0;
  combo = 0;
  maxCombo = 0;
  feedbackMsg = '';
  scheduledUpToBeat = 0;
  nextSpawnBeat = 1;
  nextJudgeBeat = 1;
}

/** Finish calibration: compute baseline from samples and start the game. */
function finishCalibration() {
  if (calibrationSamples.length > 0) {
    let sumPitch = 0, sumYaw = 0;
    for (const s of calibrationSamples) {
      sumPitch += s.pitch;
      sumYaw += s.yaw;
    }
    baselinePitch = sumPitch / calibrationSamples.length;
    baselineYaw = sumYaw / calibrationSamples.length;
    saveCalibration();
  }
  calibrating = false;
  gameStarted = true;

  // Reset audio timeline so beats start fresh
  const ac = ensureAudio();
  audioStartTime = ac.currentTime;
  scheduledUpToBeat = 0;
  nextSpawnBeat = 1;
  nextJudgeBeat = 1;
  arrows = [];
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
    rawPitch = 0;
    rawYaw = 0;
    currentPitch = 0;
    currentYaw = 0;

    ensureAudio();

    // Try to load saved calibration
    const hasSaved = loadCalibration();
    if (hasSaved) {
      // Skip calibration, start game immediately
      gameStarted = true;
      calibrating = false;
      const ac = ensureAudio();
      audioStartTime = ac.currentTime;
      scheduledUpToBeat = 0;
      nextSpawnBeat = 1;
      nextJudgeBeat = 1;
    } else {
      // Start calibration phase
      startCalibration();
    }

    // Register 'c' key for recalibration
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        startCalibration();
      }
    };
    document.addEventListener('keydown', keyHandler);
  },

  update(face: FaceData | null, _dt: number) {
    // Track raw head pose
    if (face) {
      rawPitch = face.headPitch;
      rawYaw = face.headYaw;
    }

    // Apply calibration baseline
    currentPitch = rawPitch - baselinePitch;
    currentYaw = rawYaw - baselineYaw;

    // --- Calibration phase ---
    if (calibrating) {
      if (face) {
        calibrationSamples.push({ pitch: rawPitch, yaw: rawYaw });
      }
      const elapsed = (performance.now() - calibrationStartTime) / 1000;
      if (elapsed >= CALIBRATION_DURATION) {
        finishCalibration();
      }
      return; // Don't process game logic during calibration
    }

    // --- Game phase ---
    if (!gameStarted) return;

    const t = now();
    scheduleBeats();

    // Judge arrows at their target time
    for (const arrow of arrows) {
      if (arrow.hit) continue;
      if (t >= arrow.targetTime) {
        if (arrow.direction === 'center') {
          // Rest beat — auto-pass, no feedback
          arrow.hit = 'hit';
          arrow.hitTime = t;
        } else {
          // Check if head is moving in the arrow's direction
          const match = isDirectionMatch(arrow.direction);
          if (match) {
            arrow.hit = 'hit';
            arrow.hitTime = t;
            score += 100 * (1 + Math.floor(combo / 10));
            combo++;
            maxCombo = Math.max(maxCombo, combo);
            showFeedback('HIT!', teal);
            scheduleHitOnNextBeat();
          } else {
            arrow.hit = 'miss';
            arrow.hitTime = t;
            combo = 0;
            showFeedback('MISS', rose);
            scheduleMissOnNextBeat();
          }
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
    feedbackColor = teal;
    calibrating = false;
    gameStarted = true;
    baselinePitch = 0;
    baselineYaw = 0;
    currentPitch = 0.2; // simulate looking down slightly for HUD demo
    currentYaw = 0;
    rawPitch = 0.2;
    rawYaw = 0;
    arrows = [
      { spawnTime: fakeNow - 6, targetTime: fakeNow + 2, direction: 'up' },
      { spawnTime: fakeNow - 5.5, targetTime: fakeNow + 2.5, direction: 'center' },
      { spawnTime: fakeNow - 5, targetTime: fakeNow + 3, direction: 'down' },
      { spawnTime: fakeNow - 4.5, targetTime: fakeNow + 3.5, direction: 'center' },
      { spawnTime: fakeNow - 4, targetTime: fakeNow + 4, direction: 'left' },
      { spawnTime: fakeNow - 3.5, targetTime: fakeNow + 4.5, direction: 'right' },
      { spawnTime: fakeNow - 8, targetTime: fakeNow - 0.05, direction: 'down', hit: 'hit', hitTime: fakeNow - 0.1 },
    ];
  },

  draw(ctx, ww, hh) {
    w = ww; h = hh;
    const t = audioCtx ? now() : 5;

    // --- Calibration screen ---
    if (calibrating) {
      const elapsed = (performance.now() - calibrationStartTime) / 1000;
      const remaining = Math.max(0, CALIBRATION_DURATION - elapsed);
      const progress = Math.min(1, elapsed / CALIBRATION_DURATION);

      // Title
      pxText(ctx, "CALIBRATING", w / 2, h / 2 - 1.5, "bold 0.45px Fredoka, sans-serif", teal, "center");

      // Instruction
      pxText(ctx, "look straight at the camera", w / 2, h / 2 - 0.7, "0.25px Sora, sans-serif", cream, "center");

      // Countdown
      pxText(ctx, `${Math.ceil(remaining)}`, w / 2, h / 2 + 0.5, "bold 1px Fredoka, sans-serif", honey, "center");

      // Progress bar
      const barW = 4;
      const barH_px = 0.15;
      const barX = w / 2 - barW / 2;
      const barY = h / 2 + 1.3;
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = stone;
      ctx.fillRect(barX, barY, barW, barH_px);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = teal;
      ctx.fillRect(barX, barY, barW * progress, barH_px);
      ctx.restore();

      // Samples collected
      pxText(ctx, `samples: ${calibrationSamples.length}`, w / 2, h / 2 + 2.0, "0.15px monospace", stone, "center");

      return; // Don't draw game elements during calibration
    }

    // --- Game rendering ---

    // Hit window visualization: highlight target zone when an arrow is within 1 beat of arrival
    const nextArrow = arrows.find(a => !a.hit && a.direction !== 'center');
    if (nextArrow) {
      const timeToTarget = nextArrow.targetTime - t;
      if (timeToTarget >= 0 && timeToTarget < BEAT_INTERVAL) {
        // Arrow is within one beat of the target — show active hit window
        const intensity = 1 - (timeToTarget / BEAT_INTERVAL); // 0→1 as arrow approaches
        ctx.save();
        ctx.globalAlpha = 0.08 + intensity * 0.12;
        ctx.fillStyle = teal;
        // Draw a band around the target Y
        ctx.fillRect(TARGET_X - 2, TARGET_Y - 0.8, 4, 1.6);
        ctx.restore();
      }
    }

    // Target line
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = teal;
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
      fill: 'none', stroke: teal, strokeWidth: 0.03,
      roughness: 1.5, seed: 500,
    });
    ctx.restore();

    // Draw arrows in flight (skip center/rest beats — they're silent checks)
    for (const arrow of arrows) {
      if (arrow.direction === 'center') continue;

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

      const color = arrow.hit === 'miss' ? stone
        : arrow.hit === 'hit' ? cream
        : teal;

      const size = arrow.hit ? ARROW_SIZE * (1 + (t - (arrow.hitTime ?? 0)) * 0.5) : ARROW_SIZE;

      drawArrow(ctx, x, y, size, color, alpha, Math.floor(arrow.spawnTime * 100), arrow.direction);
    }

    // Score (top right)
    pxText(ctx, `${score}`, w - 0.3, 0.6, "bold 0.4px monospace", cream, "right");

    // Combo (top left — below HUD)
    if (combo > 1) {
      pxText(ctx, `${combo}x combo`, 0.3, 1.8, "bold 0.3px monospace", honey);
    }

    // Max combo (below combo)
    if (maxCombo > 1) {
      pxText(ctx, `best: ${maxCombo}x`, 0.3, 2.2, "0.18px monospace", "rgba(255,255,255,0.3)");
    }

    // --- Debug HUD: detected head direction ---
    {
      const dir = getDetectedDirection();
      const dirLabel = dir === 'center' ? 'NEUTRAL' : dir.toUpperCase();
      const dirColor = dir === 'center' ? stone : sky;
      pxText(ctx, `HEAD: ${dirLabel}`, 0.3, 0.6, "bold 0.22px monospace", dirColor);

      // Show calibration info
      if (baselinePitch !== 0 || baselineYaw !== 0) {
        pxText(ctx, `cal: p${baselinePitch >= 0 ? '+' : ''}${baselinePitch.toFixed(2)} y${baselineYaw >= 0 ? '+' : ''}${baselineYaw.toFixed(2)}`, 0.3, 1.0, "0.13px monospace", stone);
      }
      pxText(ctx, "'c' recalibrate", 0.3, 1.3, "0.11px monospace", "rgba(255,255,255,0.2)");
    }

    // Feedback message (center, fades out)
    if (feedbackMsg && t - feedbackTime < 0.6) {
      const alpha = Math.max(0, 1 - (t - feedbackTime) / 0.6);
      const yOff = (t - feedbackTime) * -0.5;
      ctx.globalAlpha = alpha;
      pxText(ctx, feedbackMsg, w / 2, h / 2 + yOff, "bold 0.5px Fredoka, sans-serif", feedbackColor, "center");
      ctx.globalAlpha = 1;
    }

    // Head pitch indicator (right side)
    {
      const indicatorX = w - 1.5;
      const indicatorCY = TARGET_Y;
      const barH = 3;  // half-height of the indicator range
      // Map pitch to position: 0 = center, positive (nodding down) = below
      const pitchY = Math.max(-barH, Math.min(barH, currentPitch * (barH / 0.6)));
      const dotY = indicatorCY + pitchY;
      const nodding = currentPitch > NOD_THRESH;

      // Vertical guide line
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = cream;
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(indicatorX, indicatorCY - barH);
      ctx.lineTo(indicatorX, indicatorCY + barH);
      ctx.stroke();

      // Threshold line
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = teal;
      const threshY = indicatorCY + NOD_THRESH * (barH / 0.6);
      ctx.beginPath();
      ctx.moveTo(indicatorX - 0.3, threshY);
      ctx.lineTo(indicatorX + 0.3, threshY);
      ctx.stroke();
      ctx.restore();

      // Current pitch dot
      const dotColor = nodding ? teal : 'rgba(255,255,255,0.5)';
      const dotSize = nodding ? 0.35 : 0.25;
      rc.circle(indicatorX, dotY, dotSize, {
        fill: dotColor, fillStyle: 'solid', stroke: 'none',
        roughness: 0.5, seed: 600,
      });
    }

    // Instructions at bottom
    pxText(ctx, "move your head to match the arrows", w / 2, h - 0.3, "0.18px monospace", "rgba(255,255,255,0.25)", "center");
  },

  cleanup() {
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    calibrating = false;
    gameStarted = false;
  },
};
