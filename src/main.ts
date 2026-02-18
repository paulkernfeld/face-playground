import "./style.css";
import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import rough from 'roughjs';
import { GameRoughCanvas } from './rough-scale';
import type { Experiment, FaceData, Landmarks, Blendshapes } from "./types";
import { headCursor } from "./experiments/head-cursor";
import { faceChomp } from "./experiments/face-chomp";
import { bodyCreature } from "./experiments/body-creature";
import { redLightGreenLight } from "./experiments/red-light-green-light";
import { ddr } from "./experiments/ddr";
import { yoga } from "./experiments/yoga";
import { posture } from "./experiments/posture";
import { captureExperiment } from "./capture";
import { startAngleTest } from "./angle-test";
import { startPoseTest } from "./pose-test";
import { pxText } from "./px-text";
import { experimentColors, honey, warning as warningColor, canvasBg } from "./palette";

// -- Registry --
const experiments: Experiment[] = [headCursor, faceChomp, bodyCreature, redLightGreenLight, ddr, yoga, posture];

const experimentMeta = [
  { icon: '🎯', desc: 'move a cursor with your nose', color: experimentColors[0] },
  { icon: '😮', desc: 'pac-man, controlled with your face', color: experimentColors[1] },
  { icon: '🧌', desc: 'a silly creature that follows your body', color: experimentColors[2] },
  { icon: '🚦', desc: 'freeze when the light turns red!', color: experimentColors[3] },
  { icon: '🎵', desc: 'rhythm game — match arrows with your head', color: experimentColors[4] },
  { icon: '🧘\u200d♀️', desc: 'match yoga poses with your body', color: experimentColors[5] },
  { icon: '🪑', desc: 'gentle nudge when your posture drifts', color: experimentColors[6] },
];

// -- DOM --
const video = document.getElementById("webcam") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const menuEl = document.getElementById("menu") as HTMLDivElement;
const hudEl = document.getElementById("hud") as HTMLDivElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;
const anglesEl = document.getElementById("angles") as HTMLSpanElement;
const loadingEl = document.getElementById("loading") as HTMLDivElement;

// -- State --
let currentExp: Experiment | null = null;
let latestFace: FaceData | null = null;
let rawLandmarks: Landmarks | null = null;
let landmarker: FaceLandmarker | null = null;
let poseLandmarker: PoseLandmarker | null = null;
let showVideo = false;
let rc: GameRoughCanvas;

// -- Preload FaceMesh WASM + model (starts immediately, awaited when needed) --
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const filesetPromise = FilesetResolver.forVisionTasks(VISION_WASM_URL);

// -- Game-unit coordinate system (16x9) --
const GAME_W = 16;
const GAME_H = 9;
let scale = 1;
let gameX = 0;
let gameY = 0;

// Head pose state
let headPitch = 0;
let headYaw = 0;
let lastFaceSeenAt = 0;
let lastNoseX = GAME_W / 2;
let lastNoseY = GAME_H / 2;

// Remap landmarks from a narrower range to 0..1 so you don't have to
// push your face to the very edge of the camera to reach screen edges.
const MARGIN = 0.05;
function remap(v: number): number {
  return (v - MARGIN) / (1 - 2 * MARGIN);
}
function remapLandmarks(raw: Landmarks): Landmarks {
  return raw.map((l) => ({ x: remap(l.x), y: remap(l.y), z: l.z }));
}

// -- Touch button bar --
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const key = (k: string) => isTouchDevice ? "" : ` (${k})`;
const btnBar = document.createElement("div");
btnBar.id = "touch-bar";
btnBar.classList.add("hidden");
btnBar.innerHTML = `
  <button id="btn-back">&#x2190; back${key("q")}</button>
  <button id="btn-debug">debug${key("v")}</button>
  <button id="btn-screenshot">screenshot${key("s")}</button>
  <button id="btn-capture" class="hidden">capture${key("space")}</button>
`;
document.body.appendChild(btnBar);

