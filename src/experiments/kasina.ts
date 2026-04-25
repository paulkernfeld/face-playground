import type { Experiment, FaceData, Blendshapes } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { charcoal, stone, rose, cream, honey, sage } from '../palette';
import { createBceaStats, addSample, bcea95, bcea95Ellipse, type BceaStats, type BceaEllipse } from '../bcea';

// One-Minute Focus Test — spec v0.1.
// Stare at the dot; BCEA@95% of your gaze over the whole test is checked at each checkpoint.

// Linear conversion from blendshape units to visual-angle degrees.
// Was 30 (anchored on ARKit "fully looking" ≈ 30°), then 10 after pilot showed
// dots landing well outside the threshold rings. Bumped back to 20 because 10 was
// too forgiving — most runs cleared Cracked. Tune with more pilot data.
const BLENDSHAPE_TO_DEG = 20;

// Gated checkpoints — cumulative BCEA@95% must be below the threshold to pass.
// Baseline thresholds from quintile calibration against Longhin et al. 2016 MAIA
// (N=358 IR fixation data). Tune empirically with pilot data.
const CHECKPOINTS_SEC =      [3,   10,  30,  60];
const TIER_THRESHOLDS_DEG2 = [3.4, 2.2, 1.5, 1.0];
const TEST_CEILING_SEC = 180;

type Tier = 'Cooked' | 'Scroller' | 'Normie' | 'Locked In' | 'Cracked';
const TIERS: Tier[] = ['Cooked', 'Scroller', 'Normie', 'Locked In', 'Cracked'];
const TIER_COLORS: Record<Tier, string> = {
  'Cracked': sage, 'Locked In': sage, 'Normie': honey, 'Scroller': honey, 'Cooked': rose,
};

const BLINK_THRESHOLD = 0.2;
const MAX_BLINK_SEC = 2.0;
const POST_BLINK_GRACE_SEC = 0.4;   // gaze blendshapes are unreliable as the lid reopens
const PREVIEW_WINDOW_SEC = 4;       // rolling window of recent samples shown on the ready screen
const MAX_NO_FACE_SEC = 1.5;
const SACCADE_DEG = 2.0;            // samples farther than this from center count as saccadic intrusions

// Plot ranges are fixed (no auto-zoom) so "your trace crossed the line = you lose"
// is a clean visual semantic. SCATTER_MAX_DEG is set so the largest tier ring sits
// inside the panel; TIME_SERIES_MAX_DEG2 is set so the easiest threshold is mid-plot.
const SCATTER_MAX_DEG = 2.5;
const TIME_SERIES_MAX_DEG2 = 15;

// Nose-tip BCEA is computed in game units, then approximated to camera-FOV deg²
// using a typical 60° H × 16-game-unit-wide canvas. This is "how much of the
// camera view the nose swept across", not head rotation in user-perspective deg.
const NOSE_TIP = 1;
const GU_TO_CAMERA_DEG = 60 / 16;   // ≈ 3.75° per game unit

