import type { Experiment } from "../types";
import { pxText } from '../px-text';
import { charcoal, stone, rose, honey, sage, terra, sky, lavender, teal } from '../palette';

// MorphCast Emotion AI SDK — client-side webcam → emotion / valence / arousal / attention / wish / positivity.
// License key loaded from VITE_MORPHCAST_KEY (set in .env or .env.local before vite starts).
// Free key: https://www.morphcast.com/sdk/
// Module docs: https://ai-sdk.morphcast.com/v1.16/docs/index.html
// Local cheatsheet: docs/morphcast.md

const MPH_TOOLS_URL = "https://sdk.morphcast.com/mphtools/v1.1/mphtools.js";
const AI_SDK_URL = "https://ai-sdk.morphcast.com/v1.16/ai-sdk.js";

// HD emotion model benefits from ≥640px input — keep default downscale off so
// the bigger model isn't wasted on a small frame.
const MORPHCAST_MAX_INPUT_FRAME_SIZE = 640;
// Intentionally NO per-module smoothness config. Two reasons:
//   1. The SDK's `smoothness: 1.0` semantics ("100% previous value") froze the
//      AV signal and `riseSmoothness: 1.0` froze attention — silent failures
//      that cost real debugging time.
//   2. We want raw signals on disk so future tweaks to smoothing reshape past
//      history too. All smoothing happens on our side (see smoothPoints in the
//      ≥60s panels).
// Modules are added bare; the SDK uses its built-in defaults.

type Status = 'no-key' | 'loading' | 'running' | 'error';

const EMOTIONS = ['Happy', 'Surprise', 'Neutral', 'Sad', 'Fear', 'Disgust', 'Angry'] as const;
type Emotion = typeof EMOTIONS[number];
const EMOTION_COLORS: Record<Emotion, string> = {
  Happy: honey,
  Surprise: teal,
  Neutral: stone,
  Sad: sky,
  Fear: lavender,
  Disgust: sage,
  Angry: rose,
};

type SignalKey = 'attention' | 'wish' | 'positivity' | 'valence' | 'arousal' | 'headMotion';
const SIGNAL_KEYS: SignalKey[] = ['attention', 'wish', 'positivity', 'valence', 'arousal', 'headMotion'];
const SIGNAL_COLORS: Record<SignalKey, string> = {
  attention: charcoal,
  wish: lavender,
  positivity: honey,
  valence: terra,
  arousal: rose,
  headMotion: sage,
};
// Per MorphCast: valence/arousal/positivity are -1..1; attention/wish are 0..1.
// Plot all on a shared 0..1 axis (midline 0.5 = zero for signed signals).
const SIGNED: Record<SignalKey, boolean> = {
  attention: false, wish: false, positivity: true, valence: true, arousal: true,
  headMotion: false,
};
const NORMALIZE: Record<SignalKey, (v: number) => number> = {
  attention: v => v,
  wish: v => v,
  positivity: v => (v + 1) / 2,
  valence: v => (v + 1) / 2,
  arousal: v => (v + 1) / 2,
  headMotion: v => v,
};
// Pose feeds headMotion (derived) only — not rendered as its own signal lines.
type PoseAxis = 'pitch' | 'yaw' | 'roll';
const POSE_AXES: PoseAxis[] = ['pitch', 'yaw', 'roll'];

// Derived meditation metrics: rough conjectures, expect to tune w/ playtest.
const DERIVED_KEYS = [
  'restlessness', 'desire', 'aversion', 'sloth', 'hindrance',
] as const;
type DerivedKey = typeof DERIVED_KEYS[number];
const DERIVED_COLORS: Record<DerivedKey, string> = {
  restlessness: rose,
  desire: lavender,
  aversion: sky,
  sloth: stone,
  hindrance: charcoal,
};

let status: Status = 'no-key';
let statusMsg = '';

let licenseKey = '';
let stopFn: (() => void) | null = null;
let listenersAttached = false;

const latest: Record<SignalKey, number> = {
  attention: 0, wish: 0, positivity: 0, valence: 0, arousal: 0, headMotion: 0,
};
const pose: Record<PoseAxis, number> = { pitch: 0, yaw: 0, roll: 0 };
const EMPTY_EMO = (): Record<Emotion, number> =>
  ({ Happy: 0, Surprise: 0, Neutral: 1, Sad: 0, Fear: 0, Disgust: 0, Angry: 0 });
// Using FACE_EMOTION_HD only — standard EMOTION dropped per playtest decision (HD is better calibrated).
let emotion: Record<Emotion, number> = EMPTY_EMO();
const latestDerived: Record<DerivedKey, number> = {
  restlessness: 0, desire: 0, aversion: 0, sloth: 0, hindrance: 0,
};
// Russell quadrant label — kept for the dump (still in firstPayloads + window.__morphcast),
// no longer shown in the header. The header now shows a derived emoji instead.
let quadrant = '';

