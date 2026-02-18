import type { Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { CREATURE_PALETTES, SPARK_COLORS as PALETTE_SPARK_COLORS, charcoal, cream, ink } from '../palette';

// Pose landmark indices
export const NOSE = 0;
export const L_EYE = 2, R_EYE = 5;
export const L_SHOULDER = 11, R_SHOULDER = 12;
export const L_ELBOW = 13, R_ELBOW = 14;
export const L_WRIST = 15, R_WRIST = 16;
export const L_HIP = 23, R_HIP = 24;
export const L_KNEE = 25, R_KNEE = 26;
export const L_ANKLE = 27, R_ANKLE = 28;
export const L_MOUTH = 9, R_MOUTH = 10;

const SMOOTH = 0.5;

// Re-export palette colors for consumers
export const PALETTES = CREATURE_PALETTES;

export interface PersonState {
  pts: { x: number; y: number }[];
  lPupilX: number; lPupilY: number; lPupilVx: number; lPupilVy: number;
  rPupilX: number; rPupilY: number; rPupilVx: number; rPupilVy: number;
  handPhase: number;
}

export interface Spark {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

export const SPARK_COLORS = PALETTE_SPARK_COLORS;

export function makePerson(): PersonState {
  return {
    pts: [], lPupilX: 0, lPupilY: 0, lPupilVx: 0, lPupilVy: 0,
    rPupilX: 0, rPupilY: 0, rPupilVx: 0, rPupilVy: 0, handPhase: Math.random() * Math.PI * 2,
  };
}

export function mirror(landmarks: Landmarks, w: number): { x: number; y: number }[] {
  return landmarks.map(l => ({ x: w - l.x, y: l.y }));
}

export function smoothPts(existing: { x: number; y: number }[], target: { x: number; y: number }[]): { x: number; y: number }[] {
  if (existing.length !== target.length) return target.map(p => ({ ...p }));
  return existing.map((p, i) => ({
    x: p.x * SMOOTH + target[i].x * (1 - SMOOTH),
    y: p.y * SMOOTH + target[i].y * (1 - SMOOTH),
  }));
}

export function updatePupil(
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

export function ptDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Update people array to match poses, apply smoothing + pupil physics */
export function updatePeople(poses: Landmarks[], people: PersonState[], dt: number, w: number): void {
  while (people.length < poses.length) people.push(makePerson());
  if (poses.length < people.length) people.length = poses.length;

  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    if (pose.length < 33) continue;
    const person = people[i];
    const mirrored = mirror(pose, w);
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
  }
}

/** Draw a single person with all body parts */
export function drawPerson(
  ctx: CanvasRenderingContext2D, rc: GameRoughCanvas,
  person: PersonState, paletteIndex: number, seedBase: number
): void {
  const p = person.pts;
  if (p.length < 33) return;
  const pal = PALETTES[paletteIndex % PALETTES.length];

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
  drawLimb(rc, p, L_SHOULDER, L_ELBOW, L_WRIST, pal.lArm, seedBase + 10);
  drawLimb(rc, p, R_SHOULDER, R_ELBOW, R_WRIST, pal.rArm, seedBase + 20);
  drawLimb(rc, p, L_HIP, L_KNEE, L_ANKLE, pal.lLeg, seedBase + 30);
  drawLimb(rc, p, R_HIP, R_KNEE, R_ANKLE, pal.rLeg, seedBase + 40);

  // Joint circles
  const joints = [L_ELBOW, R_ELBOW, L_KNEE, R_KNEE];
  const jColors = [pal.lArm, pal.rArm, pal.lLeg, pal.rLeg];
  joints.forEach((j, ji) => {
    rc.circle(p[j].x, p[j].y, 0.4, {
      fill: jColors[ji], fillStyle: 'solid',
      stroke: charcoal, strokeWidth: 0.03, roughness: 1.2, seed: seedBase + 50 + ji,
    });
  });

  // Animated hands
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
      stroke: charcoal, strokeWidth: 0.03, roughness: 1.3, seed: seedBase + 90 + wristIdx,
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
  drawGooglyEye(ctx, rc, p[L_EYE].x, p[L_EYE].y, person.lPupilX, person.lPupilY, seedBase + 60);
  drawGooglyEye(ctx, rc, p[R_EYE].x, p[R_EYE].y, person.rPupilX, person.rPupilY, seedBase + 70);

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
    stroke: charcoal, strokeWidth: 0.04, roughness: 1.5, seed: seedBase + 80,
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

function drawLimb(rc: GameRoughCanvas, p: { x: number; y: number }[], a: number, b: number, c: number, color: string, seed: number) {
  rc.line(p[a].x, p[a].y, p[b].x, p[b].y, { stroke: color, strokeWidth: 0.12, roughness: 2, seed });
  rc.line(p[b].x, p[b].y, p[c].x, p[c].y, { stroke: color, strokeWidth: 0.12, roughness: 2, seed: seed + 1 });
}

function drawGooglyEye(ctx: CanvasRenderingContext2D, rc: GameRoughCanvas, cx: number, cy: number, px: number, py: number, seed: number) {
  const eyeR = 0.35;
  rc.circle(cx, cy, eyeR * 2, { fill: cream, fillStyle: 'solid', stroke: charcoal, strokeWidth: 0.04, roughness: 1.2, seed });
  rc.circle(px, py, eyeR * 0.8, { fill: ink, fillStyle: 'solid', stroke: 'none', roughness: 0.8, seed: seed + 1 });
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px + 0.06, py - 0.06, 0.06, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw all spark particles */
export function drawSparks(ctx: CanvasRenderingContext2D, sparks: Spark[]): void {
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
}

/** Update spark physics, return filtered array */
export function updateSparks(sparks: Spark[], dt: number): Spark[] {
  for (const s of sparks) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.vy += 3 * dt;
    s.life -= dt / s.maxLife;
  }
  return sparks.filter(s => s.life > 0);
}

/** Make a demo pose centered at cx */
export function makeDemoPose(cx: number): { x: number; y: number }[] {
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
}
