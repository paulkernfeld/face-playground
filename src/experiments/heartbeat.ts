import type { Experiment, FaceData } from "../types";
import { GameRoughCanvas } from '../rough-scale';
import { pxText } from '../px-text';
import { rose, stone, charcoal, lavender, sky, teal, canvasBg } from '../palette';

// Constants
const BUFFER_SECONDS = 12;
const MIN_SECONDS = 5;
const ANALYSIS_INTERVAL = 1; // re-run DFT every 1s
const MIN_BPM = 48;
const MAX_BPM = 180;
const ROI_RADIUS = 15; // pixel radius to sample around each landmark
const MOTION_THRESHOLD = 0.015;
const SMOOTH = 0.8;
const NOSE_TIP = 1;
const WINDOW_SIZES = [5, 7, 10]; // seconds for multi-window consistency
const MAX_BPM_SPREAD = 10; // max spread for windows to agree

// FaceMesh landmark indices for skin ROIs
const FOREHEAD = 10;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;
const ROI_NAMES = ["forehead", "L cheek", "R cheek"];

export const heartbeat: Experiment = {
  name: "heartbeat",

  ...(() => {
    // State
    let greenBuffer: number[];
    let timestamps: number[];
    let bpm: number | null;
    let time: number;
    let lastAnalysisTime: number;
    let offscreen: CanvasRenderingContext2D | null;
    let videoEl: HTMLVideoElement | null;
    let w: number;
    let h: number;
    let rc: GameRoughCanvas;
    let breathPhase: number;

    // Motion tracking
    let smoothNoseX: number;
    let smoothNoseY: number;
    let lastNoseX: number;
    let lastNoseY: number;
    let hasHadFace: boolean;

    // Debug view state
    let roiColors: [number, number, number][];
    let roiGreenValues: number[];
    let lastSpectrum: { freq: number; power: number }[];
    let lastBestFreq: number;
    let windowResults: { window: number; bpm: number | null }[];

    function reset() {
      greenBuffer = [];
      timestamps = [];
      bpm = null;
      time = 0;
      lastAnalysisTime = 0;
      breathPhase = 0;
      smoothNoseX = 8;
      smoothNoseY = 4.5;
      lastNoseX = 8;
      lastNoseY = 4.5;
      hasHadFace = false;
      roiColors = [];
      roiGreenValues = [];
      lastSpectrum = [];
      lastBestFreq = 0;
      windowResults = [];
    }

    // Convert game-unit landmark to video pixel coords
    // main.ts does: raw 0..1 -> remap (margin 0.05) -> scale to 16x9
    // Undo: gameUnit / gameSize -> *0.9 + 0.05 -> *videoSize
    function toVideoPixel(gameX: number, gameY: number): [number, number] {
      const normX = gameX / 16 * 0.9 + 0.05;
      const normY = gameY / 9 * 0.9 + 0.05;
      return [normX * 640, normY * 480];
    }

    // Sample mean green channel and RGB in a square region around (px, py)
    function sampleROI(ctx: CanvasRenderingContext2D, px: number, py: number): { green: number; rgb: [number, number, number] } {
      const x = Math.max(0, Math.round(px - ROI_RADIUS));
      const y = Math.max(0, Math.round(py - ROI_RADIUS));
      const size = ROI_RADIUS * 2;
      const rw = Math.min(size, 640 - x);
      const rh = Math.min(size, 480 - y);
      if (rw <= 0 || rh <= 0) return { green: 0, rgb: [0, 0, 0] };

      const data = ctx.getImageData(x, y, rw, rh).data;
      let rSum = 0, gSum = 0, bSum = 0;
      const count = rw * rh;
      for (let i = 0; i < count; i++) {
        rSum += data[i * 4];
        gSum += data[i * 4 + 1];
        bSum += data[i * 4 + 2];
      }
      return {
        green: gSum / count,
        rgb: [rSum / count, gSum / count, bSum / count],
      };
    }

    // DFT at a specific frequency — returns power
    function dftPower(signal: number[], times: number[], freqHz: number): number {
      let re = 0;
      let im = 0;
      for (let i = 0; i < signal.length; i++) {
        const phase = 2 * Math.PI * freqHz * times[i];
        re += signal[i] * Math.cos(phase);
        im += signal[i] * Math.sin(phase);
      }
      return re * re + im * im;
    }

    // Analyze a time window of the buffer to find dominant frequency
    function analyzeWindow(windowSeconds: number): { bpm: number | null; spectrum: { freq: number; power: number }[]; bestFreq: number } {
      // Find the slice of the buffer within the last windowSeconds
      const cutoff = time - windowSeconds;
      let startIdx = 0;
      while (startIdx < timestamps.length && timestamps[startIdx] < cutoff) {
        startIdx++;
      }

      const sliceGreen = greenBuffer.slice(startIdx);
      const sliceTimes = timestamps.slice(startIdx);

      if (sliceGreen.length < 30) return { bpm: null, spectrum: [], bestFreq: 0 };

      // Detrend: subtract mean
      let mean = 0;
      for (let i = 0; i < sliceGreen.length; i++) mean += sliceGreen[i];
      mean /= sliceGreen.length;

      const signal: number[] = [];
      const times: number[] = [];
      for (let i = 0; i < sliceGreen.length; i++) {
        // Hanning window
        const win = 0.5 * (1 - Math.cos(2 * Math.PI * i / (sliceGreen.length - 1)));
        signal.push((sliceGreen[i] - mean) * win);
        times.push(sliceTimes[i]);
      }

      // Scan frequencies from 0.8 Hz (48 BPM) to 3.0 Hz (180 BPM)
      const minFreq = MIN_BPM / 60;
      const maxFreq = MAX_BPM / 60;
      const step = 0.02; // finer resolution (~1.2 BPM)
      let bestFreq = minFreq;
      let bestPower = 0;
      let totalPower = 0;
      let binCount = 0;
      const spectrum: { freq: number; power: number }[] = [];

      for (let f = minFreq; f <= maxFreq; f += step) {
        const p = dftPower(signal, times, f);
        spectrum.push({ freq: f, power: p });
        if (p > bestPower) {
          bestPower = p;
          bestFreq = f;
        }
        totalPower += p;
        binCount++;
      }

      // Confidence check: peak must be at least 2x the mean power
      const meanPower = totalPower / binCount;
      if (bestPower < meanPower * 2) return { bpm: null, spectrum, bestFreq };

      // Sub-harmonic preference: if peak > 120 BPM, check if the fundamental
      // (half frequency) has substantial power. rPPG signals often have strong
      // second harmonics that can fool peak detection. Only override if the
      // sub-harmonic is genuinely strong (>60% of peak), not just noise.
      if (bestFreq * 60 > 120) {
        const subFreq = bestFreq / 2;
        if (subFreq >= minFreq) {
          const subPower = dftPower(signal, times, subFreq);
          if (subPower > bestPower * 0.6 && subPower > meanPower * 2) {
            bestFreq = subFreq;
          }
        }
      }

      return { bpm: Math.round(bestFreq * 60), spectrum, bestFreq };
    }

    // Run multi-window consistency check
    function analyzeConsistent(): number | null {
      const results: { window: number; bpm: number | null }[] = [];
      const passing: number[] = [];

      for (const ws of WINDOW_SIZES) {
        const bufDuration = timestamps.length > 1
          ? timestamps[timestamps.length - 1] - timestamps[0]
          : 0;
        // Skip windows larger than available data
        if (ws > bufDuration + 0.5) {
          results.push({ window: ws, bpm: null });
          continue;
        }
        const result = analyzeWindow(ws);
        results.push({ window: ws, bpm: result.bpm });
        if (result.bpm !== null) {
          passing.push(result.bpm);
        }
      }

      windowResults = results;

      if (passing.length < 2) return null;

      // Check agreement: max spread must be within threshold
      const sorted = [...passing].sort((a, b) => a - b);
      const spread = sorted[sorted.length - 1] - sorted[0];
      if (spread > MAX_BPM_SPREAD) return null;

      // Return median
      return sorted[Math.floor(sorted.length / 2)];
    }

    return {
      setup(_ctx: CanvasRenderingContext2D, ww: number, hh: number) {
        w = ww;
        h = hh;
        rc = new GameRoughCanvas(_ctx.canvas);
        reset();

        // Grab video element and create offscreen canvas
        videoEl = document.querySelector('video');
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = 640;
        offscreenCanvas.height = 480;
        offscreen = offscreenCanvas.getContext('2d', { willReadFrequently: true });
      },

      update(face: FaceData | null, dt: number) {
        time += dt;
        breathPhase = (breathPhase + dt / 8) % 1;

        if (!face) return;

        // Motion detection — track nose position
        const nose = face.landmarks[NOSE_TIP];
        if (!hasHadFace) {
          // First frame: initialize smoothed position, don't check motion
          smoothNoseX = nose.x;
          smoothNoseY = nose.y;
          lastNoseX = nose.x;
          lastNoseY = nose.y;
          hasHadFace = true;
        } else {
          smoothNoseX = smoothNoseX * SMOOTH + nose.x * (1 - SMOOTH);
          smoothNoseY = smoothNoseY * SMOOTH + nose.y * (1 - SMOOTH);

          const dx = smoothNoseX - lastNoseX;
          const dy = smoothNoseY - lastNoseY;
          const delta = Math.sqrt(dx * dx + dy * dy);

          lastNoseX = smoothNoseX;
          lastNoseY = smoothNoseY;

          if (delta > MOTION_THRESHOLD) {
            // Head moved — clear buffer, reset BPM
            greenBuffer = [];
            timestamps = [];
            bpm = null;
            lastAnalysisTime = time;
            return;
          }
        }

        // Sample green channel from video
        if (!offscreen || !videoEl || videoEl.readyState < 2) return;

        offscreen.drawImage(videoEl, 0, 0, 640, 480);

        // Sample 3 ROIs
        const rois = [FOREHEAD, LEFT_CHEEK, RIGHT_CHEEK];
        let greenSum = 0;
        const frameRoiColors: [number, number, number][] = [];
        const frameRoiGreens: number[] = [];
        for (const idx of rois) {
          const lm = face.landmarks[idx];
          const [px, py] = toVideoPixel(lm.x, lm.y);
          const sample = sampleROI(offscreen, px, py);
          greenSum += sample.green;
          frameRoiColors.push(sample.rgb);
          frameRoiGreens.push(sample.green);
        }
        roiColors = frameRoiColors;
        roiGreenValues = frameRoiGreens;
        const meanGreen = greenSum / rois.length;

        // Push to buffer with wall-clock timestamp (seconds)
        greenBuffer.push(meanGreen);
        timestamps.push(time);

        // Trim to keep only last BUFFER_SECONDS
        while (timestamps.length > 0 && timestamps[0] < time - BUFFER_SECONDS) {
          timestamps.shift();
          greenBuffer.shift();
        }

        // Run DFT periodically
        const bufferDuration = timestamps.length > 1
          ? timestamps[timestamps.length - 1] - timestamps[0]
          : 0;

        if (bufferDuration >= MIN_SECONDS && time - lastAnalysisTime >= ANALYSIS_INTERVAL) {
          lastAnalysisTime = time;

          // Full-buffer analysis for spectrum display
          const fullResult = analyzeWindow(bufferDuration);
          lastSpectrum = fullResult.spectrum;
          lastBestFreq = fullResult.bestFreq;

          // Multi-window consistency for actual BPM
          bpm = analyzeConsistent();
        }

        // Expose state for Playwright tests
        (window as any).__heartbeatBpm = bpm;
        (window as any).__heartbeatBufferDuration = bufferDuration;
        (window as any).__heartbeatBufferLength = greenBuffer.length;
      },

      draw(ctx: CanvasRenderingContext2D, _w: number, _h: number, debug?: boolean) {
        const cx = w / 2;
        const cy = h / 2;

        const bufferDuration = timestamps.length > 1
          ? timestamps[timestamps.length - 1] - timestamps[0]
          : 0;

        if (bpm !== null) {
          // BPM available — show large number + pulsing heart
          const beatHz = bpm / 60;
          const beatPhase = (time * beatHz) % 1;
          // Quick systole pulse: sharp rise, slow fall
          const pulse = beatPhase < 0.15
            ? Math.sin(beatPhase / 0.15 * Math.PI)
            : Math.max(0, 1 - (beatPhase - 0.15) / 0.85) * 0.3;
          const heartScale = 1 + pulse * 0.25;

          // Draw heart shape using rough.js polygon
          drawHeart(cx, cy - 0.3, 1.6 * heartScale, rose);

          // BPM text
          pxText(ctx, `${bpm}`, cx, cy + 2.5,
            "600 0.9px Fredoka, sans-serif", charcoal, "center");
          pxText(ctx, "bpm", cx, cy + 3.1,
            "600 0.3px Sora, sans-serif", stone, "center");

          // Signal quality indicator
          pxText(ctx, "hold still for best reading", cx, cy + 3.8,
            "0.18px Sora, sans-serif", stone, "center");
        } else {
          // Collecting — breathing circle + progress
          const breathT = Math.sin(breathPhase * Math.PI * 2) * 0.5 + 0.5;
          const baseRadius = 1.2;
          const breathRadius = baseRadius + breathT * 0.6;

          // Progress toward MIN_SECONDS
          const progress = Math.min(1, bufferDuration / MIN_SECONDS);

          // Breathing circle
          const circleColor = hasHadFace ? rose : stone;
          rc.circle(cx, cy, breathRadius * 2, {
            stroke: circleColor, strokeWidth: 0.03, fill: 'none',
            roughness: 0.8, seed: 40,
          });
          rc.circle(cx, cy, breathRadius * 0.6, {
            fill: circleColor, fillStyle: 'solid', stroke: 'none',
            roughness: 0.5, seed: 41,
          });

          // Progress arc
          if (progress > 0.01) {
            const arcEnd = -Math.PI / 2 + progress * Math.PI * 2;
            rc.arc(cx, cy, 4.0, 4.0, -Math.PI / 2, arcEnd, false, {
              stroke: lavender, strokeWidth: 0.04, roughness: 0.5, seed: 42,
            });
          }

          // Text
          if (!hasHadFace) {
            pxText(ctx, "heartbeat", cx, cy - 2.5,
              "600 0.5px Fredoka, sans-serif", charcoal, "center");
            pxText(ctx, "waiting for face...", cx, cy + 2.5,
              "0.25px Sora, sans-serif", stone, "center");
          } else if (bufferDuration < MIN_SECONDS) {
            pxText(ctx, "heartbeat", cx, cy - 2.5,
              "600 0.5px Fredoka, sans-serif", charcoal, "center");
            pxText(ctx, "measuring...", cx, cy + 2.2,
              "600 0.28px Sora, sans-serif", rose, "center");
            pxText(ctx, "hold still, good lighting helps", cx, cy + 2.8,
              "0.2px Sora, sans-serif", stone, "center");
          } else {
            // Have enough data but no clear signal
            pxText(ctx, "heartbeat", cx, cy - 2.5,
              "600 0.5px Fredoka, sans-serif", charcoal, "center");
            pxText(ctx, "searching for pulse...", cx, cy + 2.2,
              "600 0.28px Sora, sans-serif", rose, "center");
            pxText(ctx, "try better lighting or hold more still", cx, cy + 2.8,
              "0.2px Sora, sans-serif", stone, "center");
          }
        }

        // Debug overlay
        if (debug) {
          drawDebug(ctx);
        }
      },

      demo() {
        bpm = 72;
        time = 12;
        hasHadFace = true;
        // Add some fake buffer so draw() sees data
        for (let i = 0; i < 300; i++) {
          timestamps.push(i / 30);
          greenBuffer.push(128 + Math.sin(i / 30 * 2 * Math.PI * 1.2) * 2);
        }
      },

      cleanup() {
        offscreen = null;
        videoEl = null;
      },
    };

    // -- Debug drawing (pixel-space, crisp lines for data vis) --
    function drawDebug(ctx: CanvasRenderingContext2D) {
      // Get pixel transform info before resetting
      const t = ctx.getTransform();
      const sx = Math.sqrt(t.a * t.a + t.b * t.b); // scale factor

      ctx.save();
      ctx.resetTransform();

      // Panel dimensions in pixels
      const panelX = t.e + 10; // left edge of game area + margin
      const panelW = 320;
      const graphH = 100;

      // -- 3a. Green signal graph --
      const graphY = t.f + 10;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(panelX, graphY, panelW, graphH);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, graphY, panelW, graphH);

      if (greenBuffer.length > 1) {
        // Find value range for scaling
        let gMin = Infinity, gMax = -Infinity;
        for (let i = 0; i < greenBuffer.length; i++) {
          if (greenBuffer[i] < gMin) gMin = greenBuffer[i];
          if (greenBuffer[i] > gMax) gMax = greenBuffer[i];
        }
        const gRange = Math.max(gMax - gMin, 0.1);

        ctx.beginPath();
        ctx.strokeStyle = teal;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < greenBuffer.length; i++) {
          const px = panelX + (i / (greenBuffer.length - 1)) * panelW;
          const py = graphY + graphH - ((greenBuffer[i] - gMin) / gRange) * (graphH - 10) - 5;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      ctx.font = '11px Sora, sans-serif';
      ctx.fillStyle = stone;
      ctx.textAlign = 'left';
      ctx.fillText(`green signal (${greenBuffer.length} samples)`, panelX + 4, graphY + 14);

      // -- 3b. FFT power spectrum --
      const fftY = graphY + graphH + 8;
      const fftH = 80;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(panelX, fftY, panelW, fftH);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, fftY, panelW, fftH);

      if (lastSpectrum.length > 0) {
        let maxPower = 0;
        for (const bin of lastSpectrum) {
          if (bin.power > maxPower) maxPower = bin.power;
        }

        const barW = Math.max(1, panelW / lastSpectrum.length);
        for (let i = 0; i < lastSpectrum.length; i++) {
          const bin = lastSpectrum[i];
          const barH = maxPower > 0 ? (bin.power / maxPower) * (fftH - 20) : 0;
          const bx = panelX + (i / lastSpectrum.length) * panelW;
          const isPeak = Math.abs(bin.freq - lastBestFreq) < 0.03;
          ctx.fillStyle = isPeak ? rose : stone;
          ctx.fillRect(bx, fftY + fftH - barH - 2, barW + 0.5, barH);
        }

        // X-axis labels
        ctx.font = '9px Sora, sans-serif';
        ctx.fillStyle = stone;
        ctx.textAlign = 'left';
        ctx.fillText(`${MIN_BPM}`, panelX + 2, fftY + fftH - 2);
        ctx.textAlign = 'right';
        ctx.fillText(`${MAX_BPM}`, panelX + panelW - 2, fftY + fftH - 2);
        ctx.textAlign = 'center';
        ctx.fillText('BPM', panelX + panelW / 2, fftY + fftH - 2);
      }

      // FFT label with detected BPM
      ctx.font = '11px Sora, sans-serif';
      ctx.fillStyle = stone;
      ctx.textAlign = 'left';
      const peakBpm = lastBestFreq > 0 ? Math.round(lastBestFreq * 60) : '-';
      ctx.fillText(`FFT spectrum (peak: ${peakBpm} bpm)`, panelX + 4, fftY + 14);

      // -- 3c. Multi-window results --
      const winY = fftY + fftH + 8;
      ctx.font = '12px Sora, sans-serif';
      ctx.fillStyle = charcoal;
      ctx.textAlign = 'left';
      let winText = '';
      for (const wr of windowResults) {
        winText += `${wr.window}s: ${wr.bpm !== null ? wr.bpm : '-'}  `;
      }
      if (winText) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(panelX, winY - 2, panelW, 20);
        ctx.fillStyle = charcoal;
        ctx.fillText(winText.trim(), panelX + 4, winY + 12);
      }

      // -- 3d. ROI face mask overlay --
      // Draw colored rectangles at ROI positions on the mirrored video feed
      if (roiColors.length === 3) {
        const GAME_W = 16;
        const GAME_H = 9;
        const rois = [FOREHEAD, LEFT_CHEEK, RIGHT_CHEEK];

        // ROI rectangles are drawn in game-unit space (video is mirrored)
        // We need to convert ROI pixel coords back to game-unit space, then to screen pixels
        for (let i = 0; i < 3; i++) {
          const [r, g, b] = roiColors[i];
          const greenVal = roiGreenValues[i];

          // ROI size in game units (approximate)
          const roiGameW = (ROI_RADIUS * 2 / 640) * GAME_W;
          const roiGameH = (ROI_RADIUS * 2 / 480) * GAME_H;

          // We don't have the face landmarks here, but we can estimate from the last known
          // positions. Since debug view shows the video feed, overlay at a fixed spot
          // Use approximate positions based on typical face placement
          // Forehead: ~center-top, L cheek: ~left, R cheek: ~right
          const approxPositions = [
            [GAME_W / 2, GAME_H * 0.3],  // forehead
            [GAME_W * 0.35, GAME_H * 0.5], // left cheek
            [GAME_W * 0.65, GAME_H * 0.5], // right cheek
          ];

          // These are mirrored game coords — convert to screen pixels
          const gx = approxPositions[i][0];
          const gy = approxPositions[i][1];
          const screenX = t.e + gx * sx;
          const screenY = t.f + gy * sx;
          const screenW = roiGameW * sx;
          const screenH = roiGameH * sx;

          ctx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.5)`;
          ctx.fillRect(screenX - screenW / 2, screenY - screenH / 2, screenW, screenH);

          ctx.font = '10px Sora, sans-serif';
          ctx.fillStyle = 'white';
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 2;
          ctx.textAlign = 'center';
          const label = `${ROI_NAMES[i]} G:${greenVal.toFixed(1)}`;
          ctx.strokeText(label, screenX, screenY - screenH / 2 - 4);
          ctx.fillText(label, screenX, screenY - screenH / 2 - 4);
        }
      }

      ctx.restore();
    }

    // Draw a heart shape using rough.js polygon
    function drawHeart(cx: number, cy: number, size: number, color: string) {
      // Heart parametric: generate points
      const points: [number, number][] = [];
      const steps = 30;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * 2 * Math.PI;
        // Heart curve: x = 16sin^3(t), y = 13cos(t) - 5cos(2t) - 2cos(3t) - cos(4t)
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        // Normalize to roughly -1..1 range and scale
        points.push([
          cx + (hx / 17) * size * 0.5,
          cy + (hy / 17) * size * 0.5 - size * 0.1,
        ]);
      }
      rc.polygon(points, {
        fill: color, fillStyle: 'solid',
        stroke: color, strokeWidth: 0.03,
        roughness: 0.8, seed: 50,
      });
    }
  })(),
};
