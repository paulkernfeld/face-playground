// Minimal page for Playwright testing of head pose angle extraction.
// Starts camera + FaceMesh, computes pitch/yaw, writes to #angles DOM element.
// Activated via ?angleTest URL param.

import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

export async function startAngleTest() {
  const video = document.getElementById("webcam") as HTMLVideoElement;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  // Create angles div for DOM-based output
  const anglesDiv = document.createElement("div");
  anglesDiv.id = "angles";
  anglesDiv.textContent = "waiting for face...";
  document.body.appendChild(anglesDiv);

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
  video.muted = true; // Required for autoplay without user interaction
  await video.play();

  // Init FaceLandmarker
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    runningMode: "VIDEO",
    numFaces: 1,
  });

  // Render loop
  let running = true;
  while (running) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    if (video.readyState < 2) continue;

    const now = performance.now();
    const result = landmarker.detectForVideo(video, now);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (result.faceLandmarks.length > 0 &&
        result.facialTransformationMatrixes &&
        result.facialTransformationMatrixes.length > 0) {
      const m = result.facialTransformationMatrixes[0].data;

      // Same Euler decomposition as main.ts (ZYX, column-major)
      const headPitch = Math.atan2(m[6], m[10]);
      const headYaw = Math.atan2(-m[2], Math.sqrt(m[0] * m[0] + m[1] * m[1]));

      const pitchDeg = (headPitch * 180 / Math.PI);
      const yawDeg = (headYaw * 180 / Math.PI);

      // Write to DOM for Playwright to read
      anglesDiv.dataset.pitch = pitchDeg.toFixed(1);
      anglesDiv.dataset.yaw = yawDeg.toFixed(1);
      anglesDiv.textContent = `pitch: ${pitchDeg.toFixed(1)}° yaw: ${yawDeg.toFixed(1)}°`;

      // Draw on canvas
      ctx.fillStyle = "#0f0";
      ctx.font = "20px monospace";
      ctx.fillText(`face detected`, 20, 30);
      ctx.fillText(`pitch: ${pitchDeg.toFixed(1)}°`, 20, 60);
      ctx.fillText(`yaw: ${yawDeg.toFixed(1)}°`, 20, 90);
    } else {
      anglesDiv.textContent = "waiting for face...";
      ctx.fillStyle = "#888";
      ctx.font = "20px monospace";
      ctx.fillText("waiting for face...", 20, 30);
    }
  }
}
