import type { Experiment, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { sage, honey, rose, stone } from '../palette';
import type { PersonState } from './creature-shared';
import {
  L_WRIST, R_WRIST, L_SHOULDER, R_SHOULDER,
  updatePeople, drawPerson, makeDemoPose, makePerson,
} from './creature-shared';

let rc: GameRoughCanvas;
let w = 16, h = 9;
let people: PersonState[] = [];

// Phase state
type Phase = 'green' | 'countdown' | 'red';
let phase: Phase = 'green';
let phaseTimer = 0;
const GREEN_DURATION = 6;
const RED_DURATION = 4;
const COUNTDOWN_DURATION = 3;

// Movement detection — store previous wrist/shoulder positions per person
let prevPositions: { x: number; y: number }[][] = [];
const MOVEMENT_THRESHOLD = 0.8; // per-frame delta sum to trigger "caught" (forgiving for 3yo)

// Flash state when movement detected during red
let flashAlpha = 0;
let wigglePhase = 0;
let caught = false;
let lastMovement = 0;

function resetPhase(newPhase: Phase) {
  phase = newPhase;
  phaseTimer = 0;
  if (newPhase === 'green') {
    caught = false;
  }
}

function getTrackedPoints(p: { x: number; y: number }[]): { x: number; y: number }[] {
  return [p[L_WRIST], p[R_WRIST], p[L_SHOULDER], p[R_SHOULDER]];
}

function measureMovement(people: PersonState[], prevPositions: { x: number; y: number }[][]): number {
  let totalDelta = 0;
  for (let i = 0; i < people.length; i++) {
    const p = people[i].pts;
    if (p.length < 33) continue;
    const current = getTrackedPoints(p);
    if (i < prevPositions.length && prevPositions[i].length === current.length) {
      for (let j = 0; j < current.length; j++) {
        const dx = current[j].x - prevPositions[i][j].x;
        const dy = current[j].y - prevPositions[i][j].y;
        totalDelta += Math.sqrt(dx * dx + dy * dy);
      }
    }
  }
  return totalDelta;
}

function savePrevPositions(people: PersonState[]): { x: number; y: number }[][] {
  return people.map(person => {
    if (person.pts.length < 33) return [];
    return getTrackedPoints(person.pts).map(p => ({ x: p.x, y: p.y }));
  });
}

export const redLightGreenLight: Experiment = {
  name: "red light green light",

  setup(ctx, ww, hh) {
    w = ww; h = hh;
    rc = new GameRoughCanvas(ctx.canvas);
    people = [];
    prevPositions = [];
    resetPhase('green');
    flashAlpha = 0;
    wigglePhase = 0;
  },

  update(_face, dt) {
    // Decay flash
    flashAlpha = Math.max(0, flashAlpha - dt * 1.5);
    wigglePhase += dt * 30;
  },

  updatePose(poses: Landmarks[], dt: number) {
    updatePeople(poses, people, dt, w);

    phaseTimer += dt;

    // Movement detection (always measure for debug, only trigger during red)
    if (people.length > 0) {
      lastMovement = measureMovement(people, prevPositions);
      if (phase === 'red' && lastMovement > MOVEMENT_THRESHOLD) {
        flashAlpha = 1;
        caught = true;
      }
    }

    // Save positions for next frame
    prevPositions = savePrevPositions(people);

    // Phase transitions
    if (phase === 'green' && phaseTimer > GREEN_DURATION) {
      resetPhase('countdown');
    } else if (phase === 'countdown' && phaseTimer > COUNTDOWN_DURATION) {
      resetPhase('red');
    } else if (phase === 'red' && phaseTimer > RED_DURATION) {
      resetPhase('green');
    }
  },

  demo() {
    people = [
      { ...makePerson(), pts: makeDemoPose(8), lPupilX: 7.5, lPupilY: 1.3, rPupilX: 8.5, rPupilY: 1.3, handPhase: 0 },
    ];
    phase = 'red';
    phaseTimer = 1;
    flashAlpha = 0;
    caught = false;
  },

  draw(ctx) {
    // Background tint based on phase
    if (phase === 'green') {
      drawEdgeTint(ctx, 'rgba(76, 175, 80, 0.15)');
    } else if (phase === 'countdown') {
      const t = phaseTimer / COUNTDOWN_DURATION;
      const r = Math.floor(76 + (244 - 76) * t);
      const g = Math.floor(175 + (67 - 175) * t);
      const b = Math.floor(80 + (54 - 80) * t);
      drawEdgeTint(ctx, `rgba(${r}, ${g}, ${b}, ${0.15 + t * 0.1})`);
    } else {
      drawEdgeTint(ctx, 'rgba(244, 67, 54, 0.2)');
    }

    // Flash overlay when caught moving — BIG and obvious
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 50, 50, ${flashAlpha * 0.7})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (people.length === 0) {
      pxText(ctx, 'stand back so the camera can see your body!', w / 2, h / 2, '600 0.4px Sora, sans-serif', stone, 'center');
      return;
    }

    // Draw people (with wiggle if caught)
    for (let i = 0; i < people.length; i++) {
      if (caught && flashAlpha > 0.1) {
        ctx.save();
        const shake = Math.sin(wigglePhase) * 0.5 * flashAlpha;
        ctx.translate(shake, 0);
        drawPerson(ctx, rc, people[i], i, i * 100);
        ctx.restore();
      } else {
        drawPerson(ctx, rc, people[i], i, i * 100);
      }
    }

    // Phase text
    if (phase === 'green') {
      pxText(ctx, 'GO!', w / 2, 1.2, '700 1.2px Fredoka, sans-serif', sage, 'center');
    } else if (phase === 'countdown') {
      const count = Math.ceil(COUNTDOWN_DURATION - phaseTimer);
      const pulse = 1 + Math.sin(phaseTimer * Math.PI * 2) * 0.15;
      ctx.save();
      ctx.translate(w / 2, 1.2);
      ctx.scale(pulse, pulse);
      pxText(ctx, String(count), 0, 0, '700 1.2px Fredoka, sans-serif', honey, 'center');
      ctx.restore();
    } else {
      pxText(ctx, 'FREEZE!', w / 2, 1.2, '700 1.2px Fredoka, sans-serif', rose, 'center');
    }

    // Debug: movement readout (console — canvas text fails at sub-pixel sizes)
    if (Math.random() < 0.03) {
      console.log(`[RLGL] move: ${lastMovement.toFixed(3)} / ${MOVEMENT_THRESHOLD}  phase: ${phase}  caught: ${caught}`);
    }
  },

  cleanup() {},
};

function drawEdgeTint(ctx: CanvasRenderingContext2D, color: string) {
  const size = 2;
  // Left edge
  const gl = ctx.createLinearGradient(0, 0, size, 0);
  gl.addColorStop(0, color);
  gl.addColorStop(1, 'transparent');
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, size, h);
  // Right edge
  const gr = ctx.createLinearGradient(w, 0, w - size, 0);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'transparent');
  ctx.fillStyle = gr;
  ctx.fillRect(w - size, 0, size, h);
  // Top edge
  const gt = ctx.createLinearGradient(0, 0, 0, size);
  gt.addColorStop(0, color);
  gt.addColorStop(1, 'transparent');
  ctx.fillStyle = gt;
  ctx.fillRect(0, 0, w, size);
  // Bottom edge
  const gb = ctx.createLinearGradient(0, h, 0, h - size);
  gb.addColorStop(0, color);
  gb.addColorStop(1, 'transparent');
  ctx.fillStyle = gb;
  ctx.fillRect(0, h - size, w, size);
}