// Two-tier emoji per Ekman emotion: strong (≥0.7 confidence) vs mild (0.4–0.7).
// If no emotion clears 0.4, fall through to a Russell V/A zone lookup.
const STRONG_EMOJI: Record<Emotion, string> = {
  Happy:    '😄',
  Sad:      '😭',
  Angry:    '😡',
  Surprise: '🤯',
  Fear:     '😱',
  Disgust:  '🤮',
  Neutral:  '😐',
};
const MILD_EMOJI: Record<Emotion, string> = {
  Happy:    '🙂',
  Sad:      '😢',
  Angry:    '😠',
  Surprise: '😲',
  Fear:     '😨',
  Disgust:  '🤢',
  Neutral:  '😐',
};
const EMOTION_VERY_STRONG_T = 0.9;
const EMOTION_STRONG_T = 0.7;
const EMOTION_MILD_T   = 0.4;
const EMOTION_FAINT_T  = 0.25;
type EmoSnap = {
  emo: Record<Emotion, number>;
  valence: number; arousal: number;
  wish: number; attention: number; headMotion: number;
};
function emojiFromSnap(s: EmoSnap): string {
  // 1. Top tier — very strong Angry gets its own emoji.
  if (s.emo.Angry >= EMOTION_VERY_STRONG_T) return '🤬';
  // 2. Dominant Ekman emotion (strong / mild).
  let best: Emotion = 'Neutral';
  let bestVal = -Infinity;
  for (const e of EMOTIONS) {
    if (e === 'Neutral') continue;
    if (s.emo[e] > bestVal) { bestVal = s.emo[e]; best = e; }
  }
  if (bestVal >= EMOTION_STRONG_T) return STRONG_EMOJI[best];
  if (bestVal >= EMOTION_MILD_T)   return MILD_EMOJI[best];
  // 3. Quiet surprise — Surprise the only emotion with a "faint" tier.
  if (s.emo.Surprise >= EMOTION_FAINT_T) return '😯';
  // 4. Wish-driven craving when nothing on the Ekman wheel is loud.
  if (s.wish > 0.6 && s.valence > 0.2) return '🤤';
  // 5. Disoriented — head bouncing around while attention has drifted.
  if (s.headMotion > 0.3 && s.attention < 0.3) return '😵‍💫';
  // 6. V/A zones — most-specific first.
  const v = s.valence, a = s.arousal;
  if (a < -0.6)                            return '😴';   // deep sleepy
  if (a >  0.5 && v >  0.3)                return '🤩';   // excited
  if (v >  0.6 && a <  0.4)                return '🥰';   // warm / in love
  if (a < -0.3 && Math.abs(v) < 0.3)       return '🥱';   // slightly tired
  if (v < -0.3 && a >  0.3)                return '😩';   // whining
  if (v < -0.3 && a >  0)                  return '😖';   // struggling
  if (v < -0.3)                            return '😔';   // down
  if (v >  0.3)                            return '😌';   // content
  return '😐';
}
function deriveEmoji(): string {
  return emojiFromSnap({
    emo: emotion,
    valence: latest.valence, arousal: latest.arousal,
    wish: latest.wish, attention: latest.attention, headMotion: latest.headMotion,
  });
}
// Binary-search nearest point by t. Series is sorted ascending.
function nearestByT<T extends { t: number }>(arr: T[], t: number): T | null {
  if (arr.length === 0) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  const a = arr[Math.max(0, lo - 1)];
  const b = arr[lo];
  return Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
}
// Sample N evenly-spaced emojis across [tStart, tEnd] via a snapshot lookup.
// Returns null at sample times with no nearby data (within half a slot width),
// so empty regions stay visually empty instead of repeating the nearest emoji.
//
// Slot boundaries snap to a fixed time grid (multiples of slotW). Without
// snapping, every frame nudges slot midpoints forward by `dt`, which causes
// each slot's "nearest data point" to flip at a slightly different time —
// producing a constant wave of emoji swaps. Snapped boundaries hold each slot
// still until enough wall time passes to shift the whole row left by one slot.
function sampleEmojiRow(
  tStart: number, tEnd: number, n: number,
  snapAt: (t: number, maxGap: number) => EmoSnap | null,
): (string | null)[] {
  const slotW = (tEnd - tStart) / n;
  const snappedEnd = Math.ceil(tEnd / slotW) * slotW;
  const snappedStart = snappedEnd - (tEnd - tStart);
  const maxGap = slotW / 2;
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    const t = snappedStart + (i + 0.5) * slotW;
    const s = snapAt(t, maxGap);
    out.push(s ? emojiFromSnap(s) : null);
  }
  return out;
}
function emoPointToRecord(p: EmoPoint): Record<Emotion, number> {
  const r = EMPTY_EMO();
  for (const e of EMOTIONS) r[e] = p[e];
  return r;
}

let eventCount = 0;
const evtCounts: Record<string, number> = {};
// Raw payloads from the first event of each kind — lets us inspect modules whose
// schemas we haven't wired up yet (features, pose, HD emotion, aggregator).
const firstPayloads: Record<string, any> = {};
function captureFirst(name: string, evt: any) {
  if (firstPayloads[name]) return;
  try { firstPayloads[name] = JSON.parse(JSON.stringify(evt?.detail ?? null)); }
  catch { firstPayloads[name] = { _err: 'unserializable detail' }; }
  // eslint-disable-next-line no-console
  console.log(`[morphcast] first ${name}:`, evt?.detail);
}
function bumpCount(name: string) {
  evtCounts[name] = (evtCounts[name] ?? 0) + 1;
}

function exposeForTests() {
  (window as any).__morphcast = {
    status, statusMsg, eventCount,
    evtCounts: { ...evtCounts },
    firstPayloads,
    latest: { ...latest },
    // Back-compat with tests/morphcast.spec.ts which reads these at top level.
    valence: latest.valence,
    arousal: latest.arousal,
    attention: latest.attention,
    wish: latest.wish,
    positivity: latest.positivity,
    emotion: { ...emotion },
    pose: { ...pose },
    derived: { ...latestDerived },
    quadrant,
  };
}

