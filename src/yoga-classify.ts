// Pure yoga pose classifier based on 3D joint angles.
// Uses MediaPipe worldLandmarks (metric 3D, hip-centered) for perspective-independent classification.

import {
  L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW,
  L_WRIST, R_WRIST, L_HIP, R_HIP,
  L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
} from "./experiments/creature-shared";

export type YogaPose = "mountain" | "volcano" | "tpose" | "plank";

type Point3D = { x: number; y: number; z: number };

/** Angle (radians, 0..π) at vertex B formed by 3D points A→B→C */
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

/** Computed angles for debugging */
export interface PoseAngles {
  avgShoulder: number;
  avgElbow: number;
  avgKnee: number;
  avgHip: number;
  shoulderY: number; // average shoulder Y in world coords (negative = above hip)
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
  if (lm.length < 33) return null;

  // Shoulder angles: how far arms are raised from the body
  const lShoulder = angleAt(lm[L_ELBOW], lm[L_SHOULDER], lm[L_HIP]);
  const rShoulder = angleAt(lm[R_ELBOW], lm[R_SHOULDER], lm[R_HIP]);
  const avgShoulder = (lShoulder + rShoulder) / 2;

  // Elbow angles: straight vs bent
  const lElbow = angleAt(lm[L_SHOULDER], lm[L_ELBOW], lm[L_WRIST]);
  const rElbow = angleAt(lm[R_SHOULDER], lm[R_ELBOW], lm[R_WRIST]);
  const avgElbow = (lElbow + rElbow) / 2;

  // Knee angles: straight vs bent
  const lKnee = angleAt(lm[L_HIP], lm[L_KNEE], lm[L_ANKLE]);
  const rKnee = angleAt(lm[R_HIP], lm[R_KNEE], lm[R_ANKLE]);
  const avgKnee = (lKnee + rKnee) / 2;

  // Hip angles: body straightness (shoulder→hip→knee)
  const lHip = angleAt(lm[L_SHOULDER], lm[L_HIP], lm[L_KNEE]);
  const rHip = angleAt(lm[R_SHOULDER], lm[R_HIP], lm[R_KNEE]);
  const avgHip = (lHip + rHip) / 2;

  // In world coords, Y is vertical (negative = up from hip).
  // Shoulder Y tells us body orientation: negative = upright, near zero = horizontal
  const shoulderY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
  const isUpright = shoulderY < -0.15; // shoulders well above hips

  // Plank/floor poses: body roughly horizontal (shoulders near hip height)
  // Plank: arms straight, body straight, not upright
  if (!isUpright && avgElbow > 120 * DEG && avgHip > 120 * DEG) {
    return "plank";
  }

  // Standing poses: upright, legs and arms roughly straight
  if (!isUpright) return null;
  if (avgKnee < 140 * DEG) return null;
  if (avgElbow < 120 * DEG) return null;

  // Classify by shoulder angle (arm raise level)
  if (avgShoulder < 40 * DEG) return "mountain";
  if (avgShoulder > 60 * DEG && avgShoulder < 120 * DEG) return "tpose";
  if (avgShoulder > 140 * DEG) return "volcano";

  return null;
}
