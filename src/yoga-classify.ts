// Pure yoga pose classifier based on joint angles.
// Takes 33 pose landmarks (any objects with x, y), returns a pose name or null.

import {
  L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW,
  L_WRIST, R_WRIST, L_HIP, R_HIP,
  L_KNEE, R_KNEE, L_ANKLE, R_ANKLE,
} from "./experiments/creature-shared";

export type YogaPose = "mountain" | "volcano" | "tpose" | "plank";

type Point = { x: number; y: number };

/** Angle (radians, 0..π) at vertex B formed by points A→B→C */
function angleAt(a: Point, b: Point, c: Point): number {
  const bax = a.x - b.x, bay = a.y - b.y;
  const bcx = c.x - b.x, bcy = c.y - b.y;
  const dot = bax * bcx + bay * bcy;
  const cross = bax * bcy - bay * bcx;
  return Math.atan2(Math.abs(cross), dot);
}

const DEG = Math.PI / 180;

/** Computed angles for debugging */
export interface PoseAngles {
  avgShoulder: number;
  avgElbow: number;
  avgKnee: number;
  avgHip: number;
  torsoTilt: number;
}

/** Get raw angle values for debugging */
export function getPoseAngles(lm: Point[]): PoseAngles | null {
  if (lm.length < 33) return null;
  const lShoulder = angleAt(lm[L_ELBOW], lm[L_SHOULDER], lm[L_HIP]);
  const rShoulder = angleAt(lm[R_ELBOW], lm[R_SHOULDER], lm[R_HIP]);
  const lElbow = angleAt(lm[L_SHOULDER], lm[L_ELBOW], lm[L_WRIST]);
  const rElbow = angleAt(lm[R_SHOULDER], lm[R_ELBOW], lm[R_WRIST]);
  const lKnee = angleAt(lm[L_HIP], lm[L_KNEE], lm[L_ANKLE]);
  const rKnee = angleAt(lm[R_HIP], lm[R_KNEE], lm[R_ANKLE]);
  const lHip = angleAt(lm[L_SHOULDER], lm[L_HIP], lm[L_KNEE]);
  const rHip = angleAt(lm[R_SHOULDER], lm[R_HIP], lm[R_KNEE]);
  const shoulderY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
  const hipY = (lm[L_HIP].y + lm[R_HIP].y) / 2;
  const ankleY = (lm[L_ANKLE].y + lm[R_ANKLE].y) / 2;
  const bodyHeight = Math.abs(ankleY - shoulderY) || 1;
  return {
    avgShoulder: (lShoulder + rShoulder) / 2,
    avgElbow: (lElbow + rElbow) / 2,
    avgKnee: (lKnee + rKnee) / 2,
    avgHip: (lHip + rHip) / 2,
    torsoTilt: Math.abs(shoulderY - hipY) / bodyHeight,
  };
}

/** Classify a set of pose landmarks into a yoga pose, or null if no match. */
export function getYogaPose(lm: Point[]): YogaPose | null {
  if (lm.length < 33) return null;

  // Shoulder angles: how far arms are raised from the body
  // elbow→shoulder→hip angle: small = arms at side, ~90° = T-pose, large = arms up
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

  // Body orientation: are shoulders roughly level with hips? (horizontal body)
  const shoulderY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
  const hipY = (lm[L_HIP].y + lm[R_HIP].y) / 2;
  const ankleY = (lm[L_ANKLE].y + lm[R_ANKLE].y) / 2;
  const bodyHeight = Math.abs(ankleY - shoulderY) || 1;
  const torsoTilt = Math.abs(shoulderY - hipY) / bodyHeight; // 0 = horizontal, ~0.5 = upright

  // Plank: arms fairly straight, shoulder angle moderate (~30–70°),
  // hip angle bent compared to standing (~110–160°), elbows straight
  // This combo distinguishes plank from standing poses where hip > 160°
  if (avgElbow > 120 * DEG && avgShoulder > 30 * DEG && avgShoulder < 70 * DEG &&
      avgHip > 110 * DEG && avgHip < 160 * DEG) {
    return "plank";
  }

  // Standing poses: legs and arms roughly straight
  if (avgKnee < 140 * DEG) return null;
  if (avgElbow < 120 * DEG) return null;

  // Classify by shoulder angle (arm raise level)
  // Mountain: arms down at sides — shoulder angle < 40°
  // T-pose: arms out horizontal — shoulder angle 60°–120°
  // Volcano: arms up overhead — shoulder angle > 140°
  if (avgShoulder < 40 * DEG) return "mountain";
  if (avgShoulder > 60 * DEG && avgShoulder < 120 * DEG) return "tpose";
  if (avgShoulder > 140 * DEG) return "volcano";

  return null;
}
