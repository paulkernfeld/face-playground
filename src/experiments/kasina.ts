import type { Experiment, FaceData, Blendshapes } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { charcoal, stone, rose, cream, honey, sage, terra, sky, lavender } from '../palette';
import { createBceaStats, addSample, bcea95, bcea95Ellipse, type BceaStats } from '../bcea';

// One-Minute Focus Test — spec v0.1.
// Stare at the dot; BCEA@95% of your gaze over the whole test is checked at each checkpoint.

// Linear conversion from blendshape units to visual-angle degrees.
// Was 30 (anchored on ARKit "fully looking" ≈ 30°), then 10 after pilot showed
// dots landing well outside the threshold rings. Bumped back to 20 because 10 was
// too forgiving — most runs cleared Cracked. Tune with more pilot data.
const BLENDSHAPE_TO_DEG = 20;

// Gated checkpoints — cumulative BCEA@95% must be below the threshold to pass.
// Baseline thresholds from quintile calibration against Longhin et al. 2016 MAIA
// (N=358 IR fixation data). The 600s/Monk threshold is a guess — tune with pilot data.
const CHECKPOINTS_SEC =      [10,  30,  60,  180, 600];
const TIER_THRESHOLDS_DEG2 = [3.4, 2.2, 1.5, 1.0, 0.7];
const TEST_CEILING_SEC = 600;

type Tier = 'Cooked' | 'Scroller' | 'Normie' | 'Locked In' | 'Cracked' | 'Monk';
const TIERS: Tier[] = ['Cooked', 'Scroller', 'Normie', 'Locked In', 'Cracked', 'Monk'];
const TIER_COLORS: Record<Tier, string> = {
  'Monk': lavender, 'Cracked': sage, 'Locked In': sage, 'Normie': honey, 'Scroller': honey, 'Cooked': rose,
};

// Central fixation dot color during the active phase — climbs as checkpoints pass.
const ACTIVE_DOT_COLORS = [rose, terra, honey, sky, lavender, sage];

const BLINK_THRESHOLD = 0.2;
const MAX_BLINK_SEC = 2.0;
const POST_BLINK_GRACE_SEC = 0.4;   // gaze blendshapes are unreliable as the lid reopens
const PREVIEW_WINDOW_SEC = 4;       // rolling window of recent samples shown on the ready screen
const MAX_NO_FACE_SEC = 1.5;
const SACCADE_DEG = 2.0;            // samples farther than this from center count as saccadic intrusions
const START_GATE_DEG = 0.67;        // ready→active is blocked until current gaze sits within this of the calibration point

// Contextual ready-screen prompts use a rolling window so they don't strobe on a single bad frame.
const PROMPT_WINDOW_SEC = 1.5;
const FACE_SIZE_MIN = 1.2;          // interocular distance in game units (16-wide) — below this, "please have a seat".
const HEAD_MOVE_THRESHOLD = 2.5;    // bounding-box diagonal of head translation over PROMPT_WINDOW_SEC (cm-ish) — above this, "remain still"
const GAZE_PEAK_DEG_LIMIT = 1.0;    // peak deviation in 4s gaze window — above this, "hold your gaze on a point"

// Plot ranges are fixed (no auto-zoom) so "your trace crossed the line = you lose"
// is a clean visual semantic. SCATTER_MAX_DEG is set so the largest tier ring sits
// inside the panel; TIME_SERIES_MAX_DEG2 is set so the easiest threshold is mid-plot.
const SCATTER_MAX_DEG = 2.5;
const TIME_SERIES_MAX_DEG2 = 15;

// Slow-drift calibration point. The "center" the user is fixating on is allowed to
// creep at this rate (deg/s) toward where their eyes are actually pointing — so a
// gradual posture shift doesn't accumulate as BCEA. Fast saccades still register
// because the calibration can't keep up. Reset at the start of ready and active.
const CALIBRATION_DRIFT_DEG_PER_SEC = 1;

