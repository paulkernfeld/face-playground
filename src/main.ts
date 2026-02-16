import "./style.css";
import { FaceMesh } from "@mediapipe/face_mesh";
import type { Results } from "@mediapipe/face_mesh";
import type { Experiment, Landmarks } from "./types";
import { headCursor } from "./experiments/head-cursor";
import { faceChomp } from "./experiments/face-chomp";

// -- Registry --
const experiments: Experiment[] = [headCursor, faceChomp];

// -- DOM --
const video = document.getElementById("webcam") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const menuEl = document.getElementById("menu") as HTMLDivElement;
const hudEl = document.getElementById("hud") as HTMLDivElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;

// -- State --
let currentExp: Experiment | null = null;
let latestLandmarks: Landmarks | null = null;
let lastTime = performance.now();
let frameCount = 0;
let faceMesh: FaceMesh | null = null;
let cameraReady = false;
let animFrameId = 0;
let showVideo = false;

// -- Build menu --
function showMenu() {
  currentExp = null;
  cameraReady = false;
  latestLandmarks = null;

  // Stop render loop
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = 0;
  }

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
  html += `<div class="hint">press a number to start // esc=back  v=video  s=screenshot</div>`;
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

  // Init camera
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraReady = true;

  // Init FaceMesh (once, reuse across experiments)
  if (!faceMesh) {
    faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults((results: Results) => {
      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        latestLandmarks = results.multiFaceLandmarks[0];
      } else {
        latestLandmarks = null;
      }
    });
    await faceMesh.initialize();
  }

  currentExp.setup(ctx, canvas.width, canvas.height);
  lastTime = performance.now();
  frameCount = 0;
  renderLoop();
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

// -- Render loop --
function renderLoop() {
  if (!currentExp || !faceMesh) return;

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  // FPS
  frameCount++;
  if (frameCount % 30 === 0) {
    fpsEl.textContent = `${Math.round(1 / dt)} fps`;
  }

  // Draw camera feed mirrored (toggle with 'v')
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (cameraReady && showVideo) {
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // Experiment update + draw
  currentExp.update(latestLandmarks, dt);
  currentExp.draw(ctx, canvas.width, canvas.height);

  // Send frame to FaceMesh
  if (video.readyState >= 2) {
    faceMesh.send({ image: video });
  }

  animFrameId = requestAnimationFrame(renderLoop);
}

// -- Keyboard handler --
document.addEventListener("keydown", (e) => {
  // Number keys: select experiment from menu
  const num = parseInt(e.key);
  if (!currentExp && num >= 1 && num <= experiments.length) {
    enterExperiment(num - 1);
    return;
  }

  // Escape: back to menu
  if (e.key === "Escape" && currentExp) {
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
