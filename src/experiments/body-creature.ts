import type { Experiment, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';

// Pose landmark indices
const NOSE = 0;
const L_EYE = 2, R_EYE = 5;
const L_SHOULDER = 11, R_SHOULDER = 12;
const L_ELBOW = 13, R_ELBOW = 14;
const L_WRIST = 15, R_WRIST = 16;
const L_HIP = 23, R_HIP = 24;
const L_KNEE = 25, R_KNEE = 26;
const L_ANKLE = 27, R_ANKLE = 28;
const L_MOUTH = 9, R_MOUTH = 10;

const SMOOTH = 0.5;

// Per-person color palettes
const PALETTES = [
  { body: '#FF6B6B', lArm: '#9B59B6', rArm: '#2EC4B6', lLeg: '#FFD93D', rLeg: '#FF6B6B', hat: '#FFD93D', smile: '#FF6B6B' },
  { body: '#4FC3F7', lArm: '#FF8A65', rArm: '#81C784', lLeg: '#BA68C8', rLeg: '#4FC3F7', hat: '#FF8A65', smile: '#4FC3F7' },
  { body: '#AED581', lArm: '#FFD54F', rArm: '#F06292', lLeg: '#4DD0E1', rLeg: '#AED581', hat: '#F06292', smile: '#AED581' },
  { body: '#FFB74D', lArm: '#7986CB', rArm: '#4DB6AC', lLeg: '#E57373', rLeg: '#FFB74D', hat: '#7986CB', smile: '#FFB74D' },
];

let rc: GameRoughCanvas;
let w = 16, h = 9;

// Per-person state
interface PersonState {
  pts: { x: number; y: number }[];
  lPupilX: number; lPupilY: number; lPupilVx: number; lPupilVy: number;
  rPupilX: number; rPupilY: number; rPupilVx: number; rPupilVy: number;
  handPhase: number; // animated hand wiggle phase
}
let people: PersonState[] = [];

// Sparkle particles (T-pose)
interface Spark {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}
let sparks: Spark[] = [];
const SPARK_COLORS = ['#FFD93D', '#FF6B6B', '#2EC4B6', '#9B59B6', '#fff'];

// Beach balls
interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  color1: string; color2: string;
  spin: number;
  seed: number;
}
let balls: Ball[] = [];
const BALL_R = 0.45;
const BOUNCE_DIST = 0.9;
const GRAVITY = 3;
const BALL_COLORS = [
  ['#FF6B6B', '#fff'], ['#4FC3F7', '#fff'], ['#FFD93D', '#fff'],
  ['#AED581', '#fff'], ['#BA68C8', '#fff'], ['#FF8A65', '#fff'],
];
let spawnTimer = 0;
const SPAWN_INTERVAL = 2.5;
const MAX_BALLS = 6;

function mirror(landmarks: Landmarks): { x: number; y: number }[] {
  return landmarks.map(l => ({ x: w - l.x, y: l.y }));
}

function smoothPts(existing: { x: number; y: number }[], target: { x: number; y: number }[]): { x: number; y: number }[] {
  if (existing.length !== target.length) return target.map(p => ({ ...p }));
  return existing.map((p, i) => ({
    x: p.x * SMOOTH + target[i].x * (1 - SMOOTH),
    y: p.y * SMOOTH + target[i].y * (1 - SMOOTH),
  }));
}

function updatePupil(
  px: number, py: number, vx: number, vy: number,
  targetX: number, targetY: number, dt: number
): [number, number, number, number] {
  const stiffness = 120, damping = 8;
  const ax = stiffness * (targetX - px) - damping * vx;
  const ay = stiffness * (targetY - py) - damping * vy;
  vx += ax * dt; vy += ay * dt;
  px += vx * dt; py += vy * dt;
  return [px, py, vx, vy];
}

function ptDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function spawnBall() {
  const colors = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
  balls.push({
    x: 1 + Math.random() * (w - 2),
    y: -BALL_R,
    vx: (Math.random() - 0.5) * 2,
    vy: 0.5 + Math.random(),
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
  },

  update() {},

  updatePose(poses: Landmarks[], dt: number) {
    // Grow/shrink people array to match detected count
    while (people.length < poses.length) {
      people.push({
        pts: [], lPupilX: 0, lPupilY: 0, lPupilVx: 0, lPupilVy: 0,
        rPupilX: 0, rPupilY: 0, rPupilVx: 0, rPupilVy: 0, handPhase: Math.random() * Math.PI * 2,
      });
    }
    if (poses.length < people.length) people.length = poses.length;

    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i];
      if (pose.length < 33) continue;
      const person = people[i];
      const mirrored = mirror(pose);
      person.pts = smoothPts(person.pts, mirrored);
      person.handPhase += dt * 8;

      const p = person.pts;
      const eyeR = 0.35, maxOff = eyeR * 0.5;

      [person.lPupilX, person.lPupilY, person.lPupilVx, person.lPupilVy] = updatePupil(
        person.lPupilX, person.lPupilY, person.lPupilVx, person.lPupilVy,
        p[L_EYE].x, p[L_EYE].y, dt
      );
      [person.rPupilX, person.rPupilY, person.rPupilVx, person.rPupilVy] = updatePupil(
        person.rPupilX, person.rPupilY, person.rPupilVx, person.rPupilVy,
        p[R_EYE].x, p[R_EYE].y, dt
      );

      // Clamp pupils
      for (const side of ['l', 'r'] as const) {
        const eyeIdx = side === 'l' ? L_EYE : R_EYE;
        const px = side === 'l' ? person.lPupilX : person.rPupilX;
        const py = side === 'l' ? person.lPupilY : person.rPupilY;
        const dx = px - p[eyeIdx].x, dy = py - p[eyeIdx].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxOff) {
          if (side === 'l') { person.lPupilX = p[eyeIdx].x + dx / d * maxOff; person.lPupilY = p[eyeIdx].y + dy / d * maxOff; }
          else { person.rPupilX = p[eyeIdx].x + dx / d * maxOff; person.rPupilY = p[eyeIdx].y + dy / d * maxOff; }
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
            ball.vx = nx * 4 + (Math.random() - 0.5) * 2;
            ball.vy = -3 - Math.random() * 3;
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
    for (const s of sparks) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vy += 3 * dt;
      s.life -= dt / s.maxLife;
    }
    sparks = sparks.filter(s => s.life > 0);
  },

  demo() {
    const makePose = (cx: number): { x: number; y: number }[] => {
      const p: { x: number; y: number }[] = new Array(33).fill({ x: cx, y: 4.5 });
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      set(NOSE, cx, 1.5);
      set(L_EYE, cx - 0.5, 1.3); set(R_EYE, cx + 0.5, 1.3);
      set(L_SHOULDER, cx - 1.5, 3); set(R_SHOULDER, cx + 1.5, 3);
      set(L_ELBOW, cx - 2.5, 2.5); set(R_ELBOW, cx + 2.5, 2.5);
      set(L_WRIST, cx - 3, 1.8); set(R_WRIST, cx + 3, 1.8);
      set(L_HIP, cx - 1, 5.5); set(R_HIP, cx + 1, 5.5);
      set(L_KNEE, cx - 1.2, 7); set(R_KNEE, cx + 1.2, 7);
      set(L_ANKLE, cx - 1.5, 8.5); set(R_ANKLE, cx + 1.5, 8.5);
      set(L_MOUTH, cx - 0.4, 1.9); set(R_MOUTH, cx + 0.4, 1.9);
      return p;
    };
    people = [
      { pts: makePose(5), lPupilX: 4.5, lPupilY: 1.3, lPupilVx: 0, lPupilVy: 0, rPupilX: 5.5, rPupilY: 1.3, rPupilVx: 0, rPupilVy: 0, handPhase: 0 },
      { pts: makePose(11), lPupilX: 10.5, lPupilY: 1.3, lPupilVx: 0, lPupilVy: 0, rPupilX: 11.5, rPupilY: 1.3, rPupilVx: 0, rPupilVy: 0, handPhase: 2 },
    ];
    balls = [
      { x: 8, y: 3, vx: 0, vy: 0, r: BALL_R, color1: '#FF6B6B', color2: '#fff', spin: 0.3, seed: 500 },
      { x: 3, y: 5, vx: 0, vy: 0, r: BALL_R, color1: '#4FC3F7', color2: '#fff', spin: -0.5, seed: 501 },
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
      ctx.fillStyle = '#888';
      ctx.font = '600 0.4px Sora, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('stand back so the camera can see your body!', w / 2, h / 2);
      return;
    }

    // Beach balls (behind people)
    for (const ball of balls) {
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.spin);
      rc.circle(0, 0, ball.r * 2, {
        fill: ball.color1, fillStyle: 'solid',
        stroke: '#333', strokeWidth: 0.03, roughness: 1.2, seed: ball.seed,
      });
      rc.line(-ball.r * 0.7, -ball.r * 0.3, ball.r * 0.7, -ball.r * 0.3, {
        stroke: ball.color2, strokeWidth: 0.08, roughness: 1, seed: ball.seed + 1,
      });
      rc.line(-ball.r * 0.5, ball.r * 0.3, ball.r * 0.5, ball.r * 0.3, {
        stroke: ball.color2, strokeWidth: 0.06, roughness: 1, seed: ball.seed + 2,
      });
      ctx.restore();
    }

    // Each person
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const p = person.pts;
      const pal = PALETTES[i % PALETTES.length];
      const seedBase = i * 100;

      // Body blob
      const bodyPath: [number, number][] = [
        [p[L_SHOULDER].x, p[L_SHOULDER].y],
        [p[R_SHOULDER].x, p[R_SHOULDER].y],
        [p[R_HIP].x, p[R_HIP].y],
        [p[L_HIP].x, p[L_HIP].y],
        [p[L_SHOULDER].x, p[L_SHOULDER].y],
      ];
      rc.polygon(bodyPath, {
        fill: pal.body, fillStyle: 'cross-hatch', fillWeight: 0.04,
        stroke: pal.body, strokeWidth: 0.06, roughness: 1.5, seed: seedBase + 1,
      });

      // Arms + legs
      drawLimb(p, L_SHOULDER, L_ELBOW, L_WRIST, pal.lArm, seedBase + 10);
      drawLimb(p, R_SHOULDER, R_ELBOW, R_WRIST, pal.rArm, seedBase + 20);
      drawLimb(p, L_HIP, L_KNEE, L_ANKLE, pal.lLeg, seedBase + 30);
      drawLimb(p, R_HIP, R_KNEE, R_ANKLE, pal.rLeg, seedBase + 40);

      // Joint circles
      const joints = [L_ELBOW, R_ELBOW, L_KNEE, R_KNEE];
      const jColors = [pal.lArm, pal.rArm, pal.lLeg, pal.rLeg];
      joints.forEach((j, ji) => {
        rc.circle(p[j].x, p[j].y, 0.4, {
          fill: jColors[ji], fillStyle: 'solid',
          stroke: '#333', strokeWidth: 0.03, roughness: 1.2, seed: seedBase + 50 + ji,
        });
      });

      // Animated hands — pulsing circles with finger nubs
      for (const wristIdx of [L_WRIST, R_WRIST]) {
        const phase = person.handPhase + (wristIdx === R_WRIST ? Math.PI : 0);
        const pulse = 0.3 + Math.sin(phase) * 0.08;
        const wiggleX = Math.sin(phase * 1.3) * 0.05;
        const wiggleY = Math.cos(phase * 0.9) * 0.05;
        const hx = p[wristIdx].x + wiggleX;
        const hy = p[wristIdx].y + wiggleY;
        const color = wristIdx === L_WRIST ? pal.lArm : pal.rArm;
        rc.circle(hx, hy, pulse * 2, {
          fill: color, fillStyle: 'solid',
          stroke: '#333', strokeWidth: 0.03, roughness: 1.3, seed: seedBase + 90 + wristIdx,
        });
        for (let f = 0; f < 4; f++) {
          const fAngle = -0.6 + f * 0.4 + (wristIdx === L_WRIST ? Math.PI : 0);
          const fx = hx + Math.cos(fAngle) * (pulse + 0.05);
          const fy = hy + Math.sin(fAngle) * (pulse + 0.05);
          rc.circle(fx, fy, 0.1, {
            fill: color, fillStyle: 'solid', stroke: 'none', roughness: 0.8,
            seed: seedBase + 95 + wristIdx * 10 + f,
          });
        }
      }

      // Googly eyes
      drawGooglyEye(ctx, p[L_EYE].x, p[L_EYE].y, person.lPupilX, person.lPupilY, seedBase + 60);
      drawGooglyEye(ctx, p[R_EYE].x, p[R_EYE].y, person.rPupilX, person.rPupilY, seedBase + 70);

      // Party hat
      const headCx = (p[L_EYE].x + p[R_EYE].x) / 2;
      const eyeY = (p[L_EYE].y + p[R_EYE].y) / 2;
      const faceH = p[NOSE].y - eyeY;
      const headTopY = eyeY - faceH * 1.8;
      const hatH = faceH * 3.5;
      const hatW = faceH * 1.6;
      rc.polygon([
        [headCx, headTopY - hatH],
        [headCx - hatW / 2, headTopY],
        [headCx + hatW / 2, headTopY],
        [headCx, headTopY - hatH],
      ], {
        fill: pal.hat, fillStyle: 'zigzag', fillWeight: 0.03,
        stroke: '#333', strokeWidth: 0.04, roughness: 1.5, seed: seedBase + 80,
      });
      rc.circle(headCx, headTopY - hatH, 0.3, {
        fill: pal.body, fillStyle: 'solid', stroke: 'none', roughness: 1, seed: seedBase + 81,
      });

      // Smile
      const lm = p[L_MOUTH], rm = p[R_MOUTH];
      const mCx = (lm.x + rm.x) / 2, mCy = (lm.y + rm.y) / 2;
      const mW = Math.abs(rm.x - lm.x);
      ctx.beginPath();
      ctx.moveTo(lm.x, lm.y);
      ctx.quadraticCurveTo(mCx, mCy + mW * 0.25, rm.x, rm.y);
      ctx.strokeStyle = pal.smile;
      ctx.lineWidth = 0.08;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Sparkles on top
    for (const s of sparks) {
      ctx.fillStyle = s.color;
      ctx.globalAlpha = Math.max(0, s.life);
      const sz = s.size;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - sz);
      ctx.lineTo(s.x + sz * 0.3, s.y - sz * 0.3);
      ctx.lineTo(s.x + sz, s.y);
      ctx.lineTo(s.x + sz * 0.3, s.y + sz * 0.3);
      ctx.lineTo(s.x, s.y + sz);
      ctx.lineTo(s.x - sz * 0.3, s.y + sz * 0.3);
      ctx.lineTo(s.x - sz, s.y);
      ctx.lineTo(s.x - sz * 0.3, s.y - sz * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    function drawLimb(p: { x: number; y: number }[], a: number, b: number, c: number, color: string, seed: number) {
      rc.line(p[a].x, p[a].y, p[b].x, p[b].y, { stroke: color, strokeWidth: 0.12, roughness: 2, seed });
      rc.line(p[b].x, p[b].y, p[c].x, p[c].y, { stroke: color, strokeWidth: 0.12, roughness: 2, seed: seed + 1 });
    }

    function drawGooglyEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, px: number, py: number, seed: number) {
      const eyeR = 0.35;
      rc.circle(cx, cy, eyeR * 2, { fill: '#fff', fillStyle: 'solid', stroke: '#333', strokeWidth: 0.04, roughness: 1.2, seed });
      rc.circle(px, py, eyeR * 0.8, { fill: '#222', fillStyle: 'solid', stroke: 'none', roughness: 0.8, seed: seed + 1 });
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px + 0.06, py - 0.06, 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
