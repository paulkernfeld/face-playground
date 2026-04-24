import { describe, it } from "node:test";
import assert from "node:assert";
import { createBceaStats, addSample, bcea95 } from "../src/bcea";

describe("BCEA@95%", () => {
  it("is 0 when all samples are identical", () => {
    const s = createBceaStats();
    for (let i = 0; i < 100; i++) addSample(s, 0, 0);
    assert.strictEqual(bcea95(s), 0);
  });

  it("is 0 with fewer than 2 samples", () => {
    const s = createBceaStats();
    assert.strictEqual(bcea95(s), 0);
    addSample(s, 1, 2);
    assert.strictEqual(bcea95(s), 0);
  });

  it("matches π·5.991·σx·σy·√(1−ρ²) for independent unit-variance samples", () => {
    // Four corners of a unit square → σx = σy = 1.15 (n/(n−1) correction), ρ = 0.
    // Repeat to stabilize.
    const s = createBceaStats();
    const pts: [number, number][] = [[-1,-1],[-1,1],[1,-1],[1,1]];
    for (let i = 0; i < 1000; i++) for (const [x,y] of pts) addSample(s, x, y);
    const varExact = s.m2X / (s.n - 1);  // will be ~ 1.00025
    const expected = Math.PI * 5.991 * varExact;  // σx·σy = var, ρ≈0
    const got = bcea95(s);
    assert.ok(Math.abs(got - expected) < 0.01, `got ${got}, expected ${expected}`);
  });

  it("approaches 0 as ρ approaches 1 (perfect correlation)", () => {
    const s = createBceaStats();
    for (let i = -10; i <= 10; i++) addSample(s, i, i);
    assert.ok(bcea95(s) < 1e-9, `expected ~0, got ${bcea95(s)}`);
  });

  it("scales as σ² when samples scale by k", () => {
    const build = (k: number) => {
      const s = createBceaStats();
      const pts: [number, number][] = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (let i = 0; i < 500; i++) for (const [x,y] of pts) addSample(s, x*k, y*k);
      return bcea95(s);
    };
    const base = build(1);
    const doubled = build(2);
    // σx·σy scales as k²; √(1−ρ²) is unchanged (ρ=0 regardless of k)
    assert.ok(Math.abs(doubled / base - 4) < 0.01, `ratio ${doubled / base}, expected 4`);
  });
});
