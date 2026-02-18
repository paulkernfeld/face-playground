import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getYogaPose, classifyBodyParts } from "../src/yoga-classify";
import type { YogaPose, TorsoState, ArmState, LegState } from "../src/yoga-classify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, "..", "fixtures");

interface Expected {
  pose: YogaPose;
  torso: TorsoState;
  leftArm: ArmState;
  rightArm: ArmState;
  legs: LegState;
}

const fixtures: Record<string, Expected> = {
  "yoga-mountain":  { pose: "mountain",  torso: "upright", leftArm: "down",       rightArm: "down",       legs: "straight" },
  "yoga-volcano":   { pose: "volcano",   torso: "upright", leftArm: "up",         rightArm: "up",         legs: "straight" },
  "yoga-tpose":     { pose: "tpose",     torso: "upright", leftArm: "out",        rightArm: "out",        legs: "straight" },
  "yoga-plank":     { pose: "plank",     torso: "prone",   leftArm: "supporting", rightArm: "supporting", legs: "straight" },
  "yoga-plank2":    { pose: "plank",     torso: "prone",   leftArm: "supporting", rightArm: "supporting", legs: "straight" },
  "yoga-shavasana": { pose: "shavasana", torso: "supine",  leftArm: "down",       rightArm: "down",       legs: "straight" },
  "yoga-shavasana2":{ pose: "shavasana", torso: "supine",  leftArm: "down",       rightArm: "down",       legs: "straight" },
};

describe("yoga classifier", () => {
  for (const [name, expected] of Object.entries(fixtures)) {
    const jsonPath = path.join(fixtureDir, `${name}.landmarks.json`);

    it(`classifies ${name} as ${expected.pose}`, () => {
      if (!fs.existsSync(jsonPath)) {
        // Skip missing landmarks — run extract-landmarks.spec.ts first
        console.log(`  SKIP: ${name}.landmarks.json not found`);
        return;
      }

      const landmarks = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

      const pose = getYogaPose(landmarks);
      assert.strictEqual(pose, expected.pose, `Expected pose ${expected.pose} but got ${pose}`);

      const parts = classifyBodyParts(landmarks);
      assert.ok(parts, `classifyBodyParts returned null for ${name}`);
      assert.strictEqual(parts.torso, expected.torso, `torso: expected ${expected.torso} got ${parts.torso}`);
      assert.strictEqual(parts.leftArm, expected.leftArm, `leftArm: expected ${expected.leftArm} got ${parts.leftArm}`);
      assert.strictEqual(parts.rightArm, expected.rightArm, `rightArm: expected ${expected.rightArm} got ${parts.rightArm}`);
      assert.strictEqual(parts.legs, expected.legs, `legs: expected ${expected.legs} got ${parts.legs}`);
    });
  }
});
