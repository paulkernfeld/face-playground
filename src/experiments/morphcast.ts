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

// Smoothness param accepted by most MorphCast modules. SDK treats 1.0 as
// "100% previous value" (signal freezes — never updates), so cap just under at
// 0.95: heavy smoothing for the meditation use case, but values still breathe.
// (We also EWMA-smooth ourselves for the 5-min view; raw module smoothing is cheap.)
const MORPHCAST_SMOOTHNESS = 0.95;
// HD emotion model benefits from ≥640px input — keep default downscale off so
// the bigger model isn't wasted on a small frame.
const MORPHCAST_MAX_INPUT_FRAME_SIZE = 640;
// Per-module config. Only modules that accept `smoothness` get it — FACE_DETECTOR,
// FACE_POSE, DATA_AGGREGATOR reject unknown keys and silently fail to start (no
// events fire). Attention is asymmetric: rise slowly (don't claim presence until
// it's real) but drop instantly (catch lapses early).
const MODULE_CONFIG: Record<string, Record<string, number>> = {
  FACE_AROUSAL_VALENCE: { smoothness: MORPHCAST_SMOOTHNESS },
  FACE_EMOTION_HD:      { smoothness: MORPHCAST_SMOOTHNESS },
  FACE_ATTENTION:       { smoothness: MORPHCAST_SMOOTHNESS, riseSmoothness: 1.0, fallSmoothness: 0.0 },
  FACE_POSITIVITY:      { smoothness: MORPHCAST_SMOOTHNESS },
  FACE_WISH:            { smoothness: MORPHCAST_SMOOTHNESS },
};

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

type SignalKey = 'attention' | 'wish' | 'positivity' | 'valence' | 'arousal';
const SIGNAL_KEYS: SignalKey[] = ['attention', 'wish', 'positivity', 'valence', 'arousal'];
const SIGNAL_COLORS: Record<SignalKey, string> = {
  attention: charcoal,
  wish: lavender,
  positivity: honey,
  valence: terra,
  arousal: rose,
};
// valence/arousal are -1..1; others are 0..1. Plot all on a shared 0..1 axis.
const NORMALIZE: Record<SignalKey, (v: number) => number> = {
  attention: v => v,
  wish: v => v,
  positivity: v => v,
  valence: v => (v + 1) / 2,
  arousal: v => (v + 1) / 2,
};
// Pose feeds headMotion (derived) only — not rendered as its own signal lines.
type PoseAxis = 'pitch' | 'yaw' | 'roll';
const POSE_AXES: PoseAxis[] = ['pitch', 'yaw', 'roll'];

// Derived meditation metrics: rough conjectures, expect to tune w/ playtest.
// Hypothesis: low arousal (~-0.5) + low |valence| + present attention ≈ equanimity.
const DERIVED_KEYS = [
  'equanimity', 'relaxation', 'restlessness', 'desire', 'aversion', 'sloth',
  'headMotion', 'hindrance',
] as const;
type DerivedKey = typeof DERIVED_KEYS[number];
const DERIVED_COLORS: Record<DerivedKey, string> = {
  equanimity:   teal,
  relaxation:   sage,
  restlessness: rose,
  desire:       lavender,
  aversion:     charcoal,
  sloth:        stone,
  headMotion:   honey,
  hindrance:    terra,
};

let status: Status = 'no-key';
let statusMsg = '';

let licenseKey = '';
let stopFn: (() => void) | null = null;
let listenersAttached = false;

const latest: Record<SignalKey, number> = {
  attention: 0, wish: 0, positivity: 0, valence: 0, arousal: 0,
};
const pose: Record<PoseAxis, number> = { pitch: 0, yaw: 0, roll: 0 };
const EMPTY_EMO = (): Record<Emotion, number> =>
  ({ Happy: 0, Surprise: 0, Neutral: 1, Sad: 0, Fear: 0, Disgust: 0, Angry: 0 });
