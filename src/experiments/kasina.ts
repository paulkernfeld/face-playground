import type { Experiment, FaceData, Blendshapes } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { charcoal, stone, rose, teal, cream, honey, sage, lavender } from '../palette';
import { createBceaStats, addSample, bcea95, type BceaStats } from '../bcea';

// One-Minute Focus Test — spec v0.1.
// Stare at the dot; BCEA@95% of your gaze over the whole test is checked at each checkpoint.

// Placeholder linear conversion from blendshape units to visual-angle degrees.
// Tune empirically after pilot users.
const BLENDSHAPE_TO_DEG = 30;

const CHECKPOINTS_SEC = [3, 10, 30, 60, 180];
const THRESHOLDS_DEG2 = [8, 5, 3, 2, 1.2];

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

const PAPER_LINKS = [
  { label: 'BCEA — Kim 2022', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9112722/' },
  { label: 'microsaccades & attention', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7962679/' },
  { label: 'ADHD fixation stability', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12452707/' },
];

type Phase = 'ready' | 'active' | 'result';

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

    function resetToReady() {
      phase = 'ready';
      elapsed = 0;
      stats = createBceaStats();
      checkpointsPassed = 0;
      resultTier = null;
      resultBcea = 0;
      blinkDuration = 0;
      noFaceDuration = 0;
      setLinksVisible(false);
    }

    function startTest() {
      phase = 'active';
      elapsed = 0;
      stats = createBceaStats();
      checkpointsPassed = 0;
      blinkDuration = 0;
      noFaceDuration = 0;
      setLinksVisible(false);
    }

    function endTest() {
      resultTier = TIERS[Math.min(checkpointsPassed, 4)];
      resultBcea = bcea95(stats);
      phase = 'result';
      setLinksVisible(true);
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
          if (blinkDuration > MAX_BLINK_SEC) { endTest(); return; }
        } else {
          blinkDuration = 0;
          const [gx, gy] = extractGazeDeg(face.blendshapes);
          addSample(stats, gx, gy);
        }

        elapsed += dt;

        // Evaluate checkpoints in order. Cumulative BCEA over the whole test so far.
        while (checkpointsPassed < CHECKPOINTS_SEC.length
               && elapsed >= CHECKPOINTS_SEC[checkpointsPassed]) {
          const bcea = bcea95(stats);
          if (bcea <= THRESHOLDS_DEG2[checkpointsPassed]) {
            checkpointsPassed++;
            playTick();
            if (checkpointsPassed === CHECKPOINTS_SEC.length) { endTest(); return; }
          } else {
            endTest();
            return;
          }
        }
      },

      draw(ctx: CanvasRenderingContext2D, gw: number, gh: number, _debug?: boolean) {
        const cx = gw / 2;
        const cy = gh / 2;

        // Fixation target — circle with cross + center point, visible in all phases.
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
          const color = TIER_COLORS[resultTier];
          pxText(ctx, resultTier, cx, 1.8, '1.5px Fredoka', color, 'center');
          // Wrap long roast manually — pxText doesn't wrap.
          const lines = wrap(ROASTS[resultTier], 44);
          let y = 3.3;
          for (const line of lines) {
            pxText(ctx, line, cx, y, '0.4px Sora', charcoal, 'center');
            y += 0.6;
          }
          pxText(ctx, `BCEA@95%: ${resultBcea.toFixed(2)} deg²`, cx, gh - 2.7, '0.28px Sora', stone, 'center');
          pxText(ctx, 'space to retake', cx, gh - 2.0, '0.5px Fredoka', charcoal, 'center');
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
        // Static preview: frozen on a result screen.
        phase = 'result';
        resultTier = 'Deep Work';
        resultBcea = 2.4;
        checkpointsPassed = 3;
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
