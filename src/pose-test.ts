// Minimal page for Playwright testing of yoga pose classification.
// Starts camera + PoseLandmarker, classifies pose, writes to #pose DOM element.
// Activated via ?poseTest URL param.

import {
  PoseLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import { getYogaPose } from "./yoga-classify";

export async function startPoseTest() {
  const video = document.getElementById("webcam") as HTMLVideoElement;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  // Create pose div for DOM-based output
  const poseDiv = document.createElement("div");
  poseDiv.id = "pose";
  poseDiv.textContent = "waiting for body...";
  document.body.appendChild(poseDiv);

  // Hide menu, show canvas
  document.getElementById("menu")!.classList.add("hidden");
  canvas.classList.remove("hidden");
  canvas.width = 640;
  canvas.height = 480;

  // Start camera
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  await video.play();

  // Init PoseLandmarker
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  const poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  // Render loop
  while (true) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    if (video.readyState < 2) continue;

    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      const pose = getYogaPose(landmarks);

      // Write to DOM for Playwright to read
      poseDiv.dataset.pose = pose ?? "none";
      poseDiv.textContent = `pose: ${pose ?? "none"}`;

      // Draw on canvas
      ctx.fillStyle = "#0f0";
      ctx.font = "20px monospace";
      ctx.fillText(`body detected`, 20, 30);
      ctx.fillText(`pose: ${pose ?? "none"}`, 20, 60);
    } else {
      poseDiv.dataset.pose = "";
      poseDiv.textContent = "waiting for body...";
      ctx.fillStyle = "#888";
      ctx.font = "20px monospace";
      ctx.fillText("waiting for body...", 20, 30);
    }
  }
}
