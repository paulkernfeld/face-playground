import type { Experiment, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { sage, honey, rose, stone, cream, charcoal } from '../palette';
import type { PersonState, LimbColors } from './creature-shared';
import {
  NOSE, L_EYE, R_EYE,
  L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW,
  L_WRIST, R_WRIST, L_HIP, R_HIP,
  L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
  L_MOUTH, R_MOUTH,
  updatePeople, drawPerson, makePerson, makeDemoPose,
} from './creature-shared';
import { getYogaPose } from '../yoga-classify';
import type { YogaPose } from '../yoga-classify';

// Angle triplets: [parent, vertex, child] — we measure the angle at the vertex
// This makes matching position-independent: only body shape matters
const ANGLE_TRIPLETS: [number, number, number][] = [
  [L_ELBOW, L_SHOULDER, L_HIP],    // left shoulder angle
  [R_ELBOW, R_SHOULDER, R_HIP],    // right shoulder angle
  [L_SHOULDER, L_ELBOW, L_WRIST],  // left elbow angle
  [R_SHOULDER, R_ELBOW, R_WRIST],  // right elbow angle
  [L_SHOULDER, L_HIP, L_KNEE],     // left hip angle
  [R_SHOULDER, R_HIP, R_KNEE],     // right hip angle
  [L_HIP, L_KNEE, L_ANKLE],        // left knee angle
  [R_HIP, R_KNEE, R_ANKLE],        // right knee angle
];


// Pose definitions: name + target positions (relative to center)
interface PoseDef {
  name: string;
  holdTime: number;  // seconds to hold
  classifyAs?: YogaPose; // when set, use getYogaPose() for hold detection
  // Offsets from center for each joint
  build(cx: number): { x: number; y: number }[];
}

const POSES: PoseDef[] = [
  {
    name: "mountain",
    holdTime: 3,
    classifyAs: "mountain",
    build(cx) {
      const p = new Array(33).fill({ x: cx, y: 4.5 }).map(v => ({ ...v }));
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      set(NOSE, cx, 1.5);
      set(L_EYE, cx - 0.5, 1.3); set(R_EYE, cx + 0.5, 1.3);
      set(L_SHOULDER, cx - 1.5, 3.0); set(R_SHOULDER, cx + 1.5, 3.0);
      // Arms relaxed at sides
      set(L_ELBOW, cx - 1.6, 4.2); set(R_ELBOW, cx + 1.6, 4.2);
      set(L_WRIST, cx - 1.5, 5.3); set(R_WRIST, cx + 1.5, 5.3);
      set(L_HIP, cx - 1.0, 5.5); set(R_HIP, cx + 1.0, 5.5);
      set(L_KNEE, cx - 1.0, 7.0); set(R_KNEE, cx + 1.0, 7.0);
      set(L_ANKLE, cx - 1.0, 8.5); set(R_ANKLE, cx + 1.0, 8.5);
      set(L_MOUTH, cx - 0.4, 1.9); set(R_MOUTH, cx + 0.4, 1.9);
      return p;
    },
  },
  {
    name: "volcano",
    holdTime: 3,
    classifyAs: "volcano",
    build(cx) {
      const p = new Array(33).fill({ x: cx, y: 4.5 }).map(v => ({ ...v }));
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      set(NOSE, cx, 1.5);
      set(L_EYE, cx - 0.5, 1.3); set(R_EYE, cx + 0.5, 1.3);
      set(L_SHOULDER, cx - 1.5, 3.0); set(R_SHOULDER, cx + 1.5, 3.0);
      // Arms straight up
      set(L_ELBOW, cx - 1.2, 1.8); set(R_ELBOW, cx + 1.2, 1.8);
      set(L_WRIST, cx - 0.8, 0.5); set(R_WRIST, cx + 0.8, 0.5);
      set(L_HIP, cx - 1.0, 5.5); set(R_HIP, cx + 1.0, 5.5);
      set(L_KNEE, cx - 1.2, 7.0); set(R_KNEE, cx + 1.2, 7.0);
      set(L_ANKLE, cx - 1.5, 8.5); set(R_ANKLE, cx + 1.5, 8.5);
      set(L_MOUTH, cx - 0.4, 1.9); set(R_MOUTH, cx + 0.4, 1.9);
      return p;
    },
  },
  {
    name: "T-pose",
    holdTime: 3,
    classifyAs: "tpose",
    build(cx) {
      return makeDemoPose(cx);
    },
  },
  {
    name: "tree pose",
    holdTime: 4,
    build(cx) {
      const p = new Array(33).fill({ x: cx, y: 4.5 }).map(v => ({ ...v }));
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      set(NOSE, cx, 1.3);
      set(L_EYE, cx - 0.5, 1.1); set(R_EYE, cx + 0.5, 1.1);
      set(L_SHOULDER, cx - 1.2, 2.8); set(R_SHOULDER, cx + 1.2, 2.8);
      // Arms up in namaste
      set(L_ELBOW, cx - 0.6, 1.8); set(R_ELBOW, cx + 0.6, 1.8);
      set(L_WRIST, cx - 0.1, 0.8); set(R_WRIST, cx + 0.1, 0.8);
      set(L_HIP, cx - 0.8, 5.2); set(R_HIP, cx + 0.8, 5.2);
      // Left leg straight, right foot on left knee
      set(L_KNEE, cx - 0.8, 6.8); set(R_KNEE, cx + 1.2, 5.5);
      set(L_ANKLE, cx - 0.8, 8.3); set(R_ANKLE, cx + 0.3, 6.8);
      set(L_MOUTH, cx - 0.3, 1.7); set(R_MOUTH, cx + 0.3, 1.7);
      return p;
    },
  },
  {
    name: "warrior II",
    holdTime: 4,
    build(cx) {
      const p = new Array(33).fill({ x: cx, y: 4.5 }).map(v => ({ ...v }));
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      set(NOSE, cx, 1.5);
      set(L_EYE, cx - 0.5, 1.3); set(R_EYE, cx + 0.5, 1.3);
      set(L_SHOULDER, cx - 1.5, 3.0); set(R_SHOULDER, cx + 1.5, 3.0);
      // Arms spread wide horizontally
      set(L_ELBOW, cx - 3.0, 3.0); set(R_ELBOW, cx + 3.0, 3.0);
      set(L_WRIST, cx - 4.2, 3.0); set(R_WRIST, cx + 4.2, 3.0);
      set(L_HIP, cx - 1.0, 5.5); set(R_HIP, cx + 1.0, 5.5);
      // Front knee bent, back leg straight
      set(L_KNEE, cx - 2.0, 6.5); set(R_KNEE, cx + 1.5, 7.0);
      set(L_ANKLE, cx - 2.5, 8.3); set(R_ANKLE, cx + 2.0, 8.3);
      set(L_MOUTH, cx - 0.3, 1.9); set(R_MOUTH, cx + 0.3, 1.9);
      return p;
    },
  },
  {
    name: "wide stance",
    holdTime: 3,
    build(cx) {
      const p = new Array(33).fill({ x: cx, y: 4.5 }).map(v => ({ ...v }));
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      set(NOSE, cx, 1.5);
      set(L_EYE, cx - 0.5, 1.3); set(R_EYE, cx + 0.5, 1.3);
      set(L_SHOULDER, cx - 1.5, 3.0); set(R_SHOULDER, cx + 1.5, 3.0);
      // Hands on hips
      set(L_ELBOW, cx - 2.2, 4.0); set(R_ELBOW, cx + 2.2, 4.0);
      set(L_WRIST, cx - 1.2, 5.0); set(R_WRIST, cx + 1.2, 5.0);
      set(L_HIP, cx - 1.0, 5.5); set(R_HIP, cx + 1.0, 5.5);
      // Wide leg stance
      set(L_KNEE, cx - 2.5, 7.0); set(R_KNEE, cx + 2.5, 7.0);
      set(L_ANKLE, cx - 3.0, 8.5); set(R_ANKLE, cx + 3.0, 8.5);
      set(L_MOUTH, cx - 0.4, 1.9); set(R_MOUTH, cx + 0.4, 1.9);
      return p;
    },
  },
];

let rc: GameRoughCanvas;
let w = 16, h = 9;
let people: PersonState[] = [];

// Pose sequence state
let currentPoseIdx = 0;
let holdTimer = 0;
let poseMatched = false; // whether classifier says player is in the right pose
let posesCompleted = 0;
let transitionTimer = 0;
const TRANSITION_DURATION = 2;
let inTransition = true;

// Per-angle accuracy for limb coloring
let jointAccuracies: number[] = [];
let playerLimbColors: LimbColors = {};

const LIMB_GOOD = 0.7; // angle accuracy threshold for "aligned"

/** Compute per-limb colors from angle accuracies. Good limbs = undefined (use palette), bad = charcoal */
function computeLimbColors(accs: number[]): LimbColors {
  if (accs.length < 8) return {};
  const ok = (i: number) => accs[i] >= LIMB_GOOD;
  // ANGLE_TRIPLETS indices: 0=L_SHOULDER, 1=R_SHOULDER, 2=L_ELBOW, 3=R_ELBOW,
  //                         4=L_HIP, 5=R_HIP, 6=L_KNEE, 7=R_KNEE
  return {
    lArm: ok(0) && ok(2) ? undefined : charcoal,
    rArm: ok(1) && ok(3) ? undefined : charcoal,
    lLeg: ok(4) && ok(6) ? undefined : charcoal,
    rLeg: ok(5) && ok(7) ? undefined : charcoal,
    body: ok(0) && ok(1) && ok(4) && ok(5) ? undefined : charcoal,
  };
}

/** Angle (radians) at vertex B formed by points A→B→C */
function angleAt(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const bax = a.x - b.x, bay = a.y - b.y;
  const bcx = c.x - b.x, bcy = c.y - b.y;
  const dot = bax * bcx + bay * bcy;
  const cross = bax * bcy - bay * bcx;
  return Math.atan2(Math.abs(cross), dot); // 0..π
}

function calcAccuracy(player: { x: number; y: number }[], target: { x: number; y: number }[]): { overall: number; joints: number[] } {
  const joints: number[] = [];
  let total = 0;

  for (const [a, b, c] of ANGLE_TRIPLETS) {
    if (a >= player.length || b >= player.length || c >= player.length ||
        a >= target.length || b >= target.length || c >= target.length) {
      joints.push(0);
      continue;
    }
    const playerAngle = angleAt(player[a], player[b], player[c]);
    const targetAngle = angleAt(target[a], target[b], target[c]);
    const diff = Math.abs(playerAngle - targetAngle);
    // Map angle difference to accuracy: 0 diff = 1.0, >45° = 0.0
    const acc = Math.max(0, 1 - diff / (Math.PI / 4));
    joints.push(acc);
    total += acc;
  }

  return { overall: total / ANGLE_TRIPLETS.length, joints };
}

function getCurrentTarget(): { x: number; y: number }[] {
  return POSES[currentPoseIdx].build(w * 0.5);
}

function advancePose() {
  currentPoseIdx = (currentPoseIdx + 1) % POSES.length;
  holdTimer = 0;
  inTransition = true;
  transitionTimer = 0;
  posesCompleted++;
}

export const yoga: Experiment = {
  name: "yoga",

  setup(ctx, ww, hh) {
    w = ww; h = hh;
    rc = new GameRoughCanvas(ctx.canvas);
    people = [];
    currentPoseIdx = 0;
    holdTimer = 0;
    poseMatched = false;
    posesCompleted = 0;
    inTransition = true;
    transitionTimer = 0;
    jointAccuracies = [];
  },

  update() {},

  updatePose(poses: Landmarks[], dt: number) {
    updatePeople(poses, people, dt, w);

    if (inTransition) {
      transitionTimer += dt;
      if (transitionTimer >= TRANSITION_DURATION) {
        inTransition = false;
      }
      return;
    }

    const pose = POSES[currentPoseIdx];

    if (people.length > 0 && people[0].pts.length >= 33) {
      const playerPts = people[0].pts;

      // Per-limb accuracy for coloring (always compare against target ghost)
      const targetPts = getCurrentTarget();
      const result = calcAccuracy(playerPts, targetPts);
      jointAccuracies = result.joints;
      playerLimbColors = computeLimbColors(jointAccuracies);

      // Hold detection: use classifier when available, otherwise angle accuracy
      if (pose.classifyAs) {
        poseMatched = getYogaPose(playerPts) === pose.classifyAs;
      } else {
        const overall = result.overall;
        poseMatched = overall >= 0.6;
      }

      if (poseMatched) {
        holdTimer += dt;
        if (holdTimer >= pose.holdTime) {
          advancePose();
        }
      } else {
        holdTimer = Math.max(0, holdTimer - dt * 0.5);
      }
    }
  },

  demo() {
    currentPoseIdx = 2; // T-pose
    holdTimer = 1.5;
    poseMatched = true;
    posesCompleted = 2;
    inTransition = false;
    transitionTimer = 0;

    // Player in T-pose with some limbs slightly off
    const playerPts = makeDemoPose(w * 0.5);
    // Shift left wrist down (bad left elbow angle)
    playerPts[L_WRIST] = { x: playerPts[L_WRIST].x, y: playerPts[L_WRIST].y + 1.0 };
    // Shift right knee out (bad right knee angle)
    playerPts[R_KNEE] = { x: playerPts[R_KNEE].x + 0.8, y: playerPts[R_KNEE].y };

    people = [{
      ...makePerson(),
      pts: playerPts,
      lPupilX: playerPts[L_EYE].x,
      lPupilY: playerPts[L_EYE].y,
      rPupilX: playerPts[R_EYE].x,
      rPupilY: playerPts[R_EYE].y,
      handPhase: 1.5,
    }];

    // Calculate limb coloring for demo
    const targetPts = POSES[2].build(w * 0.5);
    const result = calcAccuracy(playerPts, targetPts);
    jointAccuracies = result.joints;
    playerLimbColors = computeLimbColors(jointAccuracies);
  },

  draw(ctx) {
    // Draw player(s)
    if (people.length === 0) {
      pxText(ctx, 'stand back so the camera can see your body!', w / 2, h / 2, '600 0.4px Sora, sans-serif', stone, 'center');
      return;
    }

    // First player gets limb coloring; others draw normally
    drawPerson(ctx, rc, people[0], 0, 0, playerLimbColors);
    for (let i = 1; i < people.length; i++) {
      drawPerson(ctx, rc, people[i], i, i * 100);
    }

    // Pose name (top center)
    const pose = POSES[currentPoseIdx];
    pxText(ctx, pose.name, w / 2, 0.6, "bold 0.4px Fredoka, sans-serif", cream, "center");

    // Transition message
    if (inTransition) {
      const alpha = Math.max(0, 1 - transitionTimer / TRANSITION_DURATION);
      ctx.globalAlpha = alpha;
      pxText(ctx, `next: ${pose.name}`, w / 2, h / 2, "bold 0.5px Fredoka, sans-serif", honey, "center");
      ctx.globalAlpha = 1;
    }

    // Hold progress bar
    if (!inTransition) {
      const progress = holdTimer / pose.holdTime;
      const barW = 4;
      const barH = 0.25;
      const barX = w / 2 - barW / 2;
      const barY = h - 1.0;

      // Background
      rc.rectangle(barX, barY, barW, barH, {
        fill: 'rgba(255,255,255,0.1)', fillStyle: 'solid',
        stroke: 'rgba(255,255,255,0.2)', strokeWidth: 0.02,
        roughness: 0.5, seed: 700,
      });

      // Fill
      if (progress > 0.01) {
        const fillColor = poseMatched ? sage : rose;
        rc.rectangle(barX, barY, barW * Math.min(1, progress), barH, {
          fill: fillColor, fillStyle: 'solid', stroke: 'none',
          roughness: 0.8, seed: 701,
        });
      }

      // Hold time label
      const remaining = Math.max(0, pose.holdTime - holdTimer);
      pxText(ctx, `hold: ${remaining.toFixed(1)}s`, w / 2, barY - 0.15, "0.2px monospace", "rgba(255,255,255,0.5)", "center");
    }

    // Match status
    const statusColor = poseMatched ? sage : rose;
    const statusText = poseMatched ? "yes!" : "no";
    pxText(ctx, statusText, w - 0.3, 0.6, "bold 0.35px monospace", statusColor, "right");

    // Poses completed
    pxText(ctx, `poses: ${posesCompleted}`, 0.3, 0.6, "0.2px monospace", "rgba(255,255,255,0.4)");
  },
};
