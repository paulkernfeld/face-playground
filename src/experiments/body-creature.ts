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

const SMOOTH = 0.5;

// Colors
const BODY_COLOR = '#FF6B6B';
const L_ARM_COLOR = '#9B59B6';
const R_ARM_COLOR = '#2EC4B6';
const L_LEG_COLOR = '#FFD93D';
const R_LEG_COLOR = '#FF6B6B';
const HAT_COLOR = '#FFD93D';

let rc: GameRoughCanvas;
let w = 16, h = 9;

// Smoothed pose landmarks (game units, mirrored)
let pts: { x: number; y: number }[] = [];
let hasPose = false;

// Googly eye state — pupils lag behind via spring physics
let lPupilX = 0, lPupilY = 0, lPupilVx = 0, lPupilVy = 0;
let rPupilX = 0, rPupilY = 0, rPupilVx = 0, rPupilVy = 0;

// T-pose sparkle state
interface Spark {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}
let sparks: Spark[] = [];
let isTpose = false;
const SPARK_COLORS = ['#FFD93D', '#FF6B6B', '#2EC4B6', '#9B59B6', '#fff'];

function mirror(landmarks: Landmarks): { x: number; y: number }[] {
  return landmarks.map(l => ({ x: w - l.x, y: l.y }));
}

function smoothPts(target: { x: number; y: number }[]) {
  if (pts.length !== target.length) {
    pts = target.map(p => ({ ...p }));
    return;
  }
  for (let i = 0; i < target.length; i++) {
    pts[i].x = pts[i].x * SMOOTH + target[i].x * (1 - SMOOTH);
    pts[i].y = pts[i].y * SMOOTH + target[i].y * (1 - SMOOTH);
  }
}

function updatePupil(
  px: number, py: number, vx: number, vy: number,
  targetX: number, targetY: number, dt: number
): [number, number, number, number] {
  const stiffness = 120;
  const damping = 8;
  const ax = stiffness * (targetX - px) - damping * vx;
  const ay = stiffness * (targetY - py) - damping * vy;
  vx += ax * dt;
  vy += ay * dt;
  px += vx * dt;
  py += vy * dt;
  return [px, py, vx, vy];
}

