import type { Experiment, FaceData, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { BALL_COLORS as PALETTE_BALL_COLORS, charcoal, rose, sage, stone, honey, terra } from '../palette';
import type { PersonState, Spark } from './creature-shared';
import {
  SPARK_COLORS,
  L_WRIST, R_WRIST, L_SHOULDER, R_SHOULDER,
  updatePeople, ptDist,
  drawPerson, drawSparks, updateSparks, makeDemoPose, makePerson,
} from './creature-shared';

let rc: GameRoughCanvas;
let w = 16, h = 9;
let people: PersonState[] = [];
let sparks: Spark[] = [];
let mirroredFaceLandmarks: { x: number; y: number }[] | undefined;

// Apple state
const APPLE_R = 0.4;
const GRAB_DIST = 0.9;
let appleX = 0, appleY = 0;
let appleAlive = false;
let appleSeed = 200;

const APPLE_PARTICLE_COLORS = [rose, rose, terra, sage, sage, honey];

function spawnApple() {
  appleX = 1.5 + Math.random() * (w - 3);
  appleY = 1.5 + Math.random() * (h - 3);
  appleAlive = true;
  appleSeed = 200 + Math.floor(Math.random() * 1000);
}

function explodeApple(x: number, y: number) {
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 5;
    sparks.push({
      x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
      life: 1, maxLife: 0.4 + Math.random() * 0.6,
      color: APPLE_PARTICLE_COLORS[Math.floor(Math.random() * APPLE_PARTICLE_COLORS.length)],
      size: 0.06 + Math.random() * 0.12,
    });
  }
}

// Beach balls
interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  color1: string; color2: string;
  spin: number;
  seed: number;
}
let audioCtx: AudioContext | null = null;

function playDing() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.25);
}

let balls: Ball[] = [];
const BALL_R = 0.8;
const BOUNCE_DIST = 1.2;
const GRAVITY = 1.5;
const BALL_COLORS = PALETTE_BALL_COLORS;
let spawnTimer = 0;
const SPAWN_INTERVAL = 6;
const MAX_BALLS = 1;

function spawnBall() {
  const colors = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
  balls.push({
    x: 1 + Math.random() * (w - 2),
    y: -BALL_R,
    vx: (Math.random() - 0.5) * 2,
    vy: 0.3 + Math.random() * 0.5,
    r: BALL_R,
    color1: colors[0], color2: colors[1],
    spin: 0,
    seed: Math.floor(Math.random() * 10000),
  });
}