// Slow-drift calibration point. The "center" the user is fixating on is allowed to
// creep at this rate (deg/s) toward where their eyes are actually pointing — so a
// gradual posture shift doesn't accumulate as BCEA. Fast saccades still register
// because the calibration can't keep up. Reset at the start of ready and active.
const CALIBRATION_DRIFT_DEG_PER_SEC = 3;

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

  ...(() => {
    let phase: Phase;
    let elapsed: number;
    let stats: BceaStats;
    let checkpointsPassed: number;
    let resultTier: Tier | null;
    let resultBcea: number;
    let rc: GameRoughCanvas;

    let samples: Sample[];
    let saccadeCount: number;
    let peakDev: number;
    let sumDev: number;
    let validCount: number;
    let invalidCount: number;    // frames during active phase that didn't yield a sample (blink/no-face)

    // Head-movement baseline. Nose tip is sampled every frame regardless of blink
    // because head wobble is independent of eye state — it tells you how stable
    // the body is, which sets a floor for how stable the eyes can be.
    let noseStats: BceaStats;
    let noseValidCount: number;

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
      noFaceDuration = 0;
      samples = [];
      saccadeCount = 0;
      peakDev = 0;
      sumDev = 0;
      validCount = 0;
      invalidCount = 0;
      noseStats = createBceaStats();
      noseValidCount = 0;
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

    function startTest() {
      phase = 'active';
      clearRun();
      setLinksVisible(false);
    }

    function endTest() {
      resultTier = TIERS[Math.min(checkpointsPassed, 4)];
      resultBcea = bcea95(stats);
      phase = 'result';
      setLinksVisible(true);
    }

    // Each tier threshold is rendered as an area-equivalent circle (r = √(t/π)).
    // BCEA is variance-based (deg²) and the plot axes are linear deviation (deg),
    // so this is an approximation — but it lets you eyeball "am I inside Monk?".
    const RING_TIERS: Tier[] = ['Scroller', 'Normie', 'Locked In', 'Cracked'];

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

      // Labels on dark background. BCEA displayed is live/cumulative, not a frozen value.
      const liveBcea = bcea95(stats);
      if (resultTier) {
        pxText(ctx, resultTier, px + pw - 0.2, py + 0.4, '0.4px Fredoka', TIER_COLORS[resultTier], 'right');
      }
      pxText(ctx, `BCEA@95%: ${liveBcea.toFixed(2)} deg²`, px + 0.2, py + 0.4, '0.28px Sora', cream, 'left');
      pxText(ctx, 'one-minute focus test', px + pw / 2, py + ph - 0.15, '0.2px Sora', stone, 'center');
    }

    const CHECKPOINT_LABELS = ['Scroller', 'Normie', 'Locked In', 'Cracked'];

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

      pxText(ctx, 'BCEA over time — stay under the ceiling', px + 0.1, py + 0.3, '0.22px Sora', stone, 'left');

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

      // Convert nose BCEA from game-units² to camera-FOV deg² (rough comparison
      // baseline against the eye BCEA — same units, different physical thing).
      const headBcea = bcea95(noseStats) * GU_TO_CAMERA_DEG * GU_TO_CAMERA_DEG;
      const cells: { label: string; value: string; color?: string }[] = [
        { label: 'sample rate',    value: `${hz.toFixed(1)} Hz`, color: sampleRateColor(hz) },
        { label: '% valid',        value: `${validPct.toFixed(0)}%` },
        { label: 'intrusions',     value: `${saccadeCount}` },
        { label: 'peak error',     value: `${peakDev.toFixed(2)}°` },
        { label: 'mean error',     value: `${meanDev.toFixed(2)}°` },
        { label: 'eye BCEA',       value: `${resultBcea.toFixed(2)} deg²` },
        { label: 'head BCEA',      value: `${headBcea.toFixed(2)} deg²` },
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
          if (phase === 'ready' && hasFace && !isBlinking) {
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
        if (!face) {
          hasFace = false;
          isBlinking = false;
          if (phase === 'active') {
            noFaceDuration += dt;
            invalidCount++;
            if (noFaceDuration > MAX_NO_FACE_SEC) endTest();
          }
          return;
        }

        hasFace = true;
        noFaceDuration = 0;

        const blinkL = face.blendshapes.get('eyeBlinkLeft') ?? 0;
        const blinkR = face.blendshapes.get('eyeBlinkRight') ?? 0;
        isBlinking = blinkL > BLINK_THRESHOLD || blinkR > BLINK_THRESHOLD;

        if (phase === 'ready') {
          // Rolling-window live preview. Same blink/post-blink filtering as the test.
          if (isBlinking) {
            postBlinkTimer = POST_BLINK_GRACE_SEC;
          } else if (postBlinkTimer > 0) {
            postBlinkTimer -= dt;
          } else {
            const [rawX, rawY] = extractGazeDeg(face.blendshapes);
            const [gx, gy] = applyCalibration(rawX, rawY, dt);
            const dev = Math.hypot(gx, gy);
            elapsed += dt;
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

        // Nose-tip jitter is independent of blink; sample it every frame.
        const nose = face.landmarks[NOSE_TIP];
        if (nose) {
          addSample(noseStats, nose.x, nose.y);
          noseValidCount++;
        }

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
          if (dev > SACCADE_DEG) saccadeCount++;
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

        // 180s ceiling: Monk already earned at 60s, this just ends the test.
        if (elapsed >= TEST_CEILING_SEC) { endTest(); return; }
      },

      draw(ctx: CanvasRenderingContext2D, gw: number, gh: number, debug?: boolean) {
        const cx = gw / 2;
        const cy = gh / 2;

        // Fixation target — shown during ready/active only; the result screen uses the space.
        if (phase !== 'result') {
          rc.circle(cx, cy, 0.5, { fill: charcoal, fillStyle: 'solid', stroke: charcoal, strokeWidth: 0.02 });
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
        }

        if (phase === 'ready') {
          pxText(ctx, 'One-Minute Focus Test', cx, 1.0, '0.7px Fredoka', charcoal, 'center');
          pxText(ctx, 'Pick something to look at — the dot, anything.', cx, 1.9, '0.32px Sora', stone, 'center');
          pxText(ctx, 'Hit start, then hold your gaze on it until the test ends.', cx, 2.4, '0.32px Sora', stone, 'center');
          pxText(ctx, 'Steady gaze ≈ steady attention. We measure how steady.',  cx, 2.9, '0.32px Sora', stone, 'center');
          const prompt = !hasFace ? 'show your face' : isBlinking ? 'open your eyes' : 'press space to start';
          pxText(ctx, prompt, cx, gh - 2.0, '0.5px Fredoka', charcoal, 'center');
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

          // Scatter panel (hero / shareable artifact) — square, left-centered.
          drawScatterPanel(ctx, 0.5, 2.5, 6.5, 6.0);
          // Right column: time-series on top, diagnostics below.
          drawTimeSeriesPanel(ctx, 7.3, 2.5, 8.3, 2.7);
          drawDiagnosticsPanel(ctx, 7.3, 5.4, 8.3, 3.1);

          // Low-sample-rate trust banner.
          const hz = sampleRateHz();
          if (hz > 0 && hz < 15) {
            pxText(ctx, 'low sample rate — consider retaking with better lighting', cx, gh - 0.8, '0.26px Sora', rose, 'center');
          }

          pxText(ctx, 'space to retake', cx, gh - 0.35, '0.4px Fredoka', charcoal, 'center');
        }
      },

      extraButtons: [
        {
          label: 'start (space)', key: ' ',
          onClick: () => {
            if (phase === 'ready' && hasFace && !isBlinking) startTest();
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
          if (dev > SACCADE_DEG) saccadeCount++;
          if (dev > peakDev) peakDev = dev;
          sumDev += dev;
        }
        // Fake nose-tip drift (tight, in game units) to give the head-BCEA cell a value.
        for (let i = 0; i < N; i++) {
          const u1 = ((i * 17 + 3) % 89) / 89 + 0.01;
          const u2 = ((i * 23 + 5) % 71) / 71 + 0.01;
          const r = Math.sqrt(-2 * Math.log(u1));
          const nx = 8 + r * Math.cos(2 * Math.PI * u2) * 0.02;
          const ny = 4.5 + r * Math.sin(2 * Math.PI * u2) * 0.015;
          addSample(noseStats, nx, ny);
          noseValidCount++;
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
