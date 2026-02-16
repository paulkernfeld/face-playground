import type { Experiment, Landmarks } from "../types";

const NOSE_TIP = 1;
const SMOOTH = 0.6;
const PLAYER_R = 20;
const FRUIT_R = 14;
const SKULL_R = 16;
const FRUIT_COUNT = 3;
const SKULL_COUNT = 2;
const SKULL_SPEED = 0.06; // normalized units per second

interface Thing {
  x: number; // 0..1 normalized
  y: number;
  vx: number;
  vy: number;
}

let px = 0.5;
let py = 0.5;
let score = 0;
let fruits: Thing[] = [];
let skulls: Thing[] = [];
let alive = true;
let tracking = false;
let deathTime = 0;
let w = 0;
let h = 0;

function randPos(): { x: number; y: number } {
  return { x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.8 };
}

function randDir(speed: number): { vx: number; vy: number } {
  const angle = Math.random() * Math.PI * 2;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function spawnFruit(): Thing {
  return { ...randPos(), vx: 0, vy: 0 };
}

function spawnSkull(): Thing {
  return { ...randPos(), ...randDir(SKULL_SPEED) };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function reset() {
  px = 0.5;
  py = 0.5;
  score = 0;
  alive = true;
  fruits = [];
  skulls = [];
  for (let i = 0; i < FRUIT_COUNT; i++) fruits.push(spawnFruit());
  for (let i = 0; i < SKULL_COUNT; i++) skulls.push(spawnSkull());
}

export const faceChomp: Experiment = {
  name: "face chomp",

  setup(_ctx, ww, hh) {
    w = ww;
    h = hh;
    reset();
  },

  update(landmarks: Landmarks | null, dt: number) {
    if (!alive) {
      if (performance.now() - deathTime > 2000) reset();
      return;
    }

    // Track nose
    tracking = !!landmarks;
    if (landmarks) {
      const nose = landmarks[NOSE_TIP];
      const targetX = 1 - nose.x; // mirror
      const targetY = nose.y;
      px = Math.max(0, Math.min(1, px * SMOOTH + targetX * (1 - SMOOTH)));
      py = Math.max(0, Math.min(1, py * SMOOTH + targetY * (1 - SMOOTH)));
    }

    // Move skulls, bounce off edges
    for (const s of skulls) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < 0.05 || s.x > 0.95) s.vx *= -1;
      if (s.y < 0.05 || s.y > 0.95) s.vy *= -1;
      s.x = Math.max(0.05, Math.min(0.95, s.x));
      s.y = Math.max(0.05, Math.min(0.95, s.y));
    }

    // Check fruit collection
    const collectR = (PLAYER_R + FRUIT_R) / Math.min(w, h);
    for (let i = fruits.length - 1; i >= 0; i--) {
      if (dist(px, py, fruits[i].x, fruits[i].y) < collectR) {
        score++;
        fruits[i] = spawnFruit();
        // Every 5 points, add another skull
        if (score % 5 === 0) {
          skulls.push(spawnSkull());
        }
      }
    }

    // Check skull collision
    const hitR = (PLAYER_R + SKULL_R) / Math.min(w, h);
    for (const s of skulls) {
      if (dist(px, py, s.x, s.y) < hitR) {
        alive = false;
        deathTime = performance.now();
      }
    }
  },

  draw(ctx, ww, hh) {
    w = ww;
    h = hh;

    // Fruits
    for (const f of fruits) {
      ctx.beginPath();
      ctx.arc(f.x * w, f.y * h, FRUIT_R, 0, Math.PI * 2);
      ctx.fillStyle = "#0f0";
      ctx.fill();
      // Stem
      ctx.beginPath();
      ctx.moveTo(f.x * w, f.y * h - FRUIT_R);
      ctx.lineTo(f.x * w + 4, f.y * h - FRUIT_R - 8);
      ctx.strokeStyle = "#090";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Skulls
    for (const s of skulls) {
      const sx = s.x * w;
      const sy = s.y * h;
      // Head
      ctx.beginPath();
      ctx.arc(sx, sy, SKULL_R, 0, Math.PI * 2);
      ctx.fillStyle = "#f44";
      ctx.fill();
      // Eyes
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(sx - 5, sy - 3, 3, 0, Math.PI * 2);
      ctx.arc(sx + 5, sy - 3, 3, 0, Math.PI * 2);
      ctx.fill();
      // Mouth
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy + 6);
      ctx.lineTo(sx + 6, sy + 6);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Player
    const cx = px * w;
    const cy = py * h;
    if (alive) {
      // Open mouth effect based on movement
      ctx.beginPath();
      ctx.arc(cx, cy, PLAYER_R, 0.3, Math.PI * 2 - 0.3);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fillStyle = tracking ? "#ff0" : "#666";
      ctx.fill();
      // Eye
      ctx.beginPath();
      ctx.arc(cx - 2, cy - 8, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    } else {
      // Dead
      ctx.beginPath();
      ctx.arc(cx, cy, PLAYER_R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 0, 0.3)";
      ctx.fill();
    }

    // Score
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${score}`, w - 20, 40);

    // Death message
    if (!alive) {
      ctx.fillStyle = "#f44";
      ctx.font = "bold 48px monospace";
      ctx.textAlign = "center";
      ctx.fillText("CHOMP'D", w / 2, h / 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "20px monospace";
      ctx.fillText(`score: ${score}`, w / 2, h / 2 + 40);
    }
  },
};
