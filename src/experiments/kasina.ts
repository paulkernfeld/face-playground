import type { Experiment, FaceData, Blendshapes } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { charcoal, stone, rose, teal, cream, honey, sage, lavender } from '../palette';
import { createBceaStats, addSample, bcea95, bcea95Ellipse, type BceaStats, type BceaEllipse } from '../bcea';

// One-Minute Focus Test — spec v0.1.
// Stare at the dot; BCEA@95% of your gaze over the whole test is checked at each checkpoint.

// Placeholder linear conversion from blendshape units to visual-angle degrees.
// Tune empirically after pilot users.
const BLENDSHAPE_TO_DEG = 30;

// Gated checkpoints — cumulative BCEA@95% must be below the threshold to pass.
// Thresholds from quintile calibration against Longhin et al. 2016 MAIA normative
// data (N=358), fitted as log-normal: mean=2.40 deg², SD=2.04, μ≈0.60, σ≈0.74.
// Each cutoff is the inverse-CDF at the population quintile for that tier.
// Caveats: duration-invariance is a first-order approximation; webcam is ~6×
// noisier than MAIA IR tracking, so real-hardware thresholds will likely need
// a multiplicative scale once pilot data arrives. Centralized here so retuning
// is a one-line change.
const CHECKPOINTS_SEC =      [3,   10,  30,  60];
const TIER_THRESHOLDS_DEG2 = [3.4, 2.2, 1.5, 1.0];
const TEST_CEILING_SEC = 180;

type Tier = 'Cooked' | 'Scroll' | 'Scatter' | 'Deep Work' | 'Monk';
const TIERS: Tier[] = ['Cooked', 'Scroll', 'Scatter', 'Deep Work', 'Monk'];
const ROASTS: Record<Tier, string> = {
  'Monk':      "You held still for a minute. Most modern brains can't. What are you doing with your life.",
  'Deep Work': "Top-shelf focus. You probably get things done.",
  'Scatter':   "A functional modern brain. Congratulations?",
  'Scroll':    "Your attention is in feed-mode. You are most of us.",
  'Cooked':    "lol",
};
const TIER_COLORS: Record<Tier, string> = {
  'Monk': sage, 'Deep Work': teal, 'Scatter': honey, 'Scroll': lavender, 'Cooked': rose,
};