export const bodyCreature: Experiment = {
  name: "body creature",

  setup(ctx, ww, hh) {
    w = ww; h = hh;
    rc = new GameRoughCanvas(ctx.canvas);
    people = [];
    sparks = [];
    balls = [];
    spawnTimer = 0;
    appleAlive = false;
    mirroredFaceLandmarks = undefined;
  },

  update(face: FaceData | null) {
    if (face && face.landmarks.length >= 468) {
      // Mirror face landmarks to match how body creature mirrors pose landmarks
      mirroredFaceLandmarks = face.landmarks.map(l => ({ x: w - l.x, y: l.y }));
    } else {
      mirroredFaceLandmarks = undefined;
    }
  },

  updatePose(poses: Landmarks[], dt: number) {
    // Shared smoothing + pupil physics
    updatePeople(poses, people, dt, w);

    // Spawn apple if none exists
    if (!appleAlive && poses.length > 0) spawnApple();

    for (let i = 0; i < people.length; i++) {
      const p = people[i].pts;
      if (p.length < 33) continue;

      // Apple collision
      if (appleAlive) {
        for (const wristIdx of [L_WRIST, R_WRIST]) {
          if (ptDist(p[wristIdx].x, p[wristIdx].y, appleX, appleY) < GRAB_DIST) {
            explodeApple(appleX, appleY);
            playDing();
            appleAlive = false;
            break;
          }
        }
      }

      // T-pose sparkles
      const shoulderY = (p[L_SHOULDER].y + p[R_SHOULDER].y) / 2;
      const lNear = Math.abs(p[L_WRIST].y - shoulderY) < 1.0;
      const rNear = Math.abs(p[R_WRIST].y - shoulderY) < 1.0;
      const spread = Math.abs(p[L_WRIST].x - p[R_WRIST].x);
      const shoulderW = Math.abs(p[L_SHOULDER].x - p[R_SHOULDER].x);
      if (lNear && rNear && spread > shoulderW * 1.8) {
        for (let j = 0; j < 3; j++) {
          const wrist = Math.random() < 0.5 ? L_WRIST : R_WRIST;
          const angle = Math.random() * Math.PI * 2;
          const speed = 1 + Math.random() * 4;
          sparks.push({
            x: p[wrist].x, y: p[wrist].y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
            life: 1, maxLife: 0.5 + Math.random() * 0.8,
            color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
            size: 0.08 + Math.random() * 0.15,
          });
        }
      }

      // Bounce beach balls with hands
      for (const ball of balls) {
        for (const wristIdx of [L_WRIST, R_WRIST]) {
          const d = ptDist(p[wristIdx].x, p[wristIdx].y, ball.x, ball.y);
          if (d < BOUNCE_DIST + ball.r) {
            const nx = (ball.x - p[wristIdx].x) / (d || 0.01);
            const ny = (ball.y - p[wristIdx].y) / (d || 0.01);
            ball.vx = nx * 2 + (Math.random() - 0.5);
            ball.vy = -2 - Math.random() * 1.5;
            ball.x = p[wristIdx].x + nx * (BOUNCE_DIST + ball.r);
            ball.y = p[wristIdx].y + ny * (BOUNCE_DIST + ball.r);
          }
        }
      }
    }

    // Spawn beach balls
    spawnTimer += dt;
    if (spawnTimer > SPAWN_INTERVAL && balls.length < MAX_BALLS) {
      spawnBall();
      spawnTimer = 0;
    }

    // Update beach balls
    for (const ball of balls) {
      ball.vy += GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.spin += ball.vx * dt * 2;
      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx) * 0.8; }
      if (ball.x > w - ball.r) { ball.x = w - ball.r; ball.vx = -Math.abs(ball.vx) * 0.8; }
    }
    balls = balls.filter(b => b.y < h + 2);

    // Update sparks
    sparks = updateSparks(sparks, dt);
  },

  demo() {
    people = [
      { ...makePerson(), pts: makeDemoPose(5), lPupilX: 4.5, lPupilY: 1.3, rPupilX: 5.5, rPupilY: 1.3, handPhase: 0 },
      { ...makePerson(), pts: makeDemoPose(11), lPupilX: 10.5, lPupilY: 1.3, rPupilX: 11.5, rPupilY: 1.3, handPhase: 2 },
    ];
    balls = [
      { x: 8, y: 3, vx: 0, vy: 0, r: BALL_R, color1: BALL_COLORS[0][0], color2: BALL_COLORS[0][1], spin: 0.3, seed: 500 },
      { x: 3, y: 5, vx: 0, vy: 0, r: BALL_R, color1: BALL_COLORS[1][0], color2: BALL_COLORS[1][1], spin: -0.5, seed: 501 },
    ];
    sparks = [];
    for (let i = 0; i < 15; i++) {
      const cx = Math.random() < 0.5 ? 2 : 14;
      const angle = Math.random() * Math.PI * 2;
      const d = Math.random() * 1.2;
      sparks.push({
        x: cx + Math.cos(angle) * d, y: 2 + Math.sin(angle) * d,
        vx: 0, vy: 0, life: 0.3 + Math.random() * 0.7, maxLife: 1,
        color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
        size: 0.08 + Math.random() * 0.15,
      });
    }
  },

  draw(ctx) {
    if (people.length === 0) {
      pxText(ctx, 'stand back so the camera can see your body!', w / 2, h / 2, '600 0.4px Sora, sans-serif', stone, 'center');
      return;
    }

    // Apple
    if (appleAlive) {
      rc.circle(appleX, appleY, APPLE_R * 2, {
        fill: rose, fillStyle: 'solid',
        stroke: terra, strokeWidth: 0.04, roughness: 1.3, seed: appleSeed,
      });
      rc.line(appleX, appleY - APPLE_R, appleX + 0.1, appleY - APPLE_R - 0.25, {
        stroke: charcoal, strokeWidth: 0.05, roughness: 1.5, seed: appleSeed + 1,
      });
      rc.arc(appleX + 0.1, appleY - APPLE_R - 0.15, 0.25, 0.15, 0, Math.PI, false, {
        fill: sage, fillStyle: 'solid',
        stroke: sage, strokeWidth: 0.02, roughness: 1.2, seed: appleSeed + 2,
      });
    }

    // Beach balls (behind people)
    for (const ball of balls) {
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.spin);
      rc.circle(0, 0, ball.r * 2, {
        fill: ball.color1, fillStyle: 'solid',
        stroke: charcoal, strokeWidth: 0.03, roughness: 1.2, seed: ball.seed,
      });
      rc.line(-ball.r * 0.7, -ball.r * 0.3, ball.r * 0.7, -ball.r * 0.3, {
        stroke: ball.color2, strokeWidth: 0.08, roughness: 1, seed: ball.seed + 1,
      });
      rc.line(-ball.r * 0.5, ball.r * 0.3, ball.r * 0.5, ball.r * 0.3, {
        stroke: ball.color2, strokeWidth: 0.06, roughness: 1, seed: ball.seed + 2,
      });
      ctx.restore();
    }

    // Each person (pass face landmarks only to first person — FaceMesh detects one face)
    for (let i = 0; i < people.length; i++) {
      drawPerson(ctx, rc, people[i], i, i * 100, undefined, i === 0 ? mirroredFaceLandmarks : undefined);
    }

    // Sparkles on top
    drawSparks(ctx, sparks);
  },

  cleanup() {
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
  },
};