// Using FACE_EMOTION_HD only — standard EMOTION dropped per playtest decision (HD is better calibrated).
let emotion: Record<Emotion, number> = EMPTY_EMO();
const latestDerived: Record<DerivedKey, number> = {
  equanimity: 0, relaxation: 0, restlessness: 0, desire: 0, aversion: 0,
  sloth: 0, headMotion: 0, hindrance: 0,
};
// Russell quadrant label (kept for header readout; per-affect lines no longer rendered).
let quadrant = '';

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
let elapsed = 0;
type TVPoint = { t: number; v: number };
type EmoPoint = { t: number } & Record<Emotion, number>;
type DerivedPoint = { t: number } & Record<DerivedKey, number>;
const signalSeries: Record<SignalKey, TVPoint[]> = {
  attention: [], wish: [], positivity: [], valence: [], arousal: [],
};
const emoSeries: EmoPoint[] = [];
const derivedSeries: DerivedPoint[] = [];
function trim(arr: { t: number }[]) {
  const cutoff = elapsed - WINDOW_5MIN;
  while (arr.length && arr[0].t < cutoff) arr.shift();
}

// Vite HMR — the SDK is a singleton, so tear down before module replacement.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    try { stopFn?.(); } catch {}
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
      const config = MODULE_CONFIG[key] ?? {};
      loader.addModule(m.name, config);
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
    try { stopFn?.(); } catch {}
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
//   equanimity:   calm + neutral + present.
//   relaxation:   negative-arousal-leaning, mildly pleasant, attentive (not slothful).
//   restlessness: high arousal AND distracted.
//   desire:       wish (kāmacchanda proxy).
//   sloth:        low attention + low arousal (drowsy / dull).
//   headMotion:   ||pose||₂ — proxy for fidgeting away from neutral.
//   hindrance:    mean of restlessness + desire + sloth (no aversion/doubt signal).
type DerivedInput = {
  valence: number; arousal: number; attention: number; wish: number;
  positivity: number; pitch: number; yaw: number; roll: number;
};
function deriveAt(t: number, s: DerivedInput): DerivedPoint {
  const v = s.valence, a = s.arousal, att = s.attention;
  const eq  = (1 - Math.abs(v)) * (1 - Math.abs(a)) * att;
  // Hypothesis from user: -0.5 arousal is the meditation sweet spot.
  const rlx = (1 - Math.abs(a + 0.5)) * (0.5 + v / 2) * att;
  const rst = Math.max(0, a) * (1 - 0.5 * att);
  const des = s.wish;
  // Aversion / ill-will: negative valence + activated (the negative-active quadrant).
  const avr = Math.max(0, -v) * Math.max(0, a);
  const slo = (1 - att) * Math.max(0, -a);
  const hm  = Math.min(1, Math.hypot(s.pitch, s.yaw, s.roll));
  const hind = (rst + des + avr + slo) / 4;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return {
    t,
    equanimity:   clamp(eq),
    relaxation:   clamp(rlx),
    restlessness: clamp(rst),
    desire:       clamp(des),
    aversion:     clamp(avr),
    sloth:        clamp(slo),
    headMotion:   clamp(hm),
    hindrance:    clamp(hind),
  };
}
function computeDerived() {
  const p = deriveAt(elapsed, {
    valence: latest.valence, arousal: latest.arousal,
    attention: latest.attention, wish: latest.wish, positivity: latest.positivity,
    pitch: pose.pitch, yaw: pose.yaw, roll: pose.roll,
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

function drawLine<P>(ctx: CanvasRenderingContext2D, pts: P[], getX: (p: P) => number, getY: (p: P) => number) {
  let started = false;
  ctx.beginPath();
  for (const p of pts) {
    const xx = getX(p); const yy = getY(p);
    if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
  }
  if (started) ctx.stroke();
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
  return sec >= 60 ? `last ${sec / 60} min` : `last ${sec}s`;
}

function drawEmoPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number) {
  drawPanel(ctx, x, y, w, h, `emotions — ${windowLabel(windowSec)}`);
  const padL = 0.15, padR = 1.5, padT = 0.55, padB = 0.15;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  plotFrame(ctx, plotX, plotY, plotW, plotH, windowSec);

  const t0 = elapsed - windowSec;
  const tx = (t: number) => plotX + ((t - t0) / windowSec) * plotW;
  const ty = (v: number) => plotY + plotH - Math.max(0, Math.min(1, v)) * plotH;
  const visible = emoSeries.filter(p => p.t >= t0);
  const smooth = windowSec >= 60;

  ctx.lineWidth = 0.03;
  for (const k of EMOTIONS) {
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = EMOTION_COLORS[k];
    if (smooth) {
      const sm = smoothPoints(visible, p => p.t, p => p[k]);
      drawLine(ctx, sm, p => tx(p.t), p => ty(p.v));
    } else {
      drawLine(ctx, visible, p => tx(p.t), p => ty(p[k]));
    }
  }
  ctx.globalAlpha = 1;

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

function drawSignalPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number) {
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

  const t0 = elapsed - windowSec;
  const tx = (t: number) => plotX + ((t - t0) / windowSec) * plotW;
  const ty01 = (v: number) => plotY + plotH - Math.max(0, Math.min(1, v)) * plotH;

  ctx.lineWidth = 0.035;
  const smooth = windowSec >= 60;
  for (const k of SIGNAL_KEYS) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = SIGNAL_COLORS[k];
    const visible = signalSeries[k].filter(p => p.t >= t0);
    const pts = smooth
      ? smoothPoints(visible, p => p.t, p => NORMALIZE[k](p.v))
      : visible.map(p => ({ t: p.t, v: NORMALIZE[k](p.v) }));
    drawLine(ctx, pts, p => tx(p.t), p => ty01(p.v));
  }
  ctx.globalAlpha = 1;

  const legendX = plotX + plotW + 0.15;
  const items = SIGNAL_KEYS.map(k => ({ key: k, color: SIGNAL_COLORS[k], plot: NORMALIZE[k](latest[k]) }));
  items.sort((a, b) => b.plot - a.plot);
  let ly = plotY + 0.18;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(legendX, ly - 0.1, 0.14, 0.1);
    const raw = latest[it.key];
    const display = it.key === 'valence' || it.key === 'arousal'
      ? raw.toFixed(2)
      : `${(raw * 100).toFixed(0)}%`;
    pxText(ctx, `${it.key} ${display}`, legendX + 0.2, ly, '0.14px Sora', stone, 'left');
    ly += 0.2;
  }
}

function drawDerivedPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number) {
  drawPanel(ctx, x, y, w, h, `meditation metrics (derived) — ${windowLabel(windowSec)}`);
  const padL = 0.15, padR = 1.9, padT = 0.55, padB = 0.15;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  plotFrame(ctx, plotX, plotY, plotW, plotH, windowSec);

  const t0 = elapsed - windowSec;
  const tx = (t: number) => plotX + ((t - t0) / windowSec) * plotW;
  const ty = (v: number) => plotY + plotH - Math.max(0, Math.min(1, v)) * plotH;
  const visible = derivedSeries.filter(p => p.t >= t0);
  const smooth = windowSec >= 60;

  ctx.lineWidth = 0.03;
  for (const k of DERIVED_KEYS) {
    ctx.globalAlpha = 0.78;
    ctx.strokeStyle = DERIVED_COLORS[k];
    if (smooth) {
      const sm = smoothPoints(visible, p => p.t, p => p[k]);
      drawLine(ctx, sm, p => tx(p.t), p => ty(p.v));
    } else {
      drawLine(ctx, visible, p => tx(p.t), p => ty(p[k]));
    }
  }
  ctx.globalAlpha = 1;

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
  const sub = quadrant
    ? `russell quadrant: ${quadrant.toLowerCase()}`
    : 'emotion AI from webcam — exploring attention & affect';
  pxText(ctx, sub, gw / 2, 0.88, '0.2px Sora', stone, 'center');
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
    quadrant = '';
    pose.pitch = pose.yaw = pose.roll = 0;
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
    exposeForTests();
  },

  draw(ctx, gw, gh) {
    drawHeader(ctx, gw);
    if (status === 'no-key') return drawNoKey(ctx, gw, gh);
    if (status === 'loading') return drawLoading(ctx, gw, gh);
    if (status === 'error') return drawError(ctx, gw, gh);

    // 3 rows × 2 cols (30s / 5min): emotion (HD) | signals | derived meditation metrics
    const top = 1.15;
    const colGap = 0.2;
    const rowGap = 0.15;
    const colW = (gw - 0.4 - colGap) / 2;
    const rowH = (gh - top - 0.25 - 2 * rowGap) / 3;
    const leftX = 0.2;
    const rightX = leftX + colW + colGap;
    const row1 = top;
    const row2 = row1 + rowH + rowGap;
    const row3 = row2 + rowH + rowGap;

    drawEmoPanel     (ctx, leftX,  row1, colW, rowH, WINDOW_30S);
    drawEmoPanel     (ctx, rightX, row1, colW, rowH, WINDOW_5MIN);
    drawSignalPanel  (ctx, leftX,  row2, colW, rowH, WINDOW_30S);
    drawSignalPanel  (ctx, rightX, row2, colW, rowH, WINDOW_5MIN);
    drawDerivedPanel (ctx, leftX,  row3, colW, rowH, WINDOW_30S);
    drawDerivedPanel (ctx, rightX, row3, colW, rowH, WINDOW_5MIN);
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
      signalSeries.attention.push  ({ t, v: 0.6  + 0.25 * Math.sin(t * 0.04) });
      signalSeries.wish.push       ({ t, v: 0.5  + 0.2  * Math.sin(t * 0.03 + 1) });
      signalSeries.positivity.push ({ t, v: 0.55 + 0.2  * Math.sin(t * 0.025 + 2) });
      signalSeries.valence.push    ({ t, v: 0.3  + 0.5  * Math.sin(t * 0.03) });
      signalSeries.arousal.push    ({ t, v: 0.1  + 0.4  * Math.cos(t * 0.04) });
      emoSeries.push({
        t,
        Happy:    Math.max(0, 0.40 + 0.20 * Math.sin(phase + 0.5)),
        Surprise: Math.max(0, 0.12 + 0.08 * Math.sin(phase + 1.5)),
        Neutral:  Math.max(0, 0.32 + 0.15 * Math.sin(phase + 2.5)),
        Sad:      Math.max(0, 0.08 + 0.08 * Math.sin(phase + 3.5)),
        Fear:     Math.max(0, 0.05 + 0.04 * Math.sin(phase + 4.5)),
        Disgust:  Math.max(0, 0.04 + 0.03 * Math.sin(phase + 5.5)),
        Angry:    Math.max(0, 0.04 + 0.04 * Math.sin(phase + 6.5)),
      });
      derivedSeries.push(deriveAt(t, {
        valence:  0.3  + 0.5  * Math.sin(t * 0.03),
        arousal:  0.1  + 0.4  * Math.cos(t * 0.04),
        attention:0.6  + 0.25 * Math.sin(t * 0.04),
        wish:     0.5  + 0.2  * Math.sin(t * 0.03 + 1),
        positivity:0.55 + 0.2 * Math.sin(t * 0.025 + 2),
        pitch:    0.15 * Math.sin(t * 0.07),
        yaw:      0.25 * Math.sin(t * 0.05 + 0.4),
        roll:     0.10 * Math.cos(t * 0.06),
      }));
    }
    Object.assign(latestDerived, derivedSeries[derivedSeries.length - 1]);
  },

  cleanup() {
    try { stopFn?.(); } catch {}
    stopFn = null;
    detachListeners();
    for (const k of SIGNAL_KEYS) signalSeries[k].length = 0;
    emoSeries.length = 0;
    derivedSeries.length = 0;
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
