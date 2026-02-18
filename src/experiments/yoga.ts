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
import { getYogaPose, classifyBodyParts, POSE_PARTS } from '../yoga-classify';
import type { YogaPose, BodyPartStates } from '../yoga-classify';

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
    name: "plank",
    holdTime: 5,
    classifyAs: "plank",
    build(cx) {
      const p = new Array(33).fill({ x: cx, y: 5.0 }).map(v => ({ ...v }));
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      // Body horizontal — head on left, feet on right
      set(NOSE, cx - 4.5, 4.0);
      set(L_EYE, cx - 4.2, 3.8); set(R_EYE, cx - 4.8, 3.8);
      set(L_SHOULDER, cx - 3.0, 4.5); set(R_SHOULDER, cx - 3.0, 5.0);
      set(L_ELBOW, cx - 3.0, 5.8); set(R_ELBOW, cx - 3.0, 6.3);
      set(L_WRIST, cx - 3.0, 7.0); set(R_WRIST, cx - 3.0, 7.5);
      set(L_HIP, cx + 1.0, 4.5); set(R_HIP, cx + 1.0, 5.0);
      set(L_KNEE, cx + 3.0, 4.5); set(R_KNEE, cx + 3.0, 5.0);
      set(L_ANKLE, cx + 5.0, 4.5); set(R_ANKLE, cx + 5.0, 5.0);
      set(L_MOUTH, cx - 4.0, 4.3); set(R_MOUTH, cx - 4.6, 4.3);
      return p;
    },
  },
  {
    name: "shavasana",
    holdTime: 5,
    classifyAs: "shavasana",
    build(cx) {
      const p = new Array(33).fill({ x: cx, y: 5.0 }).map(v => ({ ...v }));
      const set = (i: number, x: number, y: number) => { p[i] = { x, y }; };
      // Body horizontal face-up — head on left, feet on right
      set(NOSE, cx - 4.5, 4.5);
      set(L_EYE, cx - 4.2, 4.7); set(R_EYE, cx - 4.8, 4.7);
      set(L_SHOULDER, cx - 3.0, 4.2); set(R_SHOULDER, cx - 3.0, 5.3);
      set(L_ELBOW, cx - 1.5, 3.8); set(R_ELBOW, cx - 1.5, 5.7);
      set(L_WRIST, cx - 0.5, 3.5); set(R_WRIST, cx - 0.5, 6.0);
      set(L_HIP, cx + 1.0, 4.2); set(R_HIP, cx + 1.0, 5.3);
      set(L_KNEE, cx + 3.0, 4.0); set(R_KNEE, cx + 3.0, 5.5);
      set(L_ANKLE, cx + 5.0, 3.8); set(R_ANKLE, cx + 5.0, 5.7);
      set(L_MOUTH, cx - 4.0, 4.8); set(R_MOUTH, cx - 4.6, 4.8);
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

// Body-part classification for limb coloring
let currentBodyParts: BodyPartStates | null = null;
let playerLimbColors: LimbColors = {};

/** Compute per-limb colors by comparing classified body parts against the target pose */
function computeLimbColors(parts: BodyPartStates | null, targetPose: YogaPose | undefined): LimbColors {
  if (!parts || !targetPose) return {};
  const target = POSE_PARTS[targetPose];
  return {
    body: parts.torso === target.torso ? undefined : charcoal,
    lArm: parts.leftArm === target.leftArm ? undefined : charcoal,
    rArm: parts.rightArm === target.rightArm ? undefined : charcoal,
    lLeg: parts.legs === target.legs ? undefined : charcoal,
    rLeg: parts.legs === target.legs ? undefined : charcoal,
  };
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
    currentBodyParts = null;
  },

  update() {},

  updatePose(poses: Landmarks[], dt: number, worldPoses?: Landmarks[]) {
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
      // Classify body parts from 3D world landmarks for limb coloring + hold detection
      if (worldPoses && worldPoses.length > 0) {
        currentBodyParts = classifyBodyParts(worldPoses[0]);
        playerLimbColors = computeLimbColors(currentBodyParts, pose.classifyAs);
      }

      // Hold detection: use 3D world landmarks with classifier
      if (pose.classifyAs && worldPoses && worldPoses.length > 0) {
        poseMatched = getYogaPose(worldPoses[0]) === pose.classifyAs;
      } else {
        poseMatched = false;
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
    // Shift left wrist down (bad left arm)
    playerPts[L_WRIST] = { x: playerPts[L_WRIST].x, y: playerPts[L_WRIST].y + 1.0 };
    // Shift right knee out (bad right leg)
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

    // Simulate body-part classification for demo:
    // Left arm is wrong (wrist shifted), right leg is wrong (knee shifted)
    currentBodyParts = {
      torso: "upright",
      leftArm: "down",     // bad — should be "out" for tpose
      rightArm: "out",     // good
      legs: "straight",    // still straight enough visually
    };
    playerLimbColors = computeLimbColors(currentBodyParts, "tpose");
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