const BLINK_THRESHOLD = 0.5;
const MAX_BLINK_SEC = 2.0;
const MAX_NO_FACE_SEC = 1.5;
const SACCADE_DEG = 2.0;   // samples farther than this from center count as saccadic intrusions

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

    let blinkDuration: number;
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
      noFaceDuration = 0;
      samples = [];
      saccadeCount = 0;
      peakDev = 0;
      sumDev = 0;
      validCount = 0;
      invalidCount = 0;
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

    // The threshold to display on the scatter plot. Represents what the user
    // would need to beat to reach the next tier (or the Monk ceiling if they
    // already made it). Drawn as an area-equivalent circle.
    function scatterThresholdDeg2(): number {
      const idx = Math.min(checkpointsPassed, TIER_THRESHOLDS_DEG2.length - 1);
      return TIER_THRESHOLDS_DEG2[idx];
    }

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

      // Auto-scale so ellipse + threshold + samples all fit with a small margin.
      const ellipse = bcea95Ellipse(stats);
      const thresholdR = Math.sqrt(scatterThresholdDeg2() / Math.PI);
      const maxRange = Math.max(
        peakDev,
        ellipse ? Math.max(ellipse.a, ellipse.b) : 0,
        thresholdR,
        SACCADE_DEG,
      ) * 1.15;
      const scale = (plotBounds / 2) / maxRange;

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

      // Tier threshold — area-equivalent circle in contrasting color.
      ctx.strokeStyle = honey;
      ctx.lineWidth = 0.04;
      ctx.setLineDash([0.12, 0.1]);
      ctx.beginPath();
      ctx.arc(centerX, centerY, thresholdR * scale, 0, Math.PI * 2);
      ctx.stroke();
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

      // Sample dots: color by time (early faint → late bright); saccadic intrusions in rose.
      const totalT = samples.length ? samples[samples.length - 1].t : 1;
      const dotR = 0.05;
      for (const s of samples) {
        const alpha = 0.2 + 0.8 * (s.t / Math.max(totalT, 0.001));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.dev > SACCADE_DEG ? rose : cream;
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

      // Labels on dark background.
      if (resultTier) {
        pxText(ctx, resultTier, px + pw - 0.2, py + 0.4, '0.4px Fredoka', TIER_COLORS[resultTier], 'right');
      }
      pxText(ctx, `BCEA@95%: ${resultBcea.toFixed(2)} deg²`, px + 0.2, py + 0.4, '0.28px Sora', cream, 'left');
      pxText(ctx, 'one-minute focus test', px + pw / 2, py + ph - 0.15, '0.2px Sora', stone, 'center');
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

        if (phase !== 'active') return;

        if (isBlinking) {
          // Blinks don't contribute a sample, but the clock keeps running.
          blinkDuration += dt;
          invalidCount++;
          if (blinkDuration > MAX_BLINK_SEC) { endTest(); return; }
        } else {
          blinkDuration = 0;
          const [gx, gy] = extractGazeDeg(face.blendshapes);
          addSample(stats, gx, gy);
          const dev = Math.hypot(gx, gy);
          samples.push({ t: elapsed, x: gx, y: gy, dev });
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

      draw(ctx: CanvasRenderingContext2D, gw: number, gh: number, _debug?: boolean) {
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
          pxText(ctx, 'One-Minute Focus Test', cx, 1.4, '0.7px Fredoka', charcoal, 'center');
          pxText(ctx, 'How long can you actually hold still?', cx, 2.3, '0.45px Fredoka', stone, 'center');
          pxText(ctx, 'Most people fail in under 30 seconds.', cx, 3.0, '0.32px Sora', stone, 'center');
          const prompt = !hasFace ? 'show your face' : isBlinking ? 'open your eyes' : 'press space to start';
          pxText(ctx, prompt, cx, gh - 2.0, '0.5px Fredoka', charcoal, 'center');
          pxText(ctx, 'for entertainment, not medical assessment', cx, gh - 0.6, '0.22px Sora', stone, 'center');
        } else if (phase === 'active') {
          // Silent timer per spec — no visible clock. Show only tracking warnings.
          if (!hasFace) {
            pxText(ctx, 'show your face', cx, cy - 1.5, '0.55px Fredoka', rose, 'center');
          } else if (isBlinking) {
            pxText(ctx, 'open your eyes', cx, cy - 1.5, '0.55px Fredoka', stone, 'center');
          }
        } else if (phase === 'result' && resultTier) {
          const tierColor = TIER_COLORS[resultTier];

          // Header: tier + roast
          pxText(ctx, resultTier, cx, 0.95, '1.1px Fredoka', tierColor, 'center');
          const lines = wrap(ROASTS[resultTier], 60);
          let y = 1.75;
          for (const line of lines) {
            pxText(ctx, line, cx, y, '0.32px Sora', charcoal, 'center');
            y += 0.45;
          }

          // Scatter panel (hero / shareable artifact) — 6×6 square, left-centered.
          drawScatterPanel(ctx, 0.5, 2.5, 6.5, 6.0);

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
        // Static preview: frozen on a Deep Work result with plausible gaze samples.
        clearRun();
        phase = 'result';
        resultTier = 'Deep Work';
        checkpointsPassed = 3;
        const N = 180;
        const duration = 60;
        // Box-Muller-ish deterministic noise for reproducible preview.
        for (let i = 0; i < N; i++) {
          const t = (i / N) * duration;
          const u1 = ((i * 13 + 7) % 97) / 97 + 0.01;
          const u2 = ((i * 29 + 11) % 53) / 53 + 0.01;
          const r = Math.sqrt(-2 * Math.log(u1));
          const x = r * Math.cos(2 * Math.PI * u2) * 0.35;
          const y = r * Math.sin(2 * Math.PI * u2) * 0.35;
          addSample(stats, x, y);
          const dev = Math.hypot(x, y);
          samples.push({ t, x, y, dev });
          validCount++;
          if (dev > SACCADE_DEG) saccadeCount++;
          if (dev > peakDev) peakDev = dev;
          sumDev += dev;
        }
        // Throw in a couple of intrusions for visible red dots.
        const intrusions: [number, number, number][] = [[20, 2.3, -0.8], [47, -1.6, 2.1]];
        for (const [t, x, y] of intrusions) {
          addSample(stats, x, y);
          const dev = Math.hypot(x, y);
          samples.push({ t, x, y, dev });
          validCount++;
          if (dev > SACCADE_DEG) saccadeCount++;
          if (dev > peakDev) peakDev = dev;
          sumDev += dev;
        }
        samples.sort((a, b) => a.t - b.t);
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

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