document.getElementById("btn-back")!.addEventListener("click", () => {
  if (currentExp) showMenu();
});
document.getElementById("btn-debug")!.addEventListener("click", () => {
  if (currentExp) toggleDebug();
});
document.getElementById("btn-screenshot")!.addEventListener("click", () => {
  if (currentExp) {
    const link = document.createElement("a");
    link.download = `face-${currentExp.name}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
});
document.getElementById("btn-capture")!.addEventListener("click", () => {
  (window as any).__capture?.();
});

// -- Build menu --
function showMenu() {
  currentExp?.cleanup?.();
  currentExp = null;
  latestFace = null;

  // Stop camera
  if (video.srcObject) {
    (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  canvas.classList.add("hidden");
  hudEl.classList.add("hidden");
  btnBar.classList.add("hidden");
  loadingEl.classList.add("hidden");
  menuEl.classList.remove("hidden");

  const tilt = (Math.random() - 0.5) * 3; // -1.5 to 1.5 degrees
  let html = `
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
    <div class="menu-content">
      <h1 class="menu-title" style="transform: rotate(${tilt}deg)"><span class="t-face">face </span><span class="t-play">playground</span></h1>
      <p class="menu-subtitle">experiments for your face</p>
      <div class="experiment-grid">`;

  experiments.forEach((exp, i) => {
    const m = experimentMeta[i];
    html += `
        <button class="experiment-card" data-exp="${i}" style="--accent: ${m.color}">
          <span class="card-icon">${m.icon}</span>
          <span class="card-name">${exp.name}</span>
          <span class="card-desc">${m.desc}</span>
          <span class="card-key">${i + 1}</span>
        </button>`;
  });

  html += `
      </div>
      <p class="menu-hint">tap a card or press 1\u2013${experiments.length}</p>
    </div>`;

  menuEl.innerHTML = html;

  // Add rough.js sketchy borders to each card
  menuEl.querySelectorAll(".experiment-card").forEach((card) => {
    const el = card as HTMLElement;
    const color = el.style.getPropertyValue('--accent');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'card-sketch');
    svg.setAttribute('viewBox', '0 0 100 130');
    svg.setAttribute('preserveAspectRatio', 'none');
    const rc = rough.svg(svg);
    // Border
    svg.appendChild(rc.rectangle(3, 3, 94, 124, {
      stroke: color, strokeWidth: 2, roughness: 1.5, bowing: 1, fill: 'none',
    }));
    // Top accent line
    svg.appendChild(rc.line(3, 8, 97, 8, {
      stroke: color, strokeWidth: 3, roughness: 1.2,
    }));
    el.appendChild(svg);
  });

  menuEl.querySelectorAll(".experiment-card[data-exp]").forEach((el) => {
    (el as HTMLElement).addEventListener("click", () => {
      const idx = parseInt((el as HTMLElement).dataset.exp!);
      enterExperiment(idx);
    });
  });
}

// -- Enter an experiment --
async function enterExperiment(expOrIndex: number | Experiment) {
  let exp: Experiment;
  if (typeof expOrIndex === 'number') {
    if (expOrIndex < 0 || expOrIndex >= experiments.length) return;
    exp = experiments[expOrIndex];
  } else {
    exp = expOrIndex;
  }

  currentExp = exp;
  menuEl.classList.add("hidden");

  // Show loading overlay
  loadingEl.classList.remove("hidden");
  loadingEl.innerHTML = `
    <div class="loading-icon">📸</div>
    <div class="loading-text">starting camera\u2026</div>`;

  // Init camera at lower res
  let stream: MediaStream;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("insecure-context");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    let msg: string;
    if (err instanceof Error && err.message === "insecure-context") {
      msg = "camera requires HTTPS (or localhost)";
    } else if (err instanceof DOMException && err.name === "NotAllowedError") {
      msg = "camera permission was denied";
    } else {
      msg = "couldn\u2019t access the camera";
    }
    loadingEl.innerHTML = `
      <div class="loading-icon">📷</div>
      <div class="loading-text">${msg}</div>
      <button class="camera-error-back">\u2190 back to menu</button>`;
    loadingEl.querySelector(".camera-error-back")!.addEventListener("click", showMenu);
    currentExp = null;
    return;
  }
  video.srcObject = stream;
  await video.play();

  // Init FaceLandmarker (once, reuse across experiments — fileset preloaded at boot)
  if (!landmarker) {
    const txt = loadingEl.querySelector(".loading-text");
    if (txt) txt.textContent = "loading face model\u2026";
    const fileset = await filesetPromise;
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: FACE_MODEL_URL,
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1,
    });
  }

  // Init PoseLandmarker if this experiment needs it (lazy, one-time)
  if (currentExp.updatePose && !poseLandmarker) {
    const txt = loadingEl.querySelector(".loading-text");
    if (txt) txt.textContent = "loading body model\u2026";
    const poseFileset = await filesetPromise;
    poseLandmarker = await PoseLandmarker.createFromOptions(poseFileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 4,
    });
  }

  // Hide loading, show canvas
  loadingEl.classList.add("hidden");
  canvas.classList.remove("hidden");
  hudEl.classList.toggle("hidden", !showVideo);
  btnBar.classList.remove("hidden");
  resize();

  currentExp.setup(ctx, GAME_W, GAME_H);
  await runLoop();
}

// -- Resize --
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  scale = Math.min(canvas.width / GAME_W, canvas.height / GAME_H);
  gameX = (canvas.width - GAME_W * scale) / 2;
  gameY = (canvas.height - GAME_H * scale) / 2;
  rc = new GameRoughCanvas(canvas);
  if (currentExp) {
    currentExp.setup(ctx, GAME_W, GAME_H);
  }
}
window.addEventListener("resize", resize);

// -- Main loop: one frame at a time --
async function runLoop() {
  let lastTime = performance.now();
  let frameCount = 0;

  while (currentExp) {
    // Wait for next animation frame
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    if (!currentExp || !landmarker) break;

    // Timing
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // FPS + debug info
    frameCount++;
    if (frameCount % 30 === 0) {
      fpsEl.textContent = `${Math.round(1 / dt)} fps`;
      const deg = (r: number) => (r * 180 / Math.PI).toFixed(1);
      anglesEl.textContent = latestFace
        ? ` pitch ${deg(headPitch)}\u00b0 yaw ${deg(headYaw)}\u00b0`
        : '';
    }

    // Detect face landmarks + blendshapes
    if (video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, now);
      if (result.faceLandmarks.length > 0) {
        rawLandmarks = result.faceLandmarks[0];
        const remapped = remapLandmarks(rawLandmarks);

        // Scale to game units (16x9)
        const gameUnits = remapped.map((l) => ({
          x: l.x * GAME_W,
          y: l.y * GAME_H,
          z: l.z,
        }));

        // Build blendshapes map
        const blendshapes: Blendshapes = new Map();
        if (result.faceBlendshapes.length > 0) {
          for (const cat of result.faceBlendshapes[0].categories) {
            blendshapes.set(cat.categoryName, cat.score);
          }
        }

        // Extract head pose from transformation matrix
        let rawMatrix: number[] | undefined;
        if (result.facialTransformationMatrixes && result.facialTransformationMatrixes.length > 0) {
          const m = result.facialTransformationMatrixes[0].data;
          rawMatrix = Array.from(m);
          // 4x4 column-major matrix, ZYX Euler decomposition
          // m[0],m[1],m[2] = col0, m[4],m[5],m[6] = col1, m[8],m[9],m[10] = col2
          // Verified via fixture captures: rotX=pitch, rotY=yaw, rotZ=roll
          headPitch = Math.atan2(m[6], m[10]);          // rotX: nod up/down
          headYaw = Math.atan2(-m[2], Math.sqrt(m[0] * m[0] + m[1] * m[1])); // rotY: turn L/R
        }

        latestFace = { landmarks: gameUnits, blendshapes, headPitch, headYaw, rawTransformMatrix: rawMatrix };
        lastFaceSeenAt = now;
        // Track nose position for warning overlay
        lastNoseX = GAME_W - gameUnits[1].x;
        lastNoseY = gameUnits[1].y;
      } else {
        rawLandmarks = null;
        latestFace = null;
      }
    }

    // Detect pose landmarks (only if current experiment uses them)
    // No remap — body tracking needs the full camera frame (remap crops 5% margin)
    if (currentExp.updatePose && poseLandmarker && video.readyState >= 2) {
      const poseResult = poseLandmarker.detectForVideo(video, now);
      const allPoses = poseResult.landmarks.map(rawPose =>
        rawPose.map(l => ({
          x: l.x * GAME_W,
          y: l.y * GAME_H,
          z: l.z,
        }))
      );
      currentExp.updatePose(allPoses, dt);
    }

    // Clear full canvas (dark letterbox)
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Enter game-unit transform
    ctx.save();
    ctx.translate(gameX, gameY);
    ctx.scale(scale, scale);

    // Clip to game area
    ctx.beginPath();
    ctx.rect(0, 0, GAME_W, GAME_H);
    ctx.clip();

    // Optionally draw video and mesh in game-unit space
    if (showVideo) {
      const s = 1 / (1 - 2 * MARGIN);
      const ox = MARGIN * s * GAME_W;
      const oy = MARGIN * s * GAME_H;
      ctx.save();
      ctx.translate(GAME_W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, -ox, -oy, s * GAME_W, s * GAME_H);
      ctx.restore();

      // Draw face mesh overlay
      if (rawLandmarks) {
        ctx.strokeStyle = "rgba(0, 255, 100, 0.2)";
        ctx.lineWidth = 0.01;
        for (const conn of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
          const a = rawLandmarks[conn.start];
          const b = rawLandmarks[conn.end];
          ctx.beginPath();
          ctx.moveTo((1 - remap(a.x)) * GAME_W, remap(a.y) * GAME_H);
          ctx.lineTo((1 - remap(b.x)) * GAME_W, remap(b.y) * GAME_H);
          ctx.stroke();
        }
      }
    }

    // Update + draw experiment in game-unit space
    currentExp.update(latestFace, dt);
    currentExp.draw(ctx, GAME_W, GAME_H, showVideo);

    // Face angle warnings (all experiments)
    drawAngleWarnings(ctx, now);

    ctx.restore();
  }
}

// -- Face angle warnings --
const ANGLE_THRESHOLD = 0.55; // ~31 degrees
function drawAngleWarnings(ctx: CanvasRenderingContext2D, now: number) {
  let msg = "";
  if (!latestFace && lastFaceSeenAt > 0 && now - lastFaceSeenAt < 3000) {
    msg = "face lost";
  } else if (latestFace) {
    if (headPitch > ANGLE_THRESHOLD) msg = "angle your face up";
    else if (headPitch < -ANGLE_THRESHOLD) msg = "angle your face down";
    else if (Math.abs(headYaw) > ANGLE_THRESHOLD) msg = "face the camera";
  }
  if (!msg) return;

  const tx = Math.max(1.5, Math.min(GAME_W - 1.5, lastNoseX));
  const ty = Math.max(0.8, lastNoseY - 0.6);

  // Sketchy background pill
  if (rc) {
    rc.rectangle(tx - 1.6, ty - 0.3, 3.2, 0.45, {
      fill: 'rgba(15, 15, 35, 0.7)', fillStyle: 'solid',
      stroke: warningColor, strokeWidth: 0.02,
      roughness: 1.2, seed: 900,
    });
  }

  pxText(ctx, msg, tx, ty + 0.08, "600 0.28px Sora, sans-serif", warningColor, "center");
}

function toggleDebug() {
  showVideo = !showVideo;
  hudEl.classList.toggle("hidden", !showVideo);
}

// -- Keyboard handler --
document.addEventListener("keydown", (e) => {
  // Number keys: select experiment from menu
  const num = parseInt(e.key);
  if (!currentExp && num >= 1 && num <= experiments.length) {
    enterExperiment(num - 1);
    return;
  }

  // q: back to menu
  if (e.key === "q" && currentExp) {
    showMenu();
    return;
  }

  // Toggle debug overlay
  if (e.key === "v" && currentExp) {
    toggleDebug();
    return;
  }

  // Screenshot
  if (e.key === "s" && !e.metaKey && !e.ctrlKey && currentExp) {
    const link = document.createElement("a");
    link.download = `face-${currentExp.name}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
});

// -- Boot --
const params = new URLSearchParams(window.location.search);
const angleTestParam = params.get("angleTest");
const poseTestParam = params.get("poseTest");
const captureParam = params.get("capture");
const demoParam = params.get("demo");
if (angleTestParam !== null) {
  startAngleTest();
} else if (poseTestParam !== null) {
  startPoseTest();
} else if (captureParam !== null) {
  document.getElementById("btn-capture")!.classList.remove("hidden");
  enterExperiment(captureExperiment);
} else if (demoParam !== null) {
  const idx = parseInt(demoParam) - 1;
  if (idx >= 0 && idx < experiments.length) {
    // Demo mode: render one frame with fake state, no camera needed
    currentExp = experiments[idx];
    menuEl.classList.add("hidden");
    canvas.classList.remove("hidden");
    resize();
    currentExp.setup(ctx, GAME_W, GAME_H);
    currentExp.demo?.();

    // Render one frame in game-unit space
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(gameX, gameY);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, GAME_W, GAME_H);
    ctx.clip();
    currentExp.draw(ctx, GAME_W, GAME_H, false);
    ctx.restore();
  } else {
    showMenu();
  }
} else {
  showMenu();
}
