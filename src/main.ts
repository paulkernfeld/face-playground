import "./style.css";
import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import type { Experiment, FaceData, Landmarks, Blendshapes } from "./types";
import { headCursor } from "./experiments/head-cursor";
import { faceChomp } from "./experiments/face-chomp";
import { blendshapeDebug } from "./experiments/blendshape-debug";

// -- Registry --
const experiments: Experiment[] = [headCursor, faceChomp, blendshapeDebug];

const experimentMeta = [
  { icon: '🎯', desc: 'move a cursor with your nose', color: '#FF6B6B' },
  { icon: '😮', desc: 'pac-man, controlled with your face', color: '#FFD93D' },
  { icon: '🧘', desc: 'monitor & release facial tension', color: '#2EC4B6' },
];

// -- DOM --
const video = document.getElementById("webcam") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const menuEl = document.getElementById("menu") as HTMLDivElement;
const hudEl = document.getElementById("hud") as HTMLDivElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;
const loadingEl = document.getElementById("loading") as HTMLDivElement;

// -- State --
let currentExp: Experiment | null = null;
let latestFace: FaceData | null = null;
let rawLandmarks: Landmarks | null = null;
let landmarker: FaceLandmarker | null = null;
let showVideo = false;

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
  <button id="btn-video">video${key("v")}</button>
  <button id="btn-screenshot">screenshot${key("s")}</button>
`;
document.body.appendChild(btnBar);

document.getElementById("btn-back")!.addEventListener("click", () => {
  if (currentExp) showMenu();
});
document.getElementById("btn-video")!.addEventListener("click", () => {
  if (currentExp) showVideo = !showVideo;
});
document.getElementById("btn-screenshot")!.addEventListener("click", () => {
  if (currentExp) {
    const link = document.createElement("a");
    link.download = `face-${currentExp.name}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
});

// -- Build menu --
function showMenu() {
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

  let html = `
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
    <div class="menu-content">
      <h1 class="menu-title"><span class="t-face">face </span><span class="t-play">playground</span></h1>
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

  menuEl.querySelectorAll(".experiment-card[data-exp]").forEach((el) => {
    (el as HTMLElement).addEventListener("click", () => {
      const idx = parseInt((el as HTMLElement).dataset.exp!);
      enterExperiment(idx);
    });
  });
}

// -- Enter an experiment --
async function enterExperiment(index: number) {
  if (index < 0 || index >= experiments.length) return;

  currentExp = experiments[index];
  menuEl.classList.add("hidden");

  // Show loading overlay
  loadingEl.classList.remove("hidden");
  loadingEl.innerHTML = `
    <div class="loading-icon">📸</div>
    <div class="loading-text">starting camera\u2026</div>`;

  // Init camera at lower res
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  // Init FaceLandmarker (once, reuse across experiments)
  if (!landmarker) {
    const txt = loadingEl.querySelector(".loading-text");
    if (txt) txt.textContent = "loading face model\u2026";
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1,
    });
  }

  // Hide loading, show canvas
  loadingEl.classList.add("hidden");
  canvas.classList.remove("hidden");
  hudEl.classList.remove("hidden");
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

    // FPS
    frameCount++;
    if (frameCount % 30 === 0) {
      fpsEl.textContent = `${Math.round(1 / dt)} fps`;
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
        if (result.facialTransformationMatrixes && result.facialTransformationMatrixes.length > 0) {
          const m = result.facialTransformationMatrixes[0].data;
          // 4x4 column-major matrix, extract rotation
          // m[0],m[1],m[2] = col0, m[4],m[5],m[6] = col1, m[8],m[9],m[10] = col2
          headPitch = Math.atan2(-m[8], Math.sqrt(m[9] * m[9] + m[10] * m[10]));
          headYaw = Math.atan2(m[4], m[0]);
        }

        latestFace = { landmarks: gameUnits, blendshapes, headPitch, headYaw };
        lastFaceSeenAt = now;
        // Track nose position for warning overlay
        lastNoseX = gameUnits[1].x;
        lastNoseY = gameUnits[1].y;
      } else {
        rawLandmarks = null;
        latestFace = null;
      }
    }

    // Clear full canvas (dark letterbox)
    ctx.fillStyle = "#1a1a2e";
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
    currentExp.draw(ctx, GAME_W, GAME_H);

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
    if (headPitch > ANGLE_THRESHOLD) msg = "angle your face down";
    else if (headPitch < -ANGLE_THRESHOLD) msg = "angle your face up";
    else if (Math.abs(headYaw) > ANGLE_THRESHOLD) msg = "face the camera";
  }
  if (!msg) return;

  const tx = Math.max(1.5, Math.min(GAME_W - 1.5, lastNoseX));
  const ty = Math.max(0.8, lastNoseY - 0.6);

  ctx.font = "600 0.28px Sora, sans-serif";
  ctx.textAlign = "center";
  const metrics = ctx.measureText(msg);
  const pw = metrics.width + 0.35;
  const ph = 0.45;

  ctx.fillStyle = "rgba(15, 15, 35, 0.7)";
  ctx.beginPath();
  ctx.roundRect(tx - pw / 2, ty - ph / 2 - 0.08, pw, ph, 0.12);
  ctx.fill();

  ctx.fillStyle = "#FFD93D";
  ctx.fillText(msg, tx, ty + 0.08);
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

  // Toggle video feed
  if (e.key === "v" && currentExp) {
    showVideo = !showVideo;
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
showMenu();
