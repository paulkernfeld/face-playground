import type { Experiment, Landmarks } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import type { PersonState } from './creature-shared';
import {
  NOSE, L_EYE, R_EYE,
  L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW,
  L_WRIST, R_WRIST, L_HIP, R_HIP,
  L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
  L_MOUTH, R_MOUTH,
  updatePeople, drawPerson, makePerson, makeDemoPose,
} from './creature-shared';

// Joint pairs for accuracy comparison
const COMPARE_JOINTS = [
  L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW,
  L_WRIST, R_WRIST, L_HIP, R_HIP,
  L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
];

// Pose definitions: name + target positions (relative to center)
interface PoseDef {
  name: string;
  holdTime: number;  // seconds to hold
  // Offsets from center for each joint
  build(cx: number): { x: number; y: number }[];
}

const POSES: PoseDef[] = [
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
    name: "T-pose",
    holdTime: 3,
    build(cx) {
      return makeDemoPose(cx);
    },
  },
  {
    name: "arms up",
    holdTime: 3,
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
let poseAccuracy = 0;
const ACCURACY_THRESHOLD = 0.6; // accuracy needed to count as "holding"
let posesCompleted = 0;
let transitionTimer = 0;
const TRANSITION_DURATION = 2;
let inTransition = true;

// Per-joint accuracy for visualization
let jointAccuracies: number[] = [];

// Target ghost person
let targetPerson: PersonState;

function calcAccuracy(player: { x: number; y: number }[], target: { x: number; y: number }[]): { overall: number; joints: number[] } {
  const joints: number[] = [];
  let total = 0;

  for (const idx of COMPARE_JOINTS) {
    if (idx >= player.length || idx >= target.length) {
      joints.push(0);
      continue;
    }
    const dx = player[idx].x - target[idx].x;
    const dy = player[idx].y - target[idx].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Map distance to accuracy: 0 dist = 1.0, >2.0 dist = 0.0
    const acc = Math.max(0, 1 - dist / 2.0);
    joints.push(acc);
    total += acc;
  }

  return { overall: total / COMPARE_JOINTS.length, joints };
}

function getCurrentTarget(): { x: number; y: number }[] {
  return POSES[currentPoseIdx].build(w * 0.3);
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
    poseAccuracy = 0;
    posesCompleted = 0;
    inTransition = true;
    transitionTimer = 0;
    jointAccuracies = [];

    targetPerson = {
      ...makePerson(),
      pts: getCurrentTarget(),
    };
  },

  update() {},

  updatePose(poses: Landmarks[], dt: number) {
    updatePeople(poses, people, dt, w);

    // Update target ghost's pose
    targetPerson.pts = getCurrentTarget();

    if (inTransition) {
      transitionTimer += dt;
      if (transitionTimer >= TRANSITION_DURATION) {
        inTransition = false;
      }
      return;
    }

    // Calculate accuracy
    if (people.length > 0 && people[0].pts.length >= 33) {
      const result = calcAccuracy(people[0].pts, targetPerson.pts);
      poseAccuracy = poseAccuracy * 0.8 + result.overall * 0.2;
      jointAccuracies = result.joints;

      // Count hold time when accuracy is good enough
      if (poseAccuracy >= ACCURACY_THRESHOLD) {
        holdTimer += dt;
        if (holdTimer >= POSES[currentPoseIdx].holdTime) {
          advancePose();
        }
      } else {
        // Decay hold timer slowly when not matching
        holdTimer = Math.max(0, holdTimer - dt * 0.5);
      }
    }
  },

  demo() {
    currentPoseIdx = 1; // warrior II
    holdTimer = 2;
    poseAccuracy = 0.72;
    posesCompleted = 2;
    inTransition = false;
    transitionTimer = 0;

    targetPerson = {
      ...makePerson(),
      pts: POSES[1].build(w * 0.3),
    };

    // Player roughly matching pose at right side
    const playerPts = POSES[1].build(w * 0.7);
    // Shift some joints slightly for imperfect match
    playerPts[L_WRIST] = { x: playerPts[L_WRIST].x + 0.5, y: playerPts[L_WRIST].y - 0.3 };
    playerPts[R_KNEE] = { x: playerPts[R_KNEE].x - 0.3, y: playerPts[R_KNEE].y + 0.2 };

    people = [{
      ...makePerson(),
      pts: playerPts,
      lPupilX: playerPts[L_EYE].x,
      lPupilY: playerPts[L_EYE].y,
      rPupilX: playerPts[R_EYE].x,
      rPupilY: playerPts[R_EYE].y,
      handPhase: 1.5,
    }];

    // Calculate accuracy for demo
    const result = calcAccuracy(playerPts, targetPerson.pts);
    jointAccuracies = result.joints;
  },

  draw(ctx) {
    // Draw target pose (left side, ghost)
    ctx.save();
    ctx.globalAlpha = 0.3;
    drawPerson(ctx, rc, targetPerson, 2, 800);
    ctx.restore();

    // Draw target label
    pxText(ctx, "target", w * 0.3, 0.5, "bold 0.25px monospace", "rgba(255,255,255,0.4)", "center");

    // Draw player(s)
    if (people.length === 0) {
      pxText(ctx, 'stand back so the camera can see your body!', w / 2, h / 2, '600 0.4px Sora, sans-serif', '#888', 'center');
      return;
    }

    for (let i = 0; i < people.length; i++) {
      drawPerson(ctx, rc, people[i], i, i * 100);
    }

    // Joint accuracy indicators
    if (people.length > 0 && people[0].pts.length >= 33 && jointAccuracies.length > 0) {
      const p = people[0].pts;
      for (let ji = 0; ji < COMPARE_JOINTS.length; ji++) {
        const idx = COMPARE_JOINTS[ji];
        const acc = jointAccuracies[ji];
        const r = 0.15;

        if (acc > 0.8) {
          // Good — green ring
          rc.circle(p[idx].x, p[idx].y, r * 2, {
            stroke: '#4CAF50', strokeWidth: 0.04,
            fill: 'none', roughness: 0.8, seed: 600 + ji,
          });
        } else if (acc > 0.4) {
          // OK — yellow ring
          rc.circle(p[idx].x, p[idx].y, r * 2, {
            stroke: '#FFD93D', strokeWidth: 0.04,
            fill: 'none', roughness: 0.8, seed: 600 + ji,
          });
        } else {
          // Bad — red ring
          rc.circle(p[idx].x, p[idx].y, r * 2, {
            stroke: '#F44336', strokeWidth: 0.04,
            fill: 'none', roughness: 0.8, seed: 600 + ji,
          });
        }
      }
    }

    // Pose name (top center)
    const pose = POSES[currentPoseIdx];
    pxText(ctx, pose.name, w / 2, 0.6, "bold 0.4px Fredoka, sans-serif", "#fff", "center");

    // Transition message
    if (inTransition) {
      const alpha = Math.max(0, 1 - transitionTimer / TRANSITION_DURATION);
      ctx.globalAlpha = alpha;
      pxText(ctx, `next: ${pose.name}`, w / 2, h / 2, "bold 0.5px Fredoka, sans-serif", "#FFD93D", "center");
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
        const fillColor = poseAccuracy >= ACCURACY_THRESHOLD ? '#4CAF50' : '#F44336';
        rc.rectangle(barX, barY, barW * Math.min(1, progress), barH, {
          fill: fillColor, fillStyle: 'solid', stroke: 'none',
          roughness: 0.8, seed: 701,
        });
      }

      // Hold time label
      const remaining = Math.max(0, pose.holdTime - holdTimer);
      pxText(ctx, `hold: ${remaining.toFixed(1)}s`, w / 2, barY - 0.15, "0.2px monospace", "rgba(255,255,255,0.5)", "center");
    }

    // Accuracy readout
    const accColor = poseAccuracy >= ACCURACY_THRESHOLD ? '#4CAF50' : poseAccuracy > 0.3 ? '#FFD93D' : '#F44336';
    pxText(ctx, `${Math.round(poseAccuracy * 100)}%`, w - 0.3, 0.6, "bold 0.35px monospace", accColor, "right");

    // Poses completed
    pxText(ctx, `poses: ${posesCompleted}`, 0.3, 0.6, "0.2px monospace", "rgba(255,255,255,0.4)");
  },
};