const WINDOW_5MIN = 300;
const WINDOW_30S = 30;
const WINDOW_1H = 3600;
let elapsed = 0;
type TVPoint = { t: number; v: number };
type EmoPoint = { t: number } & Record<Emotion, number>;
type DerivedPoint = { t: number } & Record<DerivedKey, number>;
const signalSeries: Record<SignalKey, TVPoint[]> = {
  attention: [], wish: [], positivity: [], valence: [], arousal: [], headMotion: [],
};
const emoSeries: EmoPoint[] = [];
const derivedSeries: DerivedPoint[] = [];
// Rolling pose buffer for headMotion = std-dev over the last few seconds.
// Captures fidgeting AND slow drift (a still-but-tilted head reads zero, which
// is the point — we want motion, not displacement from neutral).
const HEAD_MOTION_WINDOW_SEC = 3;
// Pose values are radians-ish (~0..0.3 in normal movement); std-dev × 5 maps
// active fidgeting into a roughly 0..1 visible range.
const HEAD_MOTION_SCALE = 5;
// Calibration: meditator-still still reads ~15% from sensor noise alone, and
// even vigorous fidgeting rarely pegs the line. Subtract a dead zone and
// compress the remaining range so the line sits low when calm and reaches
// ~40% in active movement.
const HEAD_MOTION_DEAD_ZONE = 0.15;
const HEAD_MOTION_MAX_OUT = 0.40;
const poseBuffer: Array<{ t: number; pitch: number; yaw: number; roll: number }> = [];
function computeHeadMotion(): number {
  const cutoff = elapsed - HEAD_MOTION_WINDOW_SEC;
  while (poseBuffer.length && poseBuffer[0].t < cutoff) poseBuffer.shift();
  const n = poseBuffer.length;
  if (n < 2) return 0;
  let sp = 0, sy = 0, sr = 0;
  for (const p of poseBuffer) { sp += p.pitch; sy += p.yaw; sr += p.roll; }
  const mp = sp / n, my = sy / n, mr = sr / n;
  let vp = 0, vy = 0, vr = 0;
  for (const p of poseBuffer) {
    vp += (p.pitch - mp) ** 2; vy += (p.yaw - my) ** 2; vr += (p.roll - mr) ** 2;
  }
  const std = Math.sqrt((vp + vy + vr) / n);
  const raw = std * HEAD_MOTION_SCALE;
  return Math.max(0, (raw - HEAD_MOTION_DEAD_ZONE) * HEAD_MOTION_MAX_OUT / (1 - HEAD_MOTION_DEAD_ZONE));
}
function trim(arr: { t: number }[]) {
  const cutoff = elapsed - WINDOW_5MIN;
  while (arr.length && arr[0].t < cutoff) arr.shift();
}

// --- 24h persistence ---
// One minute snapshots of every metric, persisted across sessions in
// localStorage. Each save requires ≥15s of accumulated update() time in the
// past wall-clock minute (low-quality minutes get skipped, not zeroed).
const HISTORY_LS_KEY = 'morphcast.history.v1';
const HISTORY_INTERVAL_SEC = 60;
const HISTORY_MIN_DATA_SEC = 15;
// Retain 24h on disk even if we only display 1h, so coming back later still shows context.
const HISTORY_RETAIN_SEC = 86400;
// Raw-signals-only on disk by design — derived metrics (restlessness, hindrance,
// emoji, etc.) get recomputed at render time so formula tweaks reshape past
// history too. Old payloads with a `derived` field are tolerated (extra fields
// just ride along until trimmed); we never read or write it.
type HistorySample = {
  t: number; // epoch seconds
  signals: Record<SignalKey, number>;
  emotion: Record<Emotion, number>;
};
let historySamples: HistorySample[] = [];
let lastSaveWallSec = 0;
let elapsedAtLastSave = 0;
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_LS_KEY);
    if (!raw) { historySamples = []; return; }
    const parsed = JSON.parse(raw);
    historySamples = Array.isArray(parsed?.samples) ? parsed.samples : [];
  } catch { historySamples = []; }
  trimHistory();
}
function trimHistory() {
  const cutoff = Date.now() / 1000 - HISTORY_RETAIN_SEC;
  while (historySamples.length && historySamples[0].t < cutoff) historySamples.shift();
}
function persistHistory() {
  try {
    localStorage.setItem(HISTORY_LS_KEY, JSON.stringify({ samples: historySamples }));
  } catch { } // QuotaExceeded etc. — drop silently rather than crash the render.
}
function maybeSnapshot() {
  const nowSec = Date.now() / 1000;
  const dataSec = elapsed - elapsedAtLastSave;
  const wallSec = nowSec - lastSaveWallSec;
  if (wallSec < HISTORY_INTERVAL_SEC || dataSec < HISTORY_MIN_DATA_SEC) return;
  historySamples.push({
    t: nowSec,
    signals: { ...latest },
    emotion: { ...emotion },
  });
  trimHistory();
  persistHistory();
  lastSaveWallSec = nowSec;
  elapsedAtLastSave = elapsed;
}
// Flatten history samples into the per-metric shapes the panels already expect.
function historyEmoPoints(): EmoPoint[] {
  return historySamples.map(s => ({ t: s.t, ...s.emotion }));
}
function historyDerivedPoints(): DerivedPoint[] {
  return historySamples.map(s => deriveAt(s.t, {
    valence: s.signals.valence,
    arousal: s.signals.arousal,
    attention: s.signals.attention,
    wish: s.signals.wish,
    positivity: s.signals.positivity,
    headMotion: s.signals.headMotion,
    anger: s.emotion.Angry,
    disgust: s.emotion.Disgust,
  }));
}
function historySignalPoints(k: SignalKey): TVPoint[] {
  return historySamples.map(s => ({ t: s.t, v: s.signals[k] }));
}

// Vite HMR — the SDK is a singleton, so tear down before module replacement.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    try { stopFn?.(); } catch { }
    stopFn = null;
    detachListeners();
    status = 'no-key';
  });
}

let sdkLoadPromise: Promise<void> | null = null;
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}
async function loadSDK(): Promise<void> {
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = (async () => {
    await loadScript(MPH_TOOLS_URL);
    await loadScript(AI_SDK_URL);
  })();
  return sdkLoadPromise;
}

function readKey(): string {
  return import.meta.env.VITE_MORPHCAST_KEY ?? '';
}

