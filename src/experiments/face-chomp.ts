import type { Experiment, Landmarks } from "../types";

// Lip landmarks for mouth tracking
const UPPER_LIP = 13;
const LOWER_LIP = 14;
// Nose bridge to chin for normalizing mouth openness
const NOSE_BRIDGE = 6;
const CHIN = 152;

const SMOOTH = 0.6;
const MOUTH_SMOOTH = 0.5;
const MAX_SPEED_CLOSED = 1.0; // normalized units per second
const MAX_SPEED_OPEN = 0.03; // crawl speed when mouth open
const PLAYER_R = 20;
const FRUIT_R = 14;
const SKULL_R = 16;
const FRUIT_COUNT = 3;
const SKULL_COUNT = 2;
const SKULL_SPEED = 0.06; // normalized units per second
const HUNTER_SPEED = 0.04; // slower but homing
const HUNTER_FIRST_AT = 10; // score when first hunter spawns
const HUNTER_EVERY = 10; // spawn another hunter every N points after that
const MOUTH_OPEN_THRESHOLD = 0.15; // fraction of face height

interface Thing {
  x: number; // 0..1 normalized
  y: number;
  vx: number;
  vy: number;
  homing?: boolean;
}

let px = 0.5;
let py = 0.5;
let score = 0;
let fruits: Thing[] = [];
let skulls: Thing[] = [];
let alive = true;
let tracking = false;
let mouthOpen = 0; // 0 = closed, 1 = fully open
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

function spawnSkull(homing = false): Thing {
  let pos;
  do {
    pos = randPos();
  } while (distPx(pos.x, pos.y, px, py) < (PLAYER_R + SKULL_R) * 4);
  return { ...pos, ...randDir(homing ? HUNTER_SPEED : SKULL_SPEED), homing };
}

// Distance in pixels between two normalized positions
function distPx(ax: number, ay: number, bx: number, by: number): number {
  const dx = (ax - bx) * w;
  const dy = (ay - by) * h;
  return Math.sqrt(dx * dx + dy * dy);
}

function reset() {
  px = 0.5;
  py = 0.5;
  score = 0;
  alive = true;
  mouthOpen = 0;
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

    tracking = !!landmarks;
    if (landmarks) {
      const upper = landmarks[UPPER_LIP];
      const lower = landmarks[LOWER_LIP];
      const bridge = landmarks[NOSE_BRIDGE];
      const chin = landmarks[CHIN];

      // Mouth center position
      const mouthX = 1 - (upper.x + lower.x) / 2; // mirror
      const mouthY = (upper.y + lower.y) / 2;

      // Mouth openness: lip gap normalized by face height
      const faceH = Math.abs(chin.y - bridge.y);
      const lipGap = Math.abs(lower.y - upper.y);
      const rawOpen = Math.min(1, lipGap / (faceH * MOUTH_OPEN_THRESHOLD));
      mouthOpen = mouthOpen * MOUTH_SMOOTH + rawOpen * (1 - MOUTH_SMOOTH);

      // Move toward mouth position, speed capped by mouth state
      const maxSpeed = mouthOpen < 0.3 ? MAX_SPEED_CLOSED : MAX_SPEED_OPEN;
      const targetX = Math.max(0, Math.min(1, px * SMOOTH + mouthX * (1 - SMOOTH)));
      const targetY = Math.max(0, Math.min(1, py * SMOOTH + mouthY * (1 - SMOOTH)));
      let dx = targetX - px;
      let dy = targetY - py;
      const moveDist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = maxSpeed * dt;
      if (moveDist > maxDist && moveDist > 0.0001) {
        dx = (dx / moveDist) * maxDist;
        dy = (dy / moveDist) * maxDist;
      }
      px = Math.max(0, Math.min(1, px + dx));
      py = Math.max(0, Math.min(1, py + dy));
    }

    // Move skulls
    for (const s of skulls) {
      if (s.homing) {
        // Move toward player
        let dx = px - s.x;
        let dy = py - s.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.001) {
          dx /= len;
          dy /= len;
        }
        // Repel from other hunters
        for (const other of skulls) {
          if (other === s || !other.homing) continue;
          const sx = s.x - other.x;
          const sy = s.y - other.y;
          const sd = Math.sqrt(sx * sx + sy * sy);
          if (sd < 0.15 && sd > 0.001) {
            const repel = 0.3 / sd;
            dx += (sx / sd) * repel;
            dy += (sy / sd) * repel;
          }
        }
        // Normalize and apply
        const flen = Math.sqrt(dx * dx + dy * dy);
        if (flen > 0.001) {
          s.x += (dx / flen) * HUNTER_SPEED * dt;
          s.y += (dy / flen) * HUNTER_SPEED * dt;
        }
      } else {
        // Bounce off edges
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < 0.05 || s.x > 0.95) s.vx *= -1;
        if (s.y < 0.05 || s.y > 0.95) s.vy *= -1;
        s.x = Math.max(0.05, Math.min(0.95, s.x));
        s.y = Math.max(0.05, Math.min(0.95, s.y));
      }
    }

    // Check fruit collection — only when mouth is open
    if (mouthOpen > 0.3) {
      for (let i = fruits.length - 1; i >= 0; i--) {
        if (distPx(px, py, fruits[i].x, fruits[i].y) < PLAYER_R + FRUIT_R) {
          score++;
          fruits[i] = spawnFruit();
          if (score >= HUNTER_FIRST_AT && (score - HUNTER_FIRST_AT) % HUNTER_EVERY === 0) {
            skulls.push(spawnSkull(true));
          } else if (score % 5 === 0) {
            skulls.push(spawnSkull());
          }
        }
      }
    }

    // Check skull collision
    for (const s of skulls) {
      if (distPx(px, py, s.x, s.y) < PLAYER_R + SKULL_R) {
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
      ctx.beginPath();
      ctx.arc(sx, sy, SKULL_R, 0, Math.PI * 2);
      ctx.fillStyle = s.homing ? "#a0f" : "#f44";
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(sx - 5, sy - 3, 3, 0, Math.PI * 2);
      ctx.arc(sx + 5, sy - 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy + 6);
      ctx.lineTo(sx + 6, sy + 6);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Player — mouth angle matches your mouth
    const cx = px * w;
    const cy = py * h;
    if (alive) {
      const canMove = mouthOpen < 0.3;
      const mouthAngle = canMove ? 0 : 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, PLAYER_R, mouthAngle, Math.PI * 2 - mouthAngle);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fillStyle = !tracking ? "#666" : canMove ? "#ff0" : "#aa0";
      ctx.fill();
      // Eye
      ctx.beginPath();
      ctx.arc(cx - 2, cy - 8, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    } else {
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
