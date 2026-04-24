// Bivariate Contour Ellipse Area (BCEA) — fixation stability metric.
// BCEA@p = π · χ²(2, p) · σx · σy · √(1 − ρ²)
// χ²(2, 0.95) = 5.991 (95th percentile of chi-square with 2 degrees of freedom).
// Samples (x, y) are expected in degrees of visual angle, so BCEA is in deg².

const CHI2_2_95 = 5.991;

export interface BceaStats {
  n: number;
  meanX: number;
  meanY: number;
  m2X: number;   // Σ(x − meanX)²  (Welford)
  m2Y: number;   // Σ(y − meanY)²
  coM: number;   // Σ(x − meanX)(y − meanY)
}

export function createBceaStats(): BceaStats {
  return { n: 0, meanX: 0, meanY: 0, m2X: 0, m2Y: 0, coM: 0 };
}

export function addSample(s: BceaStats, x: number, y: number): void {
  s.n++;
  const dx = x - s.meanX;
  const dy = y - s.meanY;
  s.meanX += dx / s.n;
  s.meanY += dy / s.n;
  const dx2 = x - s.meanX;
  const dy2 = y - s.meanY;
  s.m2X += dx * dx2;
  s.m2Y += dy * dy2;
  s.coM += dx * dy2;
}

export function bcea95(s: BceaStats): number {
  if (s.n < 2) return 0;
  const varX = s.m2X / (s.n - 1);
  const varY = s.m2Y / (s.n - 1);
  const cov = s.coM / (s.n - 1);
  const sx = Math.sqrt(Math.max(0, varX));
  const sy = Math.sqrt(Math.max(0, varY));
  if (sx === 0 || sy === 0) return 0;
  const rho = cov / (sx * sy);
  const rho2 = Math.min(1, rho * rho);
  return Math.PI * CHI2_2_95 * sx * sy * Math.sqrt(1 - rho2);
}
