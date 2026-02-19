// Pure yoga pose classifier based on 3D joint angles and body-part states.
// Uses MediaPipe worldLandmarks (metric 3D, hip-centered) for perspective-independent classification.
// All classification uses joint angles, not absolute positions — robust across body proportions and camera distances.

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

/** Compute the angle between the spine vector and the vertical (Y-axis).
 *  Returns degrees: ~0° = upright, ~90° = horizontal. */
function spineAngleFromVertical(lm: Point3D[]): number {
  const hipMidX = (lm[L_HIP].x + lm[R_HIP].x) / 2;
  const hipMidY = (lm[L_HIP].y + lm[R_HIP].y) / 2;
  const hipMidZ = (lm[L_HIP].z + lm[R_HIP].z) / 2;
  const shMidX = (lm[L_SHOULDER].x + lm[R_SHOULDER].x) / 2;
  const shMidY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
  const shMidZ = (lm[L_SHOULDER].z + lm[R_SHOULDER].z) / 2;
  const spX = shMidX - hipMidX, spY = shMidY - hipMidY, spZ = shMidZ - hipMidZ;
  const spineLen = Math.sqrt(spX * spX + spY * spY + spZ * spZ);
  if (spineLen < 1e-9) return 0;
  // Angle from vertical: acos(|spY| / len). MediaPipe Y points down, so spine going up = negative spY.
  return Math.acos(Math.abs(spY) / spineLen) / DEG;
}

function classifyTorso(lm: Point3D[]): TorsoState | null {
  const spineAngle = spineAngleFromVertical(lm);

  // Upright: spine is mostly vertical (< 45° from vertical)
  // Fixture data: mountain ~20°, volcano ~3°, tpose ~8°
  if (spineAngle < 45) return "upright";

  // Horizontal (> 45° from vertical) — use cross product to determine prone vs supine.
  // Body-facing normal = (R_SHOULDER - L_SHOULDER) x (shoulder_mid - hip_mid)
  // Fixture data: plank ~75°, plank2 ~70°, shavasana ~74°, shavasana2 ~80°
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

  // Shoulder angle: angle at shoulder between upper arm (elbow) and torso (hip)
  // Fixture data (degrees):
  //   down: mountain 17-23, shavasana 27-28, shavasana2 27-40
  //   out: tpose 83-103
  //   up: volcano 165
  //   supporting (plank): 55-72
  const shoulderAngle = angleAt(elbow, shoulder, hip) / DEG;

  // Elbow angle: angle at elbow between upper arm (shoulder) and forearm (wrist)
  // All fixtures show relatively straight arms (136-172°)
  const elbowAngle = angleAt(shoulder, elbow, wrist) / DEG;

  // Supporting: not upright, arm extended (elbow fairly straight), shoulder angle moderate
  // Plank fixtures: shoulder 55-72°, elbow 150-160°
  if (!upright && elbowAngle > 120 && shoulderAngle > 40) return "supporting";

  // Arm-at-side: shoulder angle small (arm hangs close to torso)
  // Mountain: 17-23°, shavasana: 27-40°
  if (shoulderAngle < 45) return "down";

  // Arm out to side: shoulder angle roughly 60-120° (horizontal-ish)
  // Tpose: 83-103°
  if (shoulderAngle >= 55 && shoulderAngle <= 125) return "out";

  // Arm overhead: shoulder angle large (arm far from torso toward head)
  // Volcano: 165°
  if (shoulderAngle > 135) return "up";

  return null;
}

function classifyLegs(lm: Point3D[]): LegState | null {
  // Knee angle: angle at knee between thigh (hip) and shin (ankle)
  // All yoga fixtures: 154-172° (relatively straight)
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
  spineAngle: number;
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
    spineAngle: spineAngleFromVertical(lm) * DEG,  // return in radians for consistency
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