const PAPER_LINKS = [
  { label: 'BCEA — Kim 2022', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9112722/' },
  { label: 'microsaccades & attention', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7962679/' },
  { label: 'ADHD fixation stability', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12452707/' },
];

type Phase = 'ready' | 'active' | 'result';

interface Sample {
  t: number;         // elapsed seconds from test start
  x: number;         // degrees (screen x, + = right)
  y: number;         // degrees (screen y, + = down)
  dev: number;       // √(x² + y²) — angular deviation from target center
  bcea: number;      // cumulative BCEA@95% over all samples up to and including this one (deg²)
}

// Rolling per-frame snapshot of face presence/size/translation. Used during the
// ready phase to compute the contextual prompt (sit down / remain still / etc).
interface FaceSnap {
  t: number;
  hasFace: boolean;
  size: number;        // interocular distance (0 if no face)
  hasMatrix: boolean;
  tx: number; ty: number; tz: number;
}

function extractGazeDeg(bs: Blendshapes): [number, number] {
  const inL = bs.get('eyeLookInLeft') ?? 0;
  const outL = bs.get('eyeLookOutLeft') ?? 0;
  const inR = bs.get('eyeLookInRight') ?? 0;
  const outR = bs.get('eyeLookOutRight') ?? 0;
  const upL = bs.get('eyeLookUpLeft') ?? 0;
  const downL = bs.get('eyeLookDownLeft') ?? 0;
  const upR = bs.get('eyeLookUpRight') ?? 0;
  const downR = bs.get('eyeLookDownRight') ?? 0;
  // Screen-space: left-eye "in" = toward nose = user looking right; same for right-eye "out".
  const x = ((inL + outR) - (outL + inR)) / 2;
  const y = ((downL + downR) - (upL + upR)) / 2;
  return [x * BLENDSHAPE_TO_DEG, y * BLENDSHAPE_TO_DEG];
}

export const kasina: Experiment = {
  name: "kasina",
  bgColor: '#000',

  ...(() => {
    let phase: Phase;
    let elapsed: number;
    let stats: BceaStats;
    let checkpointsPassed: number;
    let resultTier: Tier | null;
    let resultBcea: number;
    let rc: GameRoughCanvas;

    let samples: Sample[];
    let faceBuffer: FaceSnap[]; // rolling PROMPT_WINDOW_SEC of frames for the contextual ready-screen prompt
    let saccadeCount: number;
    let inIntrusion: boolean;   // edge-trigger: a sustained excursion counts as one intrusion
    let peakDev: number;
    let sumDev: number;
    let validCount: number;
    let invalidCount: number;    // frames during active phase that didn't yield a sample (blink/no-face)

    // Slow-drifting calibration center (deg). Samples are recorded relative to this,
    // so a gradual posture shift doesn't show up as a fixation error. On the first
    // valid gaze sample after a phase reset we snap calib to the current gaze, so
    // the run doesn't open with a spurious "drifting back to center" arc.
    let calibX: number;
    let calibY: number;
    let needsCalibReset: boolean;

    let blinkDuration: number;
    let postBlinkTimer: number;
    let noFaceDuration: number;
    let isBlinking: boolean;
    let latestBlinkMax: number; // max(eyeBlinkLeft, eyeBlinkRight) — for the openEyes progress ring
    let hasFace: boolean;

    let audioCtx: AudioContext | null = null;
    let keyHandler: ((e: KeyboardEvent) => void) | null = null;
    let linksEl: HTMLDivElement | null = null;

    function playTick() {
      try {
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.06);
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.2);
      } catch { /* audio is optional */ }
    }

    function setLinksVisible(show: boolean) {
      if (!linksEl) return;
      linksEl.style.display = show ? 'flex' : 'none';
    }

    function clearRun() {
      elapsed = 0;
      stats = createBceaStats();
      checkpointsPassed = 0;
      blinkDuration = 0;
      postBlinkTimer = 0;
      latestBlinkMax = 0;
      noFaceDuration = 0;
      samples = [];
      faceBuffer = [];
      saccadeCount = 0;
      inIntrusion = false;
      peakDev = 0;
      sumDev = 0;
      validCount = 0;
      invalidCount = 0;
      calibX = 0;
      calibY = 0;
      needsCalibReset = true;
    }

    // Move the calibration point a fixed angular speed toward the latest gaze
    // direction. Returns the gaze position relative to the (post-update) center.
    // On the first call after a phase reset, snap directly to the current gaze.
    function applyCalibration(gx: number, gy: number, dt: number): [number, number] {
      if (needsCalibReset) {
        calibX = gx;
        calibY = gy;
        needsCalibReset = false;
        return [0, 0];
      }
      const dx = gx - calibX;
      const dy = gy - calibY;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        const step = Math.min(CALIBRATION_DRIFT_DEG_PER_SEC * dt, dist);
        calibX += (dx / dist) * step;
        calibY += (dy / dist) * step;
      }
      return [gx - calibX, gy - calibY];
    }

    function resetToReady() {
      phase = 'ready';
      clearRun();
      resultTier = null;
      resultBcea = 0;
      setLinksVisible(false);
    }

    // Interocular distance as a face-size proxy. Bigger = face closer to camera.
    function computeFaceSize(landmarks: { x: number; y: number; z: number }[]): number {
      if (landmarks.length < 264) return 0;
      const a = landmarks[33];
      const b = landmarks[263];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    // Face is present + close enough for ≥60% of the recent window.
    function isFaceComfortable(): boolean {
      if (faceBuffer.length === 0) return false;
      let good = 0;
      for (const f of faceBuffer) {
        if (f.hasFace && f.size >= FACE_SIZE_MIN) good++;
      }
      return good / faceBuffer.length >= 0.6;
    }

    // Bounding-box diagonal of head translation over the window. Doesn't fire
    // until matrix data has been flowing for a moment — avoids spurious "remain
    // still" on the first valid frame.
    function isHeadStill(): boolean {
      let minTx = Infinity, maxTx = -Infinity;
      let minTy = Infinity, maxTy = -Infinity;
      let minTz = Infinity, maxTz = -Infinity;
      let n = 0;
      for (const f of faceBuffer) {
        if (!f.hasMatrix) continue;
        if (f.tx < minTx) minTx = f.tx;
        if (f.tx > maxTx) maxTx = f.tx;
        if (f.ty < minTy) minTy = f.ty;
        if (f.ty > maxTy) maxTy = f.ty;
        if (f.tz < minTz) minTz = f.tz;
        if (f.tz > maxTz) maxTz = f.tz;
        n++;
      }
      if (n < 5) return true;
      const diag = Math.hypot(maxTx - minTx, maxTy - minTy, maxTz - minTz);
      return diag < HEAD_MOVE_THRESHOLD;
    }

    // Gaze is steady when both the latest sample is inside the gate AND no
    // sample in the 4s preview window strayed past GAZE_PEAK_DEG_LIMIT.
    function isGazeSteady(): boolean {
      if (samples.length === 0) return false;
      const last = samples[samples.length - 1];
      if (last.dev >= START_GATE_DEG) return false;
      for (const s of samples) {
        if (s.dev > GAZE_PEAK_DEG_LIMIT) return false;
      }
      return true;
    }

    type Prompt = 'waitingForUser' | 'sitDown' | 'openEyes' | 'remainStill' | 'holdGaze' | 'pressSpace';

    // True when ≥60% of the recent window has any face at all (regardless of size).
    function hasAnyFace(): boolean {
      if (faceBuffer.length === 0) return false;
      let n = 0;
      for (const f of faceBuffer) if (f.hasFace) n++;
      return n / faceBuffer.length >= 0.6;
    }

    function currentPrompt(): Prompt {
      if (!hasAnyFace()) return 'waitingForUser';
      if (!isFaceComfortable()) return 'sitDown';
      if (isBlinking) return 'openEyes';
      if (!isHeadStill()) return 'remainStill';
      if (!isGazeSteady()) return 'holdGaze';
      return 'pressSpace';
    }

    function canStart(): boolean {
      return phase === 'ready' && currentPrompt() === 'pressSpace';
    }

    // Progress (0..1) toward clearing the currently-gating ready-screen condition.
    // Used to fill a ring around the central dot — gives smooth feedback even
    // though the prompt itself switches discretely.
    function readyProgress(): number {
      const p = currentPrompt();
      if (p === 'pressSpace') return 1;
      if (p === 'waitingForUser') return 0;
      if (p === 'openEyes') {
        // As max(blinkL, blinkR) drops from 1 (fully closed) to BLINK_THRESHOLD (gate clears), ring fills 0→1.
        return Math.max(0, Math.min(1, (1 - latestBlinkMax) / (1 - BLINK_THRESHOLD)));
      }
      if (p === 'sitDown') {
        const latest = faceBuffer[faceBuffer.length - 1];
        if (!latest || !latest.hasFace) return 0;
        return Math.min(latest.size / FACE_SIZE_MIN, 1);
      }
      if (p === 'remainStill') {
        let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity, minTz = Infinity, maxTz = -Infinity;
        let n = 0;
        for (const f of faceBuffer) {
          if (!f.hasMatrix) continue;
          if (f.tx < minTx) minTx = f.tx; if (f.tx > maxTx) maxTx = f.tx;
          if (f.ty < minTy) minTy = f.ty; if (f.ty > maxTy) maxTy = f.ty;
          if (f.tz < minTz) minTz = f.tz; if (f.tz > maxTz) maxTz = f.tz;
          n++;
        }
        if (n < 5) return 0;
        const diag = Math.hypot(maxTx - minTx, maxTy - minTy, maxTz - minTz);
        // Map across 2x the gate threshold so the bar is dynamic even during active movement.
        // diag=0 → 1 (still), diag=THRESHOLD → 0.5 (boundary), diag>=2*THRESHOLD → 0.
        return Math.max(0, 1 - diag / (2 * HEAD_MOVE_THRESHOLD));
      }
      // holdGaze — same softening as remainStill so the bar is dynamic during gaze excursions.
      if (samples.length === 0) return 0;
      const last = samples[samples.length - 1];
      return Math.max(0, 1 - last.dev / (2 * GAZE_PEAK_DEG_LIMIT));
    }

    // Active-phase ring: fraction of time elapsed within the current checkpoint
    // segment. Resets to 0 at each checkpoint clear (when checkpointsPassed bumps).
    function activeProgress(): number {
      const idx = checkpointsPassed;
      if (idx >= CHECKPOINTS_SEC.length) return 1;
      const segStart = idx === 0 ? 0 : CHECKPOINTS_SEC[idx - 1];
      const segEnd = CHECKPOINTS_SEC[idx];
      return Math.max(0, Math.min(1, (elapsed - segStart) / (segEnd - segStart)));
    }

    function startTest() {
      phase = 'active';
      clearRun();
      setLinksVisible(false);
    }

    function endTest() {
      resultTier = TIERS[Math.min(checkpointsPassed, TIERS.length - 1)];
      resultBcea = bcea95(stats);
      phase = 'result';
      setLinksVisible(true);
    }

    // Each tier threshold is rendered as an area-equivalent circle (r = √(t/π)).
    // BCEA is variance-based (deg²) and the plot axes are linear deviation (deg),
    // so this is an approximation — but it lets you eyeball "am I inside Monk?".
    const RING_TIERS: Tier[] = ['Scroller', 'Normie', 'Locked In', 'Cracked', 'Monk'];

    function drawScatterPanel(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
      // Dark background for "glowing dots" aesthetic (share-worthy contrast).
      ctx.save();
      ctx.fillStyle = '#1a1815';
      ctx.fillRect(px, py, pw, ph);

      // Reserve header strip for labels; plot is a square in the remaining area.
      const headerH = 0.55;
      const footerH = 0.4;
      const plotBounds = Math.min(pw - 0.4, ph - headerH - footerH);
      const centerX = px + pw / 2;
      const centerY = py + headerH + plotBounds / 2;

      // Fixed visual-angle scale — never auto-zoom. Samples outside SCATTER_MAX_DEG
      // are simply clipped, which makes "your dot left the panel" a meaningful signal.
      const ellipse = bcea95Ellipse(stats);
      const ringRadii = TIER_THRESHOLDS_DEG2.map(t => Math.sqrt(t / Math.PI));
      const scale = (plotBounds / 2) / SCATTER_MAX_DEG;

      // Faint axes through origin.
      ctx.strokeStyle = '#2e2c28';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(centerX - plotBounds / 2, centerY);
      ctx.lineTo(centerX + plotBounds / 2, centerY);
      ctx.moveTo(centerX, centerY - plotBounds / 2);
      ctx.lineTo(centerX, centerY + plotBounds / 2);
      ctx.stroke();

      // Degree grid rings (1°, 2°, …) while they fit.
      ctx.strokeStyle = '#2a2824';
      ctx.lineWidth = 0.015;
      for (let d = 1; d * scale < plotBounds / 2; d++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, d * scale, 0, Math.PI * 2);
        ctx.stroke();
      }

      // All four tier thresholds — area-equivalent circles, color-coded.
      ctx.lineWidth = 0.03;
      ctx.setLineDash([0.1, 0.08]);
      for (let i = 0; i < ringRadii.length; i++) {
        const tier = RING_TIERS[i];
        const r = ringRadii[i] * scale;
        ctx.strokeStyle = TIER_COLORS[tier];
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
        // Label sits just above the ring on the centerline.
        pxText(ctx, tier, centerX, centerY - r - 0.06, '0.16px Sora', TIER_COLORS[tier], 'center');
      }
      ctx.setLineDash([]);

      // BCEA@95% ellipse — cream stroke.
      if (ellipse) {
        ctx.strokeStyle = cream;
        ctx.lineWidth = 0.05;
        ctx.save();
        ctx.translate(centerX + ellipse.cx * scale, centerY + ellipse.cy * scale);
        ctx.rotate(ellipse.theta);
        ctx.beginPath();
        ctx.ellipse(0, 0, ellipse.a * scale, ellipse.b * scale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Sample dots — small, semi-transparent, single color. Time encoded as alpha
      // (early dim, late brighter) so you can read the recency of the cluster.
      const totalT = samples.length ? samples[samples.length - 1].t : 1;
      const dotR = 0.025;
      ctx.fillStyle = cream;
      for (const s of samples) {
        const alpha = 0.15 + 0.35 * (s.t / Math.max(totalT, 0.001));
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(centerX + s.x * scale, centerY + s.y * scale, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Target marker on top.
      ctx.fillStyle = cream;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1a1815';
      ctx.lineWidth = 0.02;
      ctx.stroke();

      ctx.restore();

      // Single live/cumulative BCEA readout in the header.
      const liveBcea = bcea95(stats);
      pxText(ctx, `BCEA@95%: ${liveBcea.toFixed(2)} deg²`, px + 0.2, py + 0.4, '0.28px Sora', cream, 'left');
    }

    const CHECKPOINT_LABELS = ['Scroller', 'Normie', 'Locked In', 'Cracked', 'Monk'];

    function drawTimeSeriesPanel(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
      ctx.save();
      ctx.fillStyle = '#EDE7D7';
      ctx.fillRect(px, py, pw, ph);

      const leftPad = 0.6, rightPad = 0.3, topPad = 0.45, bottomPad = 0.45;
      const plotX0 = px + leftPad;
      const plotY0 = py + topPad;
      const plotW = pw - leftPad - rightPad;
      const plotH = ph - topPad - bottomPad;

      const yMax = TIME_SERIES_MAX_DEG2;
      const xMax = TEST_CEILING_SEC;
      const tx = (t: number) => plotX0 + (t / xMax) * plotW;
      const ty = (v: number) => plotY0 + plotH - (Math.min(v, yMax) / yMax) * plotH;

      // Stair-step "fail ceiling" — at each checkpoint the threshold ratchets down.
      // If your trace ever crosses above the step at time t, you fail at the next
      // checkpoint. Each segment is colored by the tier you're trying to clear.
      ctx.lineWidth = 0.04;
      const ceilingSegments: { t0: number; t1: number; threshold: number; tier: Tier }[] = [];
      for (let i = 0; i < CHECKPOINTS_SEC.length; i++) {
        const t0 = i === 0 ? 0 : CHECKPOINTS_SEC[i - 1];
        ceilingSegments.push({
          t0,
          t1: CHECKPOINTS_SEC[i],
          threshold: TIER_THRESHOLDS_DEG2[i],
          tier: RING_TIERS[i],
        });
      }
      // Trailing flat segment after final checkpoint stays at the toughest threshold.
      ceilingSegments.push({
        t0: CHECKPOINTS_SEC[CHECKPOINTS_SEC.length - 1],
        t1: TEST_CEILING_SEC,
        threshold: TIER_THRESHOLDS_DEG2[TIER_THRESHOLDS_DEG2.length - 1],
        tier: RING_TIERS[RING_TIERS.length - 1],
      });
      for (const seg of ceilingSegments) {
        ctx.strokeStyle = TIER_COLORS[seg.tier];
        ctx.beginPath();
        ctx.moveTo(tx(seg.t0), ty(seg.threshold));
        ctx.lineTo(tx(seg.t1), ty(seg.threshold));
        ctx.stroke();
      }

      // Vertical checkpoint markers.
      ctx.strokeStyle = stone;
      ctx.lineWidth = 0.018;
      ctx.setLineDash([0.06, 0.08]);
      for (let i = 0; i < CHECKPOINTS_SEC.length; i++) {
        const x = tx(CHECKPOINTS_SEC[i]);
        ctx.beginPath();
        ctx.moveTo(x, plotY0);
        ctx.lineTo(x, plotY0 + plotH);
        ctx.stroke();
        pxText(ctx, CHECKPOINT_LABELS[i], x, plotY0 - 0.07, '0.18px Sora', stone, 'center');
      }
      ctx.setLineDash([]);

      // Running BCEA trace.
      ctx.strokeStyle = charcoal;
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      let started = false;
      for (const s of samples) {
        const x = tx(s.t);
        const y = ty(s.bcea);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      if (started) ctx.stroke();

      // Axes.
      ctx.strokeStyle = charcoal;
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(plotX0, plotY0);
      ctx.lineTo(plotX0, plotY0 + plotH);
      ctx.lineTo(plotX0 + plotW, plotY0 + plotH);
      ctx.stroke();

      pxText(ctx, `${yMax.toFixed(0)} deg²`, plotX0 - 0.08, plotY0 + 0.18, '0.2px Sora', stone, 'right');
      pxText(ctx, '0',                        plotX0 - 0.08, plotY0 + plotH - 0.02, '0.2px Sora', stone, 'right');
      pxText(ctx, '0s',                       plotX0,                 plotY0 + plotH + 0.3, '0.2px Sora', stone, 'center');
      pxText(ctx, `${TEST_CEILING_SEC}s`,     plotX0 + plotW,         plotY0 + plotH + 0.3, '0.2px Sora', stone, 'center');

      ctx.restore();
    }

    function sampleRateHz(): number {
      return elapsed > 0 ? validCount / elapsed : 0;
    }

    function sampleRateColor(hz: number): string {
      if (hz >= 25) return sage;
      if (hz >= 15) return honey;
      return rose;
    }

    function drawDiagnosticsPanel(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
      ctx.save();
      ctx.fillStyle = '#EDE7D7';
      ctx.fillRect(px, py, pw, ph);

      pxText(ctx, 'diagnostics', px + 0.1, py + 0.3, '0.22px Sora', stone, 'left');

      const totalFrames = validCount + invalidCount;
      const hz = sampleRateHz();
      const meanDev = validCount > 0 ? sumDev / validCount : 0;
      const validPct = totalFrames > 0 ? (100 * validCount / totalFrames) : 0;

      const cells: { label: string; value: string; color?: string }[] = [
        { label: 'sample rate',    value: `${hz.toFixed(1)} Hz`, color: sampleRateColor(hz) },
        { label: '% valid',        value: `${validPct.toFixed(0)}%` },
        { label: 'intrusions',     value: `${saccadeCount}` },
        { label: 'peak error',     value: `${peakDev.toFixed(2)}°` },
        { label: 'mean error',     value: `${meanDev.toFixed(2)}°` },
        { label: 'BCEA',           value: `${resultBcea.toFixed(2)} deg²` },
        { label: 'duration',       value: `${elapsed.toFixed(1)}s` },
      ];

      const cols = 4;
      const headerH = 0.5;
      const cellW = pw / cols;
      const cellH = (ph - headerH) / 2;
      for (let i = 0; i < cells.length; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x0 = px + c * cellW;
        const y0 = py + headerH + r * cellH;
        pxText(ctx, cells[i].label, x0 + cellW / 2, y0 + 0.35, '0.2px Sora', stone, 'center');
        pxText(ctx, cells[i].value, x0 + cellW / 2, y0 + 0.85, '0.45px Fredoka', cells[i].color ?? charcoal, 'center');
      }

      ctx.restore();
    }

    return {
      setup(_ctx: CanvasRenderingContext2D, _gw: number, _gh: number) {
        rc = new GameRoughCanvas(_ctx.canvas);
        resetToReady();

        if (keyHandler) document.removeEventListener('keydown', keyHandler);
        keyHandler = (e: KeyboardEvent) => {
          if (e.code !== 'Space') return;
          if (canStart()) {
            e.preventDefault();
            startTest();
          } else if (phase === 'result') {
            e.preventDefault();
            resetToReady();
          }
        };
        document.addEventListener('keydown', keyHandler);

        // DOM overlay: paper links, shown only on the result screen.
        if (!linksEl) {
          linksEl = document.createElement('div');
          linksEl.id = 'kasina-links';
          linksEl.style.cssText = [
            'position:fixed', 'left:50%', 'bottom:5%', 'transform:translateX(-50%)',
            'display:none', 'gap:0.8em', 'flex-wrap:wrap', 'justify-content:center',
            'font-family:Sora, sans-serif', 'font-size:0.75rem', 'pointer-events:auto',
            'z-index:10',
          ].join(';');
          for (const { label, url } of PAPER_LINKS) {
            const a = document.createElement('a');
            a.href = url; a.target = '_blank'; a.rel = 'noopener';
            a.textContent = label;
            a.style.cssText = `color:${stone};text-decoration:underline;`;
            linksEl.appendChild(a);
          }
          document.body.appendChild(linksEl);
        }
      },

      update(face: FaceData | null, dt: number) {
        hasFace = !!face;
        if (!face) {
          isBlinking = false;
          if (phase === 'active') {
            noFaceDuration += dt;
            invalidCount++;
            if (noFaceDuration > MAX_NO_FACE_SEC) endTest();
            return;
          }
          if (phase === 'ready') {
            elapsed += dt;
            faceBuffer.push({ t: elapsed, hasFace: false, size: 0, hasMatrix: false, tx: 0, ty: 0, tz: 0 });
            const cutoff = elapsed - PROMPT_WINDOW_SEC;
            while (faceBuffer.length && faceBuffer[0].t < cutoff) faceBuffer.shift();
          }
          return;
        }

        noFaceDuration = 0;

        const blinkL = face.blendshapes.get('eyeBlinkLeft') ?? 0;
        const blinkR = face.blendshapes.get('eyeBlinkRight') ?? 0;
        latestBlinkMax = Math.max(blinkL, blinkR);
        isBlinking = blinkL > BLINK_THRESHOLD || blinkR > BLINK_THRESHOLD;

        if (phase === 'ready') {
          elapsed += dt;

          // Record per-frame face/head snapshot for the contextual prompt.
          const m = face.rawTransformMatrix;
          faceBuffer.push({
            t: elapsed,
            hasFace: true,
            size: computeFaceSize(face.landmarks),
            hasMatrix: !!m,
            tx: m ? m[12] : 0,
            ty: m ? m[13] : 0,
            tz: m ? m[14] : 0,
          });
          const bufCutoff = elapsed - PROMPT_WINDOW_SEC;
          while (faceBuffer.length && faceBuffer[0].t < bufCutoff) faceBuffer.shift();

          // Rolling-window live gaze preview. Same blink/post-blink filtering as the test.
          if (isBlinking) {
            postBlinkTimer = POST_BLINK_GRACE_SEC;
          } else if (postBlinkTimer > 0) {
            postBlinkTimer -= dt;
          } else {
            const [rawX, rawY] = extractGazeDeg(face.blendshapes);
            const [gx, gy] = applyCalibration(rawX, rawY, dt);
            const dev = Math.hypot(gx, gy);
            samples.push({ t: elapsed, x: gx, y: gy, dev, bcea: 0 });
            const cutoff = elapsed - PREVIEW_WINDOW_SEC;
            while (samples.length && samples[0].t < cutoff) samples.shift();
            // Recompute stats and peakDev from the windowed samples.
            stats = createBceaStats();
            peakDev = 0;
            for (const s of samples) {
              addSample(stats, s.x, s.y);
              if (s.dev > peakDev) peakDev = s.dev;
            }
          }
          return;
        }

        if (phase !== 'active') return;

        if (isBlinking) {
          blinkDuration += dt;
          postBlinkTimer = POST_BLINK_GRACE_SEC;
          invalidCount++;
          if (blinkDuration > MAX_BLINK_SEC) { endTest(); return; }
        } else if (postBlinkTimer > 0) {
          // Gaze blendshapes lag the lid reopening — skip a few frames to avoid spurious deviations.
          postBlinkTimer -= dt;
          blinkDuration = 0;
          invalidCount++;
        } else {
          blinkDuration = 0;
          const [rawX, rawY] = extractGazeDeg(face.blendshapes);
          const [gx, gy] = applyCalibration(rawX, rawY, dt);
          addSample(stats, gx, gy);
          const dev = Math.hypot(gx, gy);
          const bceaAt = bcea95(stats);
          samples.push({ t: elapsed, x: gx, y: gy, dev, bcea: bceaAt });
          validCount++;
          if (dev > SACCADE_DEG) {
            if (!inIntrusion) { saccadeCount++; inIntrusion = true; }
          } else {
            inIntrusion = false;
          }
          if (dev > peakDev) peakDev = dev;
          sumDev += dev;
        }

        elapsed += dt;

        // Evaluate gated checkpoints in order. Cumulative BCEA over the whole test so far.
        while (checkpointsPassed < CHECKPOINTS_SEC.length
               && elapsed >= CHECKPOINTS_SEC[checkpointsPassed]) {
          const bcea = bcea95(stats);
          if (bcea <= TIER_THRESHOLDS_DEG2[checkpointsPassed]) {
            checkpointsPassed++;
            playTick();
          } else {
            endTest();
            return;
          }
        }

        // Final ceiling: last checkpoint already cleared, this just ends the test.
        if (elapsed >= TEST_CEILING_SEC) { endTest(); return; }
      },

      draw(ctx: CanvasRenderingContext2D, gw: number, gh: number, debug?: boolean) {
        const cx = gw / 2;
        const cy = gh / 2;

        // Fixation target — shown during ready/active only; the result screen uses the space.
        if (phase !== 'result') {
          const dotColor = phase === 'active'
            ? ACTIVE_DOT_COLORS[Math.min(checkpointsPassed, ACTIVE_DOT_COLORS.length - 1)]
            : stone;
          rc.circle(cx, cy, 0.5, { fill: dotColor, fillStyle: 'solid', stroke: dotColor, strokeWidth: 0.02 });
          ctx.save();
          ctx.strokeStyle = cream;
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(cx - 0.22, cy); ctx.lineTo(cx + 0.22, cy);
          ctx.moveTo(cx, cy - 0.22); ctx.lineTo(cx, cy + 0.22);
          ctx.stroke();
          ctx.fillStyle = cream;
          ctx.beginPath();
          ctx.arc(cx, cy, 0.05, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Progress ring just outside the dot. Same color as the dot.
          // Ready: tracks preparatory progress (gated condition's nearness to threshold).
          // Active: tracks time elapsed in the current checkpoint segment.
          // A faint full-circle track is always drawn in ready so the user can see the ring exists.
          const ringFrac = phase === 'ready' ? readyProgress() : activeProgress();
          ctx.save();
          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 0.08;
          ctx.lineCap = 'round';
          if (phase === 'ready') {
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.arc(cx, cy, 0.42, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          if (ringFrac > 0.005) {
            ctx.beginPath();
            ctx.arc(cx, cy, 0.42, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * ringFrac);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (phase === 'ready') {
          pxText(ctx, 'Focus Test', cx, 1.0, '0.7px Fredoka', cream, 'center');

          const p = currentPrompt();
          const promptText: Record<typeof p, string> = {
            waitingForUser: 'waiting for user...',
            sitDown: 'please have a seat',
            openEyes: 'open your eyes or adjust your gaze upwards',
            remainStill: 'remain still',
            holdGaze: 'hold your gaze on a point',
            pressSpace: 'press space to start',
          };
          const promptColor = p === 'pressSpace' ? sage : cream;
          pxText(ctx, promptText[p], cx, cy - 1.4, '0.7px Fredoka', promptColor, 'center');

          pxText(ctx, 'for entertainment, not medical assessment', cx, gh - 0.6, '0.22px Sora', stone, 'center');
          // Live gaze preview (rolling window) with all tier rings for context.
          drawScatterPanel(ctx, 0.4, 5.4, 3.4, 3.4);
        } else if (phase === 'active') {
          // Silent timer per spec — no visible clock. Show only tracking warnings.
          if (!hasFace) {
            pxText(ctx, 'show your face', cx, cy - 1.5, '0.55px Fredoka', rose, 'center');
          } else if (isBlinking) {
            pxText(ctx, 'open your eyes', cx, cy - 1.5, '0.55px Fredoka', stone, 'center');
          }
          // Debug overlay: live scatter + time-series tucked in the bottom corners.
          if (debug) {
            drawScatterPanel(ctx, 0.3, 5.8, 3.0, 3.0);
            drawTimeSeriesPanel(ctx, 4.0, 7.5, 11.7, 1.4);
          }
        } else if (phase === 'result' && resultTier) {
          const tierColor = TIER_COLORS[resultTier];

          pxText(ctx, resultTier, cx, 1.4, '1.4px Fredoka', tierColor, 'center');

          // Panels end at y≈7.8 to clear the bottom touch button bar.
          drawScatterPanel(ctx, 0.5, 2.5, 6.5, 5.3);
          drawTimeSeriesPanel(ctx, 7.3, 2.5, 8.3, 2.5);
          drawDiagnosticsPanel(ctx, 7.3, 5.1, 8.3, 2.7);

          // Low-sample-rate trust banner.
          const hz = sampleRateHz();
          if (hz > 0 && hz < 15) {
            pxText(ctx, 'low sample rate — consider retaking with better lighting', cx, gh - 1.1, '0.26px Sora', rose, 'center');
          }
        }
      },

      extraButtons: [
        {
          label: 'start (space)', key: ' ',
          onClick: () => {
            if (canStart()) startTest();
            else if (phase === 'result') resetToReady();
          },
        },
      ],

      demo() {
        // Static preview: frozen on a Locked In result with plausible gaze samples.
        clearRun();
        phase = 'result';
        resultTier = 'Locked In';
        checkpointsPassed = 3;
        const N = 180;
        const duration = 60;
        // Box-Muller-ish deterministic noise for reproducible preview.
        const eyePoints: { t: number; x: number; y: number }[] = [];
        for (let i = 0; i < N; i++) {
          const t = (i / N) * duration;
          const u1 = ((i * 13 + 7) % 97) / 97 + 0.01;
          const u2 = ((i * 29 + 11) % 53) / 53 + 0.01;
          const r = Math.sqrt(-2 * Math.log(u1));
          const x = r * Math.cos(2 * Math.PI * u2) * 0.35;
          const y = r * Math.sin(2 * Math.PI * u2) * 0.35;
          eyePoints.push({ t, x, y });
        }
        eyePoints.push({ t: 20, x: 2.3, y: -0.8 });
        eyePoints.push({ t: 47, x: -1.6, y: 2.1 });
        eyePoints.sort((a, b) => a.t - b.t);
        for (const { t, x, y } of eyePoints) {
          addSample(stats, x, y);
          const dev = Math.hypot(x, y);
          const bceaAt = bcea95(stats);
          samples.push({ t, x, y, dev, bcea: bceaAt });
          validCount++;
          if (dev > SACCADE_DEG) {
            if (!inIntrusion) { saccadeCount++; inIntrusion = true; }
          } else {
            inIntrusion = false;
          }
          if (dev > peakDev) peakDev = dev;
          sumDev += dev;
        }
        elapsed = duration;
        resultBcea = bcea95(stats);
      },

      cleanup() {
        if (keyHandler) {
          document.removeEventListener('keydown', keyHandler);
          keyHandler = null;
        }
        if (linksEl && linksEl.parentElement) {
          linksEl.parentElement.removeChild(linksEl);
          linksEl = null;
        }
        if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
      },
    };
  })(),
};
