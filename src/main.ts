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

// -- DOM --
const video = document.getElementById("webcam") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const menuEl = document.getElementById("menu") as HTMLDivElement;
const hudEl = document.getElementById("hud") as HTMLDivElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;

// -- State --
let currentExp: Experiment | null = null;
let latestFace: FaceData | null = null;
let rawLandmarks: Landmarks | null = null;
let landmarker: FaceLandmarker | null = null;
let showVideo = false;

// Remap landmarks from a narrower range to 0..1 so you don't have to
// push your face to the very edge of the camera to reach screen edges.
const MARGIN = 0.05;
function remap(v: number): number {
  return (v - MARGIN) / (1 - 2 * MARGIN);
}
function remapLandmarks(raw: Landmarks): Landmarks {
  return raw.map((l) => ({ x: remap(l.x), y: remap(l.y), z: l.z }));
}

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
  menuEl.classList.remove("hidden");

  let html = "<h1>face playground</h1>";
  experiments.forEach((exp, i) => {
    html += `<div class="item"><span class="key">${i + 1}</span>  ${exp.name}</div>`;
  });
  html += `<div class="hint">press a number to start // q=back  v=video  s=screenshot</div>`;
  menuEl.innerHTML = html;
}

// -- Enter an experiment --
async function enterExperiment(index: number) {
  if (index < 0 || index >= experiments.length) return;

  currentExp = experiments[index];
  menuEl.classList.add("hidden");
  canvas.classList.remove("hidden");
  hudEl.classList.remove("hidden");

  // Show loading state
  resize();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0";
  ctx.font = "20px monospace";
  ctx.textAlign = "center";
  ctx.fillText("starting camera...", canvas.width / 2, canvas.height / 2);

  // Init camera at lower res
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  // Init FaceLandmarker (once, reuse across experiments)
  if (!landmarker) {
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
      runningMode: "VIDEO",
      numFaces: 1,
    });
  }

  currentExp.setup(ctx, canvas.width, canvas.height);
  await runLoop();
}

// -- Resize --
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (currentExp) {
    currentExp.setup(ctx, canvas.width, canvas.height);
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

        // Build blendshapes map
        const blendshapes: Blendshapes = new Map();
        if (result.faceBlendshapes.length > 0) {
          for (const cat of result.faceBlendshapes[0].categories) {
            blendshapes.set(cat.categoryName, cat.score);
          }
        }

        latestFace = { landmarks: remapped, blendshapes };
      } else {
        rawLandmarks = null;
        latestFace = null;
      }
    }

    // Clear + optionally draw video and mesh (zoomed to match remapped coords)
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (showVideo) {
      const s = 1 / (1 - 2 * MARGIN);
      const ox = MARGIN * s * cw;
      const oy = MARGIN * s * ch;
      ctx.save();
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, -ox, -oy, s * cw, s * ch);
      ctx.restore();

      // Draw face mesh overlay (remapped to match game coordinates)
      if (rawLandmarks) {
        ctx.strokeStyle = "rgba(0, 255, 100, 0.2)";
        ctx.lineWidth = 0.5;
        for (const conn of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
          const a = rawLandmarks[conn.start];
          const b = rawLandmarks[conn.end];
          ctx.beginPath();
          ctx.moveTo((1 - remap(a.x)) * cw, remap(a.y) * ch);
          ctx.lineTo((1 - remap(b.x)) * cw, remap(b.y) * ch);
          ctx.stroke();
        }
      }
    }

    // Update + draw with fresh face data
    currentExp.update(latestFace, dt);
    currentExp.draw(ctx, canvas.width, canvas.height);
  }
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
