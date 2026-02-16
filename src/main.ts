import "./style.css";
import { FaceMesh } from "@mediapipe/face_mesh";
import type { Results } from "@mediapipe/face_mesh";
import type { Experiment, Landmarks } from "./types";
import { headCursor } from "./experiments/head-cursor";

// -- Registry of experiments --
const experiments: Experiment[] = [headCursor];

// -- DOM elements --
const video = document.getElementById("webcam") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const select = document.getElementById("exp-select") as HTMLSelectElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;

// -- State --
let currentExp: Experiment = experiments[0];
let latestLandmarks: Landmarks | null = null;
let lastTime = performance.now();
let frameCount = 0;
let fpsDisplay = 0;

// -- Populate experiment selector --
for (const exp of experiments) {
  const opt = document.createElement("option");
  opt.value = exp.name;
  opt.textContent = exp.name;
  select.appendChild(opt);
}

// Read from URL param
const urlExp = new URLSearchParams(location.search).get("exp");
if (urlExp) {
  const found = experiments.find((e) => e.name === urlExp);
  if (found) {
    currentExp = found;
    select.value = found.name;
  }
}

select.addEventListener("change", () => {
  const found = experiments.find((e) => e.name === select.value);
  if (found) {
    currentExp = found;
    currentExp.setup(ctx, canvas.width, canvas.height);
    // Update URL without reload
    const url = new URL(location.href);
    url.searchParams.set("exp", found.name);
    history.replaceState(null, "", url.toString());
  }
});

// -- Screenshot on 's' key --
document.addEventListener("keydown", (e) => {
  if (e.key === "s" && !e.metaKey && !e.ctrlKey) {
    const link = document.createElement("a");
    link.download = `face-${currentExp.name}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
});

// -- Resize canvas to fill window --
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  currentExp.setup(ctx, canvas.width, canvas.height);
}
window.addEventListener("resize", resize);

// -- Init webcam --
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

// -- Init FaceMesh --
function initFaceMesh(): FaceMesh {
  const faceMesh = new FaceMesh({
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

  return faceMesh;
}

// -- Render loop --
function renderLoop(faceMesh: FaceMesh) {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  // FPS counter
  frameCount++;
  if (frameCount % 30 === 0) {
    fpsDisplay = Math.round(1 / dt);
    fpsEl.textContent = `${fpsDisplay} fps`;
  }

  // Clear and draw camera feed
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw video mirrored
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Update + draw current experiment
  currentExp.update(latestLandmarks, dt);
  currentExp.draw(ctx, canvas.width, canvas.height);

  // Send frame to FaceMesh (async, results come via callback)
  if (video.readyState >= 2) {
    faceMesh.send({ image: video });
  }

  requestAnimationFrame(() => renderLoop(faceMesh));
}

// -- Boot --
async function main() {
  resize();
  await initCamera();
  const faceMesh = initFaceMesh();
  await faceMesh.initialize();
  currentExp.setup(ctx, canvas.width, canvas.height);
  renderLoop(faceMesh);
}

main().catch((err) => {
  document.body.style.color = "red";
  document.body.style.padding = "20px";
  document.body.style.fontFamily = "monospace";
  document.body.textContent = `Error: ${err.message}`;
  console.error(err);
});