const onAV = (e: any) => {
  captureFirst('AV', e); bumpCount('av');
  const out = e?.detail?.output; if (!out) return;
  if (typeof out.valence === 'number') {
    latest.valence = out.valence;
    signalSeries.valence.push({ t: elapsed, v: out.valence });
    trim(signalSeries.valence);
  }
  if (typeof out.arousal === 'number') {
    latest.arousal = out.arousal;
    signalSeries.arousal.push({ t: elapsed, v: out.arousal });
    trim(signalSeries.arousal);
  }
  if (typeof out.quadrant === 'string') quadrant = out.quadrant;
  eventCount++;
};
const onAttention = (e: any) => {
  captureFirst('ATTENTION', e); bumpCount('attention');
  const a = e?.detail?.output?.attention;
  if (typeof a === 'number') {
    latest.attention = a;
    signalSeries.attention.push({ t: elapsed, v: a });
    trim(signalSeries.attention);
    eventCount++;
  }
};
const onWish = (e: any) => {
  captureFirst('WISH', e); bumpCount('wish');
  const w = e?.detail?.output?.wish;
  if (typeof w === 'number') {
    latest.wish = w;
    signalSeries.wish.push({ t: elapsed, v: w });
    trim(signalSeries.wish);
    eventCount++;
  }
};
const onPositivity = (e: any) => {
  captureFirst('POSITIVITY', e); bumpCount('positivity');
  const out = e?.detail?.output;
  // Field name not in publicly indexed docs — try plausible scalars, capture raw via firstPayloads.
  const p = typeof out?.positivity === 'number' ? out.positivity
    : typeof out?.score === 'number' ? out.score
      : typeof out?.value === 'number' ? out.value
        : undefined;
  if (typeof p === 'number') {
    latest.positivity = p;
    signalSeries.positivity.push({ t: elapsed, v: p });
    trim(signalSeries.positivity);
    eventCount++;
  }
};
const onEmotionHD = (e: any) => {
  captureFirst('EMOTION_HD', e); bumpCount('emotion_hd');
  const out = e?.detail?.output?.emotion; if (!out) return;
  for (const k of EMOTIONS) {
    if (typeof out[k] === 'number') emotion[k] = out[k];
  }
  emoSeries.push({ t: elapsed, ...emotion });
  trim(emoSeries);
  eventCount++;
};
const onPose = (e: any) => {
  captureFirst('POSE', e); bumpCount('pose');
  const p = e?.detail?.output?.pose; if (!p) return;
  for (const k of POSE_AXES) if (typeof p[k] === 'number') pose[k] = p[k];
  eventCount++;
};
// Aggregator: schema unknown — capture only for now; check `firstPayloads.AGGREGATOR` to wire.
const onAggregator = (e: any) => { captureFirst('AGGREGATOR', e); bumpCount('aggregator'); };

const LISTENERS: Array<[string, (e: any) => void]> = [
  ['CY_FACE_AROUSAL_VALENCE_RESULT', onAV],
  ['CY_FACE_ATTENTION_RESULT', onAttention],
  ['CY_FACE_WISH_RESULT', onWish],
  ['CY_FACE_POSITIVITY_RESULT', onPositivity],
  ['CY_FACE_POSE_RESULT', onPose],
  ['CY_FACE_EMOTION_HD_RESULT', onEmotionHD],
  ['CY_DATA_AGGREGATOR_RESULT', onAggregator],
];

function attachListeners() {
  if (listenersAttached) return;
  for (const [name, fn] of LISTENERS) window.addEventListener(name, fn as EventListener);
  listenersAttached = true;
}
function detachListeners() {
  if (!listenersAttached) return;
  for (const [name, fn] of LISTENERS) window.removeEventListener(name, fn as EventListener);
  listenersAttached = false;
}

async function bootMorphcast() {
  if (status === 'loading' || status === 'running') return;
  status = 'loading';
  statusMsg = 'loading MorphCast SDK…';
  exposeForTests();
  try {
    await loadSDK();
    const CY = (window as any).CY;
    if (!CY) throw new Error('CY global not available after SDK load');

    // Release main.ts's camera so MorphCast can claim it via its own getUserMedia.
    const video = document.getElementById('webcam') as HTMLVideoElement | null;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }

    statusMsg = 'initializing modules…';
    const mods = CY.modules();
    const loader = CY.loader().licenseKey(licenseKey);
    // Don't reassign: some builds return undefined from maxInputFrameSize() — call for side-effect only.
    if (typeof (loader as any).maxInputFrameSize === 'function') {
      (loader as any).maxInputFrameSize(MORPHCAST_MAX_INPUT_FRAME_SIZE);
    }
    const addIfAvailable = (key: string) => {
      const m = mods[key];
      if (!m) { console.warn(`[morphcast] module ${key} not in SDK build, skipping`); return; }
      loader.addModule(m.name);
    };
    // Skip FACE_AGE / FACE_GENDER / FACE_RACE / ALARM_* by design (ethics + not informative for our use).
    // FACE_QUALITY isn't in v1.16 build per probe — don't try to add.
    addIfAvailable('FACE_DETECTOR');
    addIfAvailable('FACE_AROUSAL_VALENCE');
    addIfAvailable('FACE_EMOTION_HD');
    addIfAvailable('FACE_ATTENTION');
    addIfAvailable('FACE_WISH');
    addIfAvailable('FACE_POSITIVITY');
    // Skip FACE_FEATURES — probe showed it returns CelebA attrs (Hair color, Eyeglasses,
    // Goatee), not blink rate or gaze direction. No use here.
    addIfAvailable('FACE_POSE');
    addIfAvailable('DATA_AGGREGATOR');

    attachListeners();
    const result = await loader.load();
    stopFn = result.stop;
    await result.start();
    status = 'running';
    statusMsg = '';
  } catch (err: any) {
    status = 'error';
    statusMsg = err?.message ?? String(err);
    detachListeners();
    try { stopFn?.(); } catch { }
    stopFn = null;
  }
  exposeForTests();
}