export const bodyCreature: Experiment = {
  name: "body creature",

  setup(ctx, ww, hh) {
    w = ww; h = hh;
    rc = new GameRoughCanvas(ctx.canvas);
    pts = [];
    hasPose = false;
    sparks = [];
  },

  // face data not used — this experiment relies on pose
  update() {},

  updatePose(pose: Landmarks | null, dt: number) {
    if (!pose || pose.length < 33) {
      hasPose = false;
      return;
    }
    hasPose = true;
    const mirrored = mirror(pose);
    smoothPts(mirrored);

    // Update googly eye pupils (spring toward eye center)
    const eyeR = 0.35; // eye radius — pupil should stay inside
    const maxOff = eyeR * 0.5;

    [lPupilX, lPupilY, lPupilVx, lPupilVy] = updatePupil(
      lPupilX, lPupilY, lPupilVx, lPupilVy,
      pts[L_EYE].x, pts[L_EYE].y, dt
    );
    [rPupilX, rPupilY, rPupilVx, rPupilVy] = updatePupil(
      rPupilX, rPupilY, rPupilVx, rPupilVy,
      pts[R_EYE].x, pts[R_EYE].y, dt
    );

    // Clamp pupils inside eye radius
    function clampPupil(px: number, py: number, cx: number, cy: number): [number, number] {
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxOff) {
        return [cx + dx / dist * maxOff, cy + dy / dist * maxOff];
      }
      return [px, py];
    }
    [lPupilX, lPupilY] = clampPupil(lPupilX, lPupilY, pts[L_EYE].x, pts[L_EYE].y);
    [rPupilX, rPupilY] = clampPupil(rPupilX, rPupilY, pts[R_EYE].x, pts[R_EYE].y);

    // T-pose detection: both wrists near shoulder height, arms spread wide
    const shoulderY = (pts[L_SHOULDER].y + pts[R_SHOULDER].y) / 2;
    const lWristNearShoulder = Math.abs(pts[L_WRIST].y - shoulderY) < 1.0;
    const rWristNearShoulder = Math.abs(pts[R_WRIST].y - shoulderY) < 1.0;
    const armSpread = Math.abs(pts[L_WRIST].x - pts[R_WRIST].x);
    const shoulderWidth = Math.abs(pts[L_SHOULDER].x - pts[R_SHOULDER].x);
    isTpose = lWristNearShoulder && rWristNearShoulder && armSpread > shoulderWidth * 1.8;

    // Spawn sparks when in T-pose
    if (isTpose) {
      for (let i = 0; i < 3; i++) {
        const side = Math.random() < 0.5 ? L_WRIST : R_WRIST;
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4;
        sparks.push({
          x: pts[side].x, y: pts[side].y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          life: 1, maxLife: 0.5 + Math.random() * 0.8,
          color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
          size: 0.08 + Math.random() * 0.15,
        });
      }
    }

    // Update sparks
    for (const s of sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 3 * dt; // gravity
      s.life -= dt / s.maxLife;
    }
    sparks = sparks.filter(s => s.life > 0);
  },

  demo() {
    hasPose = true;
    // T-pose with sparkles
    const fakePose: { x: number; y: number }[] = new Array(33).fill({ x: 8, y: 4.5 });
    const set = (i: number, x: number, y: number) => { fakePose[i] = { x, y }; };
    set(NOSE, 8, 1.5);
    set(L_EYE, 7.5, 1.3); set(R_EYE, 8.5, 1.3);
    set(L_SHOULDER, 6.5, 3); set(R_SHOULDER, 9.5, 3);
    set(L_ELBOW, 4.5, 3); set(R_ELBOW, 11.5, 3);
    set(L_WRIST, 2.5, 3); set(R_WRIST, 13.5, 3);
    set(L_HIP, 7, 5.5); set(R_HIP, 9, 5.5);
    set(L_KNEE, 6.5, 7); set(R_KNEE, 9.5, 7);
    set(L_ANKLE, 6, 8.5); set(R_ANKLE, 10, 8.5);
    pts = fakePose;
    lPupilX = 7.5; lPupilY = 1.3;
    rPupilX = 8.5; rPupilY = 1.3;
    // Scatter some sparkles around the hands
    sparks = [];
    for (let i = 0; i < 30; i++) {
      const side = Math.random() < 0.5 ? 2.5 : 13.5;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 1.5;
      sparks.push({
        x: side + Math.cos(angle) * dist, y: 3 + Math.sin(angle) * dist,
        vx: 0, vy: 0,
        life: 0.3 + Math.random() * 0.7, maxLife: 1,
        color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
        size: 0.08 + Math.random() * 0.15,
      });
    }
  },

  draw(ctx) {
    if (!hasPose) {
      ctx.fillStyle = '#888';
      ctx.font = '600 0.4px Sora, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('stand back so the camera can see your body!', w / 2, h / 2);
      return;
    }

    const p = pts;

    // -- Body blob (shoulders → hips) --
    const bodyPath = [
      p[L_SHOULDER], p[R_SHOULDER], p[R_HIP], p[L_HIP],
    ];
    // Draw as a filled rough polygon
    const polyPoints: [number, number][] = bodyPath.map(pt => [pt.x, pt.y]);
    polyPoints.push([bodyPath[0].x, bodyPath[0].y]); // close
    rc.polygon(polyPoints, {
      fill: BODY_COLOR, fillStyle: 'cross-hatch', fillWeight: 0.04,
      stroke: BODY_COLOR, strokeWidth: 0.06, roughness: 1.5, seed: 1,
    });

    // -- Arms --
    drawLimb(L_SHOULDER, L_ELBOW, L_WRIST, L_ARM_COLOR, 10);
    drawLimb(R_SHOULDER, R_ELBOW, R_WRIST, R_ARM_COLOR, 20);

    // -- Legs --
    drawLimb(L_HIP, L_KNEE, L_ANKLE, L_LEG_COLOR, 30);
    drawLimb(R_HIP, R_KNEE, R_ANKLE, R_LEG_COLOR, 40);

    // -- Joint circles --
    const joints = [L_ELBOW, R_ELBOW, L_KNEE, R_KNEE];
    const jointColors = [L_ARM_COLOR, R_ARM_COLOR, L_LEG_COLOR, R_LEG_COLOR];
    joints.forEach((j, i) => {
      rc.circle(p[j].x, p[j].y, 0.4, {
        fill: jointColors[i], fillStyle: 'solid',
        stroke: '#333', strokeWidth: 0.03, roughness: 1.2, seed: 50 + i,
      });
    });

    // -- Googly eyes on head --
    drawGooglyEye(p[L_EYE].x, p[L_EYE].y, lPupilX, lPupilY, 60);
    drawGooglyEye(p[R_EYE].x, p[R_EYE].y, rPupilX, rPupilY, 70);

    // -- Party hat on head --
    const nose = p[NOSE];
    const hatH = 1.2;
    const hatW = 0.8;
    rc.polygon([
      [nose.x, nose.y - hatH],
      [nose.x - hatW / 2, nose.y],
      [nose.x + hatW / 2, nose.y],
      [nose.x, nose.y - hatH],
    ], {
      fill: HAT_COLOR, fillStyle: 'zigzag', fillWeight: 0.03,
      stroke: '#333', strokeWidth: 0.04, roughness: 1.5, seed: 80,
    });
    // Pom-pom on top
    rc.circle(nose.x, nose.y - hatH, 0.3, {
      fill: '#FF6B6B', fillStyle: 'solid',
      stroke: 'none', roughness: 1, seed: 81,
    });

    // -- Sparkles (T-pose) --
    for (const s of sparks) {
      const alpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = alpha;
      // Draw a 4-pointed star
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

    function drawLimb(a: number, b: number, c: number, color: string, seed: number) {
      rc.line(p[a].x, p[a].y, p[b].x, p[b].y, {
        stroke: color, strokeWidth: 0.12, roughness: 2, seed,
      });
      rc.line(p[b].x, p[b].y, p[c].x, p[c].y, {
        stroke: color, strokeWidth: 0.12, roughness: 2, seed: seed + 1,
      });
    }

    function drawGooglyEye(cx: number, cy: number, px: number, py: number, seed: number) {
      const eyeR = 0.35;
      // White of eye
      rc.circle(cx, cy, eyeR * 2, {
        fill: '#fff', fillStyle: 'solid',
        stroke: '#333', strokeWidth: 0.04, roughness: 1.2, seed,
      });
      // Pupil
      rc.circle(px, py, eyeR * 0.8, {
        fill: '#222', fillStyle: 'solid',
        stroke: 'none', roughness: 0.8, seed: seed + 1,
      });
      // Glint
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px + 0.06, py - 0.06, 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
