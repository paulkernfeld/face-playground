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

let status: Status = 'no-key';
let statusMsg = '';

let licenseKey = '';
let stopFn: (() => void) | null = null;
let listenersAttached = false;

const latest: Record<SignalKey, number> = {
  attention: 0, wish: 0, positivity: 0, valence: 0, arousal: 0,
};
let emotion: Record<Emotion, number> = {
  Happy: 0, Surprise: 0, Neutral: 1, Sad: 0, Fear: 0, Disgust: 0, Angry: 0,
};
// Russell circumplex: 98 named affect probabilities (0..1) + a quadrant label.
let affects: Record<string, number> = {};
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
    affects: { ...affects },
    quadrant,
  };
}

const WINDOW_5MIN = 300;
const WINDOW_30S = 30;
let elapsed = 0;
type TVPoint = { t: number; v: number };
type EmoPoint = { t: number } & Record<Emotion, number>;
const signalSeries: Record<SignalKey, TVPoint[]> = {
  attention: [], wish: [], positivity: [], valence: [], arousal: [],
};
const emoSeries: EmoPoint[] = [];
type AffectsPoint = { t: number; affects: Record<string, number> };
const russSeries: AffectsPoint[] = [];
// Render affects whose peak probability over the window exceeds this.
const AFFECT_PEAK_THRESHOLD = 0.2;
// Hard cap so the plot doesn't melt if too many affects clear the threshold.
const AFFECT_MAX_LINES = 12;
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
  if (out.affects98 && typeof out.affects98 === 'object') {
    affects = { ...out.affects98 };
    russSeries.push({ t: elapsed, affects });
    trim(russSeries);
  }
  if (typeof out.quadrant === 'string') quadrant = out.quadrant;
  eventCount++;
};
const onEmotion = (e: any) => {
  captureFirst('EMOTION', e); bumpCount('emotion');
  const out = e?.detail?.output?.emotion; if (!out) return;
  for (const k of EMOTIONS) {
    if (typeof out[k] === 'number') emotion[k] = out[k];
  }
  emoSeries.push({ t: elapsed, ...emotion });
  trim(emoSeries);
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
// Below modules' schemas not yet wired — first-payload capture only so we can inspect at runtime.
const onFeatures = (e: any) => { captureFirst('FEATURES', e); bumpCount('features'); };
const onPose = (e: any) => { captureFirst('POSE', e); bumpCount('pose'); };
const onEmotionHD = (e: any) => { captureFirst('EMOTION_HD', e); bumpCount('emotion_hd'); };
const onAggregator = (e: any) => { captureFirst('AGGREGATOR', e); bumpCount('aggregator'); };
const onQuality = (e: any) => { captureFirst('QUALITY', e); bumpCount('quality'); };

const LISTENERS: Array<[string, (e: any) => void]> = [
  ['CY_FACE_AROUSAL_VALENCE_RESULT', onAV],
  ['CY_FACE_EMOTION_RESULT', onEmotion],
  ['CY_FACE_ATTENTION_RESULT', onAttention],
  ['CY_FACE_WISH_RESULT', onWish],
  ['CY_FACE_POSITIVITY_RESULT', onPositivity],
  ['CY_FACE_FEATURES_RESULT', onFeatures],
  ['CY_FACE_POSE_RESULT', onPose],
  ['CY_FACE_EMOTION_HD_RESULT', onEmotionHD],
  ['CY_DATA_AGGREGATOR_RESULT', onAggregator],
  ['CY_FACE_QUALITY_RESULT', onQuality],
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
    const addIfAvailable = (key: string) => {
      const m = mods[key];
      if (m) loader.addModule(m.name, {});
      else console.warn(`[morphcast] module ${key} not in SDK build, skipping`);
    };
    // Skip FACE_AGE / FACE_GENDER / FACE_RACE / ALARM_* by design (ethics + not informative for our use).
    addIfAvailable('FACE_DETECTOR');
    addIfAvailable('FACE_QUALITY');
    addIfAvailable('FACE_AROUSAL_VALENCE');
    addIfAvailable('FACE_EMOTION');
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
  pxText(ctx, '1', plotX - 0.08, plotY + 0.12, '0.14px Sora', stone, 'right');
  pxText(ctx, '0', plotX - 0.08, plotY + plotH - 0.02, '0.14px Sora', stone, 'right');
  const lbl = windowSec >= 60 ? `−${Math.round(windowSec / 60)}m` : `−${windowSec}s`;
  pxText(ctx, lbl,   plotX + 0.05,         plotY + plotH + 0.28, '0.16px Sora', stone, 'left');
  pxText(ctx, 'now', plotX + plotW - 0.05, plotY + plotH + 0.28, '0.16px Sora', stone, 'right');
}

function windowLabel(sec: number): string {
  return sec >= 60 ? `last ${sec / 60} min` : `last ${sec}s`;
}

function drawEmoPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number) {
  drawPanel(ctx, x, y, w, h, `emotions — ${windowLabel(windowSec)}`);
  const padL = 0.5, padR = 1.5, padT = 0.7, padB = 0.5;
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
  const padL = 0.5, padR = 1.7, padT = 0.7, padB = 0.5;
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

// Stable per-name hue so the same affect keeps its color across frames.
function affectColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 48%)`;
}

function drawRussPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, windowSec: number) {
  drawPanel(ctx, x, y, w, h, `russell affects — ${windowLabel(windowSec)}`);
  const padL = 0.5, padR = 1.7, padT = 0.55, padB = 0.45;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  plotFrame(ctx, plotX, plotY, plotW, plotH, windowSec);

  const t0 = elapsed - windowSec;
  const visible = russSeries.filter(p => p.t >= t0);
  if (visible.length === 0) return;

  // Compute peak prob per affect name over the window; render only sparse non-zeros.
  const peaks: Record<string, number> = {};
  for (const p of visible) {
    for (const name in p.affects) {
      const v = p.affects[name];
      if (v > (peaks[name] ?? 0)) peaks[name] = v;
    }
  }
  const active = Object.entries(peaks)
    .filter(([, peak]) => peak >= AFFECT_PEAK_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, AFFECT_MAX_LINES)
    .map(([name]) => name);
  if (active.length === 0) return;

  const tx = (t: number) => plotX + ((t - t0) / windowSec) * plotW;
  const ty = (v: number) => plotY + plotH - Math.max(0, Math.min(1, v)) * plotH;

  ctx.lineWidth = 0.025;
  const smooth = windowSec >= 60;
  for (const name of active) {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = affectColor(name);
    if (smooth) {
      const sm = smoothPoints(visible, p => p.t, p => p.affects[name] ?? 0);
      drawLine(ctx, sm, p => tx(p.t), p => ty(p.v));
    } else {
      drawLine(ctx, visible, p => tx(p.t), p => ty(p.affects[name] ?? 0));
    }
  }
  ctx.globalAlpha = 1;

  // Legend: sort by current value (latest frame), cap at 8 to fit.
  const last = visible[visible.length - 1].affects;
  const legend = active
    .map(name => ({ name, v: last[name] ?? 0 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  const legendX = plotX + plotW + 0.12;
  let ly = plotY + 0.15;
  for (const it of legend) {
    ctx.fillStyle = affectColor(it.name);
    ctx.fillRect(legendX, ly - 0.09, 0.13, 0.09);
    pxText(ctx, `${it.name} ${(it.v * 100).toFixed(0)}%`,
      legendX + 0.18, ly, '0.13px Sora', stone, 'left');
    ly += 0.18;
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
    russSeries.length = 0;
    affects = {};
    quadrant = '';
    if (licenseKey && status !== 'running' && status !== 'loading') {
      bootMorphcast();
    } else if (!licenseKey) {
      status = 'no-key';
    }
    exposeForTests();
  },

  update(_face, dt) {
    elapsed += dt;
    exposeForTests();
  },

  draw(ctx, gw, gh) {
    drawHeader(ctx, gw);
    if (status === 'no-key') return drawNoKey(ctx, gw, gh);
    if (status === 'loading') return drawLoading(ctx, gw, gh);
    if (status === 'error') return drawError(ctx, gw, gh);

    // 3 rows (emotions / signals / russell) × 2 cols (30s / 5min)
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

    drawEmoPanel    (ctx, leftX,  row1, colW, rowH, WINDOW_30S);
    drawEmoPanel    (ctx, rightX, row1, colW, rowH, WINDOW_5MIN);
    drawSignalPanel (ctx, leftX,  row2, colW, rowH, WINDOW_30S);
    drawSignalPanel (ctx, rightX, row2, colW, rowH, WINDOW_5MIN);
    drawRussPanel   (ctx, leftX,  row3, colW, rowH, WINDOW_30S);
    drawRussPanel   (ctx, rightX, row3, colW, rowH, WINDOW_5MIN);
  },

  demo() {
    status = 'running';
    latest.attention = 0.78; latest.wish = 0.55; latest.positivity = 0.62;
    latest.valence = 0.4; latest.arousal = 0.2;
    emotion = { Happy: 0.6, Surprise: 0.1, Neutral: 0.2, Sad: 0.02, Fear: 0.03, Disgust: 0.02, Angry: 0.03 };
    quadrant = 'High Control';
    elapsed = WINDOW_5MIN;
    // Sparse Russell affects: only a handful active, rest near zero — mirrors real data shape.
    const demoAffects = ['Pleased', 'Calm', 'Content', 'Relaxed', 'Light Hearted', 'Hopeful', 'Interested'];
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
        Happy:    Math.max(0, 0.55 + 0.30 * Math.sin(phase + 0)),
        Surprise: Math.max(0, 0.10 + 0.10 * Math.sin(phase + 1)),
        Neutral:  Math.max(0, 0.25 + 0.15 * Math.sin(phase + 2)),
        Sad:      Math.max(0, 0.05 + 0.05 * Math.sin(phase + 3)),
        Fear:     Math.max(0, 0.05 + 0.05 * Math.sin(phase + 4)),
        Disgust:  Math.max(0, 0.05 + 0.05 * Math.sin(phase + 5)),
        Angry:    Math.max(0, 0.05 + 0.05 * Math.sin(phase + 6)),
      });
      const aff: Record<string, number> = {};
      demoAffects.forEach((name, idx) => {
        aff[name] = Math.max(0, 0.45 + 0.35 * Math.sin(phase + idx));
      });
      russSeries.push({ t, affects: aff });
    }
    affects = russSeries[russSeries.length - 1].affects;
  },

  cleanup() {
    try { stopFn?.(); } catch {}
    stopFn = null;
    detachListeners();
    for (const k of SIGNAL_KEYS) signalSeries[k].length = 0;
    emoSeries.length = 0;
    russSeries.length = 0;
    affects = {};
    quadrant = '';
    elapsed = 0;
    eventCount = 0;
    for (const k of Object.keys(evtCounts)) delete evtCounts[k];
    for (const k of Object.keys(firstPayloads)) delete firstPayloads[k];
    status = 'no-key';
    statusMsg = '';
    exposeForTests();
  },
};