// --- Drawing ---

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string) {
  ctx.fillStyle = '#FFFCF5';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stone;
  ctx.lineWidth = 0.02;
  ctx.strokeRect(x, y, w, h);
  pxText(ctx, title, x + 0.2, y + 0.4, '0.22px Sora', stone, 'left');
}

// Time-based EWMA. Half-life is in seconds — irregular sample spacing handled
// via per-step alpha = 1 - 2^(-dt / halfLife). Used to calm the 5-min panels;
// 30-second panels stay raw so quick changes are still legible.
const SMOOTH_HALF_LIFE_SEC = 5;
// Derived meditation metrics — rough conjectures, expect to tune by playtest.
//   restlessness: high arousal — 0 below 0.5, ramps to 1 at 1.
//   desire:       wish (kāmacchanda proxy).
//   aversion:     max(anger%, disgust%, negative-valence) — whichever channel sees it.
//   sloth:        deep low arousal — 0 above -0.5, ramps to 1 at -1.
//   hindrance:    softmax-weighted blend of the four — at β=4 it's between
//                 max (β→∞) and mean (β→0), leaning toward whichever's loudest.
// (headMotion is a signal now, not derived — but it feeds into restlessness as
//  fidgeting is the body's version of an arousal spike.)
// Softmax-weighted blend: Σ xᵢ·exp(β·xᵢ) / Σ exp(β·xᵢ). β=∞ → max, β=0 → mean.
// Always lies in [min(x), max(x)] (it's a weighted average, with weights biased
// toward larger entries).
function softmaxBlend(xs: number[], beta: number): number {
  let num = 0, den = 0;
  for (const x of xs) {
    const w = Math.exp(beta * x);
    num += x * w;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

type DerivedInput = {
  valence: number; arousal: number; attention: number; wish: number;
  positivity: number; headMotion: number;
  anger: number; disgust: number;
};
function deriveAt(t: number, s: DerivedInput): DerivedPoint {
  const a = s.arousal;
  // No defensive clamping — if a metric drifts out of [0,1] that's a real bug
  // (in the formula or upstream signal) and we want to see it, not hide it.
  // Inner Math.max(0, …) is a relu (lerp floor that defines the metric); the
  // outer softmaxBlend is the aggregation, replacing what would otherwise be max/mean.
  const rst = softmaxBlend([s.headMotion, Math.max(0, 2 * a - 1)], 4);
  const des = s.wish;
  const avr = softmaxBlend([s.anger, s.disgust], 4);
  const slo = Math.max(0, -2 * a - 1);
  const hind = softmaxBlend([rst, des, avr, slo], 4);
  return {
    t,
    restlessness: rst,
    desire: des,
    aversion: avr,
    sloth: slo,
    hindrance: hind,
  };
}
function computeDerived() {
  poseBuffer.push({ t: elapsed, pitch: pose.pitch, yaw: pose.yaw, roll: pose.roll });
  const hm = computeHeadMotion();
  latest.headMotion = hm;
  signalSeries.headMotion.push({ t: elapsed, v: hm });
  trim(signalSeries.headMotion);
  const p = deriveAt(elapsed, {
    valence: latest.valence, arousal: latest.arousal,
    attention: latest.attention, wish: latest.wish, positivity: latest.positivity,
    headMotion: hm,
    anger: emotion.Angry, disgust: emotion.Disgust,
  });
  for (const k of DERIVED_KEYS) latestDerived[k] = p[k];
  derivedSeries.push(p);
  trim(derivedSeries);
}

function smoothPoints<P>(points: P[], getT: (p: P) => number, getV: (p: P) => number): TVPoint[] {
  if (points.length === 0) return [];
  const out: TVPoint[] = [];
  let prevT = getT(points[0]);
  let s = getV(points[0]);
  out.push({ t: prevT, v: s });
  for (let i = 1; i < points.length; i++) {
    const t = getT(points[i]);
    const v = getV(points[i]);
    const dt = Math.max(0, t - prevT);
    const alpha = 1 - Math.pow(2, -dt / SMOOTH_HALF_LIFE_SEC);
    s = s + alpha * (v - s);
    out.push({ t, v: s });
    prevT = t;
  }
  return out;
}

// Break the path when two consecutive samples are >maxGapX apart on the x axis
// (e.g. session gap, dropped events). Avoids drawing a misleading straight line
// across long stretches with no data.
function drawLine<P>(
  ctx: CanvasRenderingContext2D,
  pts: P[],
  getX: (p: P) => number,
  getY: (p: P) => number,
  maxGapX = Infinity,
) {
  let prevX: number | null = null;
  let inPath = false;
  ctx.beginPath();
  for (const p of pts) {
    const xx = getX(p); const yy = getY(p);
    if (prevX === null || xx - prevX > maxGapX) {
      if (inPath) ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      inPath = true;
    } else {
      ctx.lineTo(xx, yy);
    }
    prevX = xx;
  }
  if (inPath) ctx.stroke();
}

function plotFrame(ctx: CanvasRenderingContext2D, plotX: number, plotY: number, plotW: number, plotH: number, windowSec: number) {
  ctx.strokeStyle = '#EBE5D6';
  ctx.lineWidth = 0.012;
  for (let gx = 0; gx <= 6; gx++) {
    const xx = plotX + (gx / 6) * plotW;
    ctx.beginPath(); ctx.moveTo(xx, plotY); ctx.lineTo(xx, plotY + plotH); ctx.stroke();
  }
  ctx.strokeStyle = charcoal; ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(plotX, plotY); ctx.lineTo(plotX, plotY + plotH);
  ctx.lineTo(plotX + plotW, plotY + plotH);
  ctx.stroke();
  // Axis labels intentionally omitted (saves vertical/horizontal space — y is 0..1,
  // x is right-now to -window; window appears in panel title).
  void windowSec;
}

function windowLabel(sec: number): string {
  if (sec >= 3600) return `last ${sec / 3600} h`;
  if (sec >= 60) return `last ${sec / 60} min`;
  return `last ${sec}s`;
}

function drawEmoPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number, series: EmoPoint[], tNow: number) {
  drawPanel(ctx, x, y, w, h, `emotions — ${windowLabel(windowSec)}`);
  const padL = 0.15, padR = 1.5, padT = 0.55, padB = 0.15;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  plotFrame(ctx, plotX, plotY, plotW, plotH, windowSec);

  const t0 = tNow - windowSec;
  const tx = (t: number) => plotX + ((t - t0) / windowSec) * plotW;
  const ty = (v: number) => plotY + plotH - v * plotH;
  const visible = series.filter(p => p.t >= t0);
  const smooth = windowSec >= 60;
  const maxGap = plotW * 0.1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, plotY, plotW, plotH);
  ctx.clip();
  ctx.lineWidth = 0.03;
  for (const k of EMOTIONS) {
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = EMOTION_COLORS[k];
    if (smooth) {
      const sm = smoothPoints(visible, p => p.t, p => p[k]);
      drawLine(ctx, sm, p => tx(p.t), p => ty(p.v), maxGap);
    } else {
      drawLine(ctx, visible, p => tx(p.t), p => ty(p[k]), maxGap);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const legendX = plotX + plotW + 0.15;
  const items = EMOTIONS.map(k => ({ key: k, color: EMOTION_COLORS[k], v: emotion[k] }));
  items.sort((a, b) => b.v - a.v);
  let ly = plotY + 0.18;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(legendX, ly - 0.1, 0.14, 0.1);
    pxText(ctx, `${it.key.toLowerCase()} ${(it.v * 100).toFixed(0)}%`,
      legendX + 0.2, ly, '0.14px Sora', stone, 'left');
    ly += 0.2;
  }
}

function drawSignalPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number, sourceFor: (k: SignalKey) => TVPoint[], tNow: number) {
  drawPanel(ctx, x, y, w, h, `signals — ${windowLabel(windowSec)}`);
  const padL = 0.15, padR = 1.7, padT = 0.55, padB = 0.15;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  plotFrame(ctx, plotX, plotY, plotW, plotH, windowSec);

  // Midline = 0.5: zero for valence/arousal (which are normalized from -1..1).
  ctx.strokeStyle = '#D9D2BE';
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.moveTo(plotX, plotY + plotH / 2);
  ctx.lineTo(plotX + plotW, plotY + plotH / 2);
  ctx.stroke();

  const t0 = tNow - windowSec;
  const tx = (t: number) => plotX + ((t - t0) / windowSec) * plotW;
  const ty01 = (v: number) => plotY + plotH - v * plotH;
  const maxGap = plotW * 0.1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, plotY, plotW, plotH);
  ctx.clip();
  ctx.lineWidth = 0.035;
  const smooth = windowSec >= 60;
  for (const k of SIGNAL_KEYS) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = SIGNAL_COLORS[k];
    const visible = sourceFor(k).filter(p => p.t >= t0);
    const pts = smooth
      ? smoothPoints(visible, p => p.t, p => NORMALIZE[k](p.v))
      : visible.map(p => ({ t: p.t, v: NORMALIZE[k](p.v) }));
    drawLine(ctx, pts, p => tx(p.t), p => ty01(p.v), maxGap);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const legendX = plotX + plotW + 0.15;
  const items = SIGNAL_KEYS.map(k => ({ key: k, color: SIGNAL_COLORS[k], plot: NORMALIZE[k](latest[k]) }));
  items.sort((a, b) => b.plot - a.plot);
  let ly = plotY + 0.18;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(legendX, ly - 0.1, 0.14, 0.1);
    const raw = latest[it.key];
    const pct = raw * 100;
    const display = SIGNED[it.key]
      ? `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
      : `${pct.toFixed(0)}%`;
    pxText(ctx, `${it.key} ${display}`, legendX + 0.2, ly, '0.14px Sora', stone, 'left');
    ly += 0.2;
  }
}

function drawDerivedPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number, series: DerivedPoint[], tNow: number) {
  drawPanel(ctx, x, y, w, h, `meditation metrics (derived) — ${windowLabel(windowSec)}`);
  const padL = 0.15, padR = 1.9, padT = 0.55, padB = 0.15;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  plotFrame(ctx, plotX, plotY, plotW, plotH, windowSec);

  const t0 = tNow - windowSec;
  const tx = (t: number) => plotX + ((t - t0) / windowSec) * plotW;
  const ty = (v: number) => plotY + plotH - v * plotH;
  const visible = series.filter(p => p.t >= t0);
  const smooth = windowSec >= 60;
  const maxGap = plotW * 0.1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, plotY, plotW, plotH);
  ctx.clip();
  ctx.lineWidth = 0.03;
  for (const k of DERIVED_KEYS) {
    ctx.globalAlpha = 0.78;
    ctx.strokeStyle = DERIVED_COLORS[k];
    if (smooth) {
      const sm = smoothPoints(visible, p => p.t, p => p[k]);
      drawLine(ctx, sm, p => tx(p.t), p => ty(p.v), maxGap);
    } else {
      drawLine(ctx, visible, p => tx(p.t), p => ty(p[k]), maxGap);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const legendX = plotX + plotW + 0.12;
  const items = DERIVED_KEYS.map(k => ({ key: k, color: DERIVED_COLORS[k], v: latestDerived[k] }));
  items.sort((a, b) => b.v - a.v);
  let ly = plotY + 0.15;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(legendX, ly - 0.09, 0.13, 0.09);
    pxText(ctx, `${it.key} ${(it.v * 100).toFixed(0)}%`,
      legendX + 0.18, ly, '0.13px Sora', stone, 'left');
    ly += 0.16;
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, gw: number) {
  pxText(ctx, 'morphcast playground', gw / 2, 0.55, '0.45px Fredoka', charcoal, 'center');
  pxText(ctx, deriveEmoji(), gw / 2, 0.95, '0.5px Sora', charcoal, 'center');
}
// Minimal timeline strip of emojis above a column. Skips sample slots with no data.
function drawEmojiRow(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  emojis: (string | null)[],
) {
  const n = emojis.length;
  const step = w / n;
  for (let i = 0; i < n; i++) {
    const e = emojis[i];
    if (!e) continue;
    pxText(ctx, e, x + step * (i + 0.5), y + h * 0.7, '0.35px Sora', charcoal, 'center');
  }
}
const EMOJI_ROW_SAMPLES = 10;
function nearestVal(series: TVPoint[], t: number, maxGap: number): number {
  const p = nearestByT(series, t);
  return p && Math.abs(p.t - t) <= maxGap ? p.v : 0;
}
function liveSnapAt(t: number, maxGap: number): EmoSnap | null {
  const e = nearestByT(emoSeries, t);
  const v = nearestByT(signalSeries.valence, t);
  const a = nearestByT(signalSeries.arousal, t);
  if (!e || !v || !a) return null;
  if (Math.abs(e.t - t) > maxGap) return null;
  if (Math.abs(v.t - t) > maxGap) return null;
  if (Math.abs(a.t - t) > maxGap) return null;
  return {
    emo: emoPointToRecord(e),
    valence: v.v, arousal: a.v,
    wish:       nearestVal(signalSeries.wish, t, maxGap),
    attention:  nearestVal(signalSeries.attention, t, maxGap),
    headMotion: nearestVal(signalSeries.headMotion, t, maxGap),
  };
}
function historySnapAt(t: number, maxGap: number): EmoSnap | null {
  const s = nearestByT(historySamples, t);
  if (!s) return null;
  if (Math.abs(s.t - t) > maxGap) return null;
  return {
    emo: s.emotion,
    valence: s.signals.valence, arousal: s.signals.arousal,
    wish: s.signals.wish, attention: s.signals.attention, headMotion: s.signals.headMotion,
  };
}

function drawNoKey(ctx: CanvasRenderingContext2D, gw: number, gh: number) {
  pxText(ctx, 'no morphcast key', gw / 2, gh / 2 - 0.6, '0.55px Fredoka', charcoal, 'center');
  pxText(ctx, 'set VITE_MORPHCAST_KEY in .env.local and restart vite',
    gw / 2, gh / 2 + 0.1, '0.26px Sora', stone, 'center');
  pxText(ctx, '(free key at morphcast.com/sdk)',
    gw / 2, gh / 2 + 0.6, '0.2px Sora', stone, 'center');
}

function drawLoading(ctx: CanvasRenderingContext2D, gw: number, gh: number) {
  pxText(ctx, statusMsg || 'loading…', gw / 2, gh / 2, '0.5px Fredoka', stone, 'center');
}

function drawError(ctx: CanvasRenderingContext2D, gw: number, gh: number) {
  pxText(ctx, 'MorphCast error', gw / 2, gh / 2 - 0.5, '0.55px Fredoka', rose, 'center');
  pxText(ctx, statusMsg, gw / 2, gh / 2 + 0.2, '0.24px Sora', stone, 'center');
}

export const morphcast: Experiment = {
  name: 'morphcast',

  setup(_ctx, _w, _h) {
    licenseKey = readKey();
    elapsed = 0;
    eventCount = 0;
    for (const k of SIGNAL_KEYS) signalSeries[k].length = 0;
    emoSeries.length = 0;
    derivedSeries.length = 0;
    poseBuffer.length = 0;
    quadrant = '';
    pose.pitch = pose.yaw = pose.roll = 0;
    loadHistory();
    lastSaveWallSec = 0;
    elapsedAtLastSave = 0;
    if (licenseKey && status !== 'running' && status !== 'loading') {
      bootMorphcast();
    } else if (!licenseKey) {
      status = 'no-key';
    }
    exposeForTests();
  },

  update(_face, dt) {
    elapsed += dt;
    computeDerived();
    maybeSnapshot();
    exposeForTests();
  },

  draw(ctx, gw, gh) {
    drawHeader(ctx, gw);
    if (status === 'no-key') return drawNoKey(ctx, gw, gh);
    if (status === 'loading') return drawLoading(ctx, gw, gh);
    if (status === 'error') return drawError(ctx, gw, gh);

    // 3 rows × 3 cols (30s / 5min / 1h history): emotion (HD) | signals | derived.
    // Plus a thin emoji timeline strip above each column.
    const emojiRowH = 0.45;
    const emojiRowY = 1.15;
    const top = emojiRowY + emojiRowH + 0.05;
    const colGap = 0.2;
    const rowGap = 0.15;
    const colW = (gw - 0.4 - 2 * colGap) / 3;
    const rowH = (gh - top - 0.25 - 2 * rowGap) / 3;
    const col1X = 0.2;
    const col2X = col1X + colW + colGap;
    const col3X = col2X + colW + colGap;
    const row1 = top;
    const row2 = row1 + rowH + rowGap;
    const row3 = row2 + rowH + rowGap;

    const liveSig = (k: SignalKey) => signalSeries[k];
    const histSig = (k: SignalKey) => historySignalPoints(k);
    const histEmo = historyEmoPoints();
    const histDer = historyDerivedPoints();
    const nowEpoch = Date.now() / 1000;

    // Emoji timeline strips — aligned with the plot region of the emo panel directly
    // below (padL/padR mirror drawEmoPanel) so emoji x positions match chart x ticks.
    const emojiPadL = 0.15, emojiPadR = 1.5;
    const plotW = colW - emojiPadL - emojiPadR;
    drawEmojiRow(ctx, col1X + emojiPadL, emojiRowY, plotW, emojiRowH,
      sampleEmojiRow(elapsed - WINDOW_30S,  elapsed,  EMOJI_ROW_SAMPLES, liveSnapAt));
    drawEmojiRow(ctx, col2X + emojiPadL, emojiRowY, plotW, emojiRowH,
      sampleEmojiRow(elapsed - WINDOW_5MIN, elapsed,  EMOJI_ROW_SAMPLES, liveSnapAt));
    drawEmojiRow(ctx, col3X + emojiPadL, emojiRowY, plotW, emojiRowH,
      sampleEmojiRow(nowEpoch - WINDOW_1H,  nowEpoch, EMOJI_ROW_SAMPLES, historySnapAt));

    drawEmoPanel(ctx, col1X, row1, colW, rowH, WINDOW_30S, emoSeries, elapsed);
    drawEmoPanel(ctx, col2X, row1, colW, rowH, WINDOW_5MIN, emoSeries, elapsed);
    drawEmoPanel(ctx, col3X, row1, colW, rowH, WINDOW_1H, histEmo, nowEpoch);
    drawSignalPanel(ctx, col1X, row2, colW, rowH, WINDOW_30S, liveSig, elapsed);
    drawSignalPanel(ctx, col2X, row2, colW, rowH, WINDOW_5MIN, liveSig, elapsed);
    drawSignalPanel(ctx, col3X, row2, colW, rowH, WINDOW_1H, histSig, nowEpoch);
    drawDerivedPanel(ctx, col1X, row3, colW, rowH, WINDOW_30S, derivedSeries, elapsed);
    drawDerivedPanel(ctx, col2X, row3, colW, rowH, WINDOW_5MIN, derivedSeries, elapsed);
    drawDerivedPanel(ctx, col3X, row3, colW, rowH, WINDOW_1H, histDer, nowEpoch);
  },

  demo() {
    status = 'running';
    latest.attention = 0.78; latest.wish = 0.55; latest.positivity = 0.62;
    latest.valence = 0.4; latest.arousal = 0.2;
    pose.pitch = 0.05; pose.yaw = -0.1; pose.roll = 0.02;
    emotion = { Happy: 0.4, Surprise: 0.12, Neutral: 0.32, Sad: 0.06, Fear: 0.04, Disgust: 0.03, Angry: 0.03 };
    quadrant = 'High Control';
    elapsed = WINDOW_5MIN;
    const N = 150;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * WINDOW_5MIN;
      const phase = t * 0.05;
      signalSeries.attention.push({ t, v: 0.6 + 0.25 * Math.sin(t * 0.04) });
      signalSeries.wish.push({ t, v: 0.5 + 0.2 * Math.sin(t * 0.03 + 1) });
      signalSeries.positivity.push({ t, v: 0.55 + 0.2 * Math.sin(t * 0.025 + 2) });
      signalSeries.valence.push({ t, v: 0.3 + 0.5 * Math.sin(t * 0.03) });
      signalSeries.arousal.push({ t, v: 0.1 + 0.4 * Math.cos(t * 0.04) });
      signalSeries.headMotion.push({ t, v: Math.max(0, 0.3 + 0.3 * Math.sin(t * 0.08)) });
      emoSeries.push({
        t,
        Happy: Math.max(0, 0.40 + 0.20 * Math.sin(phase + 0.5)),
        Surprise: Math.max(0, 0.12 + 0.08 * Math.sin(phase + 1.5)),
        Neutral: Math.max(0, 0.32 + 0.15 * Math.sin(phase + 2.5)),
        Sad: Math.max(0, 0.08 + 0.08 * Math.sin(phase + 3.5)),
        Fear: Math.max(0, 0.05 + 0.04 * Math.sin(phase + 4.5)),
        Disgust: Math.max(0, 0.04 + 0.03 * Math.sin(phase + 5.5)),
        Angry: Math.max(0, 0.04 + 0.04 * Math.sin(phase + 6.5)),
      });
      derivedSeries.push(deriveAt(t, {
        valence: 0.3 + 0.5 * Math.sin(t * 0.03),
        arousal: 0.1 + 0.4 * Math.cos(t * 0.04),
        attention: 0.6 + 0.25 * Math.sin(t * 0.04),
        wish: 0.5 + 0.2 * Math.sin(t * 0.03 + 1),
        positivity: 0.55 + 0.2 * Math.sin(t * 0.025 + 2),
        headMotion: Math.max(0, 0.3 + 0.3 * Math.sin(t * 0.08)),
        anger: Math.max(0, 0.04 + 0.04 * Math.sin(t * 0.05 + 6.5)),
        disgust: Math.max(0, 0.04 + 0.03 * Math.sin(t * 0.05 + 5.5)),
      }));
    }
    Object.assign(latestDerived, derivedSeries[derivedSeries.length - 1]);
  },

  cleanup() {
    try { stopFn?.(); } catch { }
    stopFn = null;
    detachListeners();
    for (const k of SIGNAL_KEYS) signalSeries[k].length = 0;
    emoSeries.length = 0;
    derivedSeries.length = 0;
    poseBuffer.length = 0;
    quadrant = '';
    pose.pitch = pose.yaw = pose.roll = 0;
    elapsed = 0;
    eventCount = 0;
    for (const k of Object.keys(evtCounts)) delete evtCounts[k];
    for (const k of Object.keys(firstPayloads)) delete firstPayloads[k];
    status = 'no-key';
    statusMsg = '';
    exposeForTests();
  },
};
