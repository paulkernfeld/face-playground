import { describe, it } from "node:test";
import assert from "node:assert";
import { getArrowDirection, PATTERN_LENGTH } from "../src/ddr-pattern";
import type { ArrowDirection } from "../src/ddr-pattern";

const EXPECTED_PATTERN: ArrowDirection[] = [
  'up', 'center', 'down', 'center', 'left', 'right', 'left', 'right',
];

describe("DDR fixed pattern", () => {
  it("has a pattern length of 8", () => {
    assert.strictEqual(PATTERN_LENGTH, 8);
  });

  it("produces the correct 8-step sequence for beats 1-8", () => {
    for (let beat = 1; beat <= 8; beat++) {
      const dir = getArrowDirection(beat);
      const expected = EXPECTED_PATTERN[beat - 1];
      assert.strictEqual(dir, expected, `beat ${beat}: expected ${expected} but got ${dir}`);
    }
  });

  it("repeats the pattern on the second cycle (beats 9-16)", () => {
    for (let beat = 9; beat <= 16; beat++) {
      const dir = getArrowDirection(beat);
      const expected = EXPECTED_PATTERN[(beat - 1) % 8];
      assert.strictEqual(dir, expected, `beat ${beat}: expected ${expected} but got ${dir}`);
    }
  });

  it("repeats correctly over 5 full cycles", () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 8; i++) {
        const beat = cycle * 8 + i + 1;
        const dir = getArrowDirection(beat);
        assert.strictEqual(dir, EXPECTED_PATTERN[i],
          `cycle ${cycle}, beat ${beat}: expected ${EXPECTED_PATTERN[i]} but got ${dir}`);
      }
    }
  });

  it("has center (rest) beats at positions 2 and 4 in each cycle", () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const base = cycle * 8;
      assert.strictEqual(getArrowDirection(base + 2), 'center', `beat ${base + 2} should be center`);
      assert.strictEqual(getArrowDirection(base + 4), 'center', `beat ${base + 4} should be center`);
    }
  });

  it("has active (non-center) beats at positions 1,3,5,6,7,8 in each cycle", () => {
    const activePositions = [1, 3, 5, 6, 7, 8];
    for (let cycle = 0; cycle < 3; cycle++) {
      const base = cycle * 8;
      for (const pos of activePositions) {
        const beat = base + pos;
        const dir = getArrowDirection(beat);
        assert.notStrictEqual(dir, 'center',
          `beat ${beat} (position ${pos}) should be active, not center`);
      }
    }
  });

  it("includes all four directional arrows in each cycle", () => {
    const dirs: ArrowDirection[] = [];
    for (let beat = 1; beat <= 8; beat++) {
      dirs.push(getArrowDirection(beat));
    }
    const activeSet = new Set(dirs.filter(d => d !== 'center'));
    assert.ok(activeSet.has('up'), "pattern should include 'up'");
    assert.ok(activeSet.has('down'), "pattern should include 'down'");
    assert.ok(activeSet.has('left'), "pattern should include 'left'");
    assert.ok(activeSet.has('right'), "pattern should include 'right'");
  });
});
