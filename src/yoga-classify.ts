// Pure yoga pose classifier based on 3D joint angles and body-part states.
// Uses MediaPipe worldLandmarks (metric 3D, hip-centered) for perspective-independent classification.

import {
  L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW,
  L_WRIST, R_WRIST, L_HIP, R_HIP,
  L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
} from "./experiments/creature-shared";

export type YogaPose = "mountain" | "volcano" | "tpose" | "plank" | "shavasana";

type Point3D = { x: number; y: number; z: number };

export type TorsoState = "upright" | "prone" | "supine";
export type ArmState = "down" | "out" | "up" | "supporting";
export type LegState = "straight";

export interface BodyPartStates {
  torso: TorsoState;
  leftArm: ArmState;
  rightArm: ArmState;
  legs: LegState;
}

export const POSE_PARTS: Record<YogaPose, BodyPartStates> = {
  mountain:  { torso: "upright", leftArm: "down",       rightArm: "down",       legs: "straight" },
  volcano:   { torso: "upright", leftArm: "up",         rightArm: "up",         legs: "straight" },
  tpose:     { torso: "upright", leftArm: "out",        rightArm: "out",        legs: "straight" },
  plank:     { torso: "prone",   leftArm: "supporting", rightArm: "supporting", legs: "straight" },
  shavasana: { torso: "supine",  leftArm: "down",       rightArm: "down",       legs: "straight" },
};

/** Angle (radians, 0..PI) at vertex B formed by 3D points A->B->C */
function angleAt(a: Point3D, b: Point3D, c: Point3D): number {
  const bax = a.x - b.x, bay = a.y - b.y, baz = a.z - b.z;
  const bcx = c.x - b.x, bcy = c.y - b.y, bcz = c.z - b.z;
  const dot = bax * bcx + bay * bcy + baz * bcz;
  const magBA = Math.sqrt(bax * bax + bay * bay + baz * baz);
  const magBC = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
  if (magBA < 1e-9 || magBC < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
}

const DEG = Math.PI / 180;

function classifyTorso(lm: Point3D[]): TorsoState | null {
  const shoulderY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
  if (shoulderY < -0.15) return "upright";

  // Horizontal — use cross product to determine prone vs supine.
  // Body-facing normal = (R_SHOULDER - L_SHOULDER) x (shoulder_mid - hip_mid)
  const lsh = lm[L_SHOULDER], rsh = lm[R_SHOULDER];
  const lhp = lm[L_HIP], rhp = lm[R_HIP];
  const shX = rsh.x - lsh.x, shY = rsh.y - lsh.y, shZ = rsh.z - lsh.z;
  const hipMidX = (lhp.x + rhp.x) / 2, hipMidY = (lhp.y + rhp.y) / 2, hipMidZ = (lhp.z + rhp.z) / 2;
  const shMidX = (lsh.x + rsh.x) / 2, shMidY = (lsh.y + rsh.y) / 2, shMidZ = (lsh.z + rsh.z) / 2;
  const spX = shMidX - hipMidX, spY = shMidY - hipMidY, spZ = shMidZ - hipMidZ;

  // Cross product: shoulder_vec x spine_vec
  const normalY = shZ * spX - shX * spZ;

  // normalY > 0 means body faces up → supine; < 0 → prone
  if (normalY > 0) return "supine";
  return "prone";
}

function classifyArm(lm: Point3D[], side: "left" | "right", upright: boolean): ArmState | null {
  const [shoulder, elbow, wrist, hip] = side === "left"
    ? [lm[L_SHOULDER], lm[L_ELBOW], lm[L_WRIST], lm[L_HIP]]
    : [lm[R_SHOULDER], lm[R_ELBOW], lm[R_WRIST], lm[R_HIP]];

  const shoulderAngle = angleAt(elbow, shoulder, hip) / DEG;
  const elbowAngle = angleAt(shoulder, elbow, wrist) / DEG;

  // Supporting: not upright, arm straight, and extended away from body
  if (!upright && elbowAngle > 120 && shoulderAngle > 40) return "supporting";

  if (shoulderAngle < 40) return "down";
  if (shoulderAngle >= 60 && shoulderAngle <= 120) return "out";
  if (shoulderAngle > 140) return "up";

  return null;
}

function classifyLegs(lm: Point3D[]): LegState | null {
  const lKnee = angleAt(lm[L_HIP], lm[L_KNEE], lm[L_ANKLE]) / DEG;
  const rKnee = angleAt(lm[R_HIP], lm[R_KNEE], lm[R_ANKLE]) / DEG;
  const avgKnee = (lKnee + rKnee) / 2;
  if (avgKnee > 140) return "straight";
  return null;
}

/** Classify 3D world landmarks into body-part states, or null if landmarks insufficient. */
export function classifyBodyParts(lm: Point3D[]): BodyPartStates | null {
  if (lm.length < 33) return null;

  const torso = classifyTorso(lm);
  if (!torso) return null;

  const upright = torso === "upright";
  const leftArm = classifyArm(lm, "left", upright);
  if (!leftArm) return null;
  const rightArm = classifyArm(lm, "right", upright);
  if (!rightArm) return null;
  const legs = classifyLegs(lm);
  if (!legs) return null;

  return { torso, leftArm, rightArm, legs };
}

/** Computed angles for debugging */
export interface PoseAngles {
  avgShoulder: number;
  avgElbow: number;
  avgKnee: number;
  avgHip: number;
  shoulderY: number;
}

/** Get raw angle values for debugging */
export function getPoseAngles(lm: Point3D[]): PoseAngles | null {
  if (lm.length < 33) return null;
  const lShoulder = angleAt(lm[L_ELBOW], lm[L_SHOULDER], lm[L_HIP]);
  const rShoulder = angleAt(lm[R_ELBOW], lm[R_SHOULDER], lm[R_HIP]);
  const lElbow = angleAt(lm[L_SHOULDER], lm[L_ELBOW], lm[L_WRIST]);
  const rElbow = angleAt(lm[R_SHOULDER], lm[R_ELBOW], lm[R_WRIST]);
  const lKnee = angleAt(lm[L_HIP], lm[L_KNEE], lm[L_ANKLE]);
  const rKnee = angleAt(lm[R_HIP], lm[R_KNEE], lm[R_ANKLE]);
  const lHip = angleAt(lm[L_SHOULDER], lm[L_HIP], lm[L_KNEE]);
  const rHip = angleAt(lm[R_SHOULDER], lm[R_HIP], lm[R_KNEE]);
  return {
    avgShoulder: (lShoulder + rShoulder) / 2,
    avgElbow: (lElbow + rElbow) / 2,
    avgKnee: (lKnee + rKnee) / 2,
    avgHip: (lHip + rHip) / 2,
    shoulderY: (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2,
  };
}

/** Classify 3D world landmarks into a yoga pose, or null if no match. */
export function getYogaPose(lm: Point3D[]): YogaPose | null {
  const parts = classifyBodyParts(lm);
  if (!parts) return null;

  for (const [pose, expected] of Object.entries(POSE_PARTS) as [YogaPose, BodyPartStates][]) {
    if (
      parts.torso === expected.torso &&
      parts.leftArm === expected.leftArm &&
      parts.rightArm === expected.rightArm &&
      parts.legs === expected.legs
    ) {
      return pose;
    }
  }

  return null;
}
