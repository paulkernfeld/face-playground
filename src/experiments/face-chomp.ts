import type { Experiment, FaceData } from "../types";
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';

// Nose tip for position tracking
const NOSE_TIP = 1;
// Lip landmarks for mouth open/close detection
const UPPER_LIP = 13;
const LOWER_LIP = 14;
// Nose bridge to chin for normalizing mouth openness
const NOSE_BRIDGE = 6;
const CHIN = 152;

const SMOOTH = 0.6;
const MOUTH_SMOOTH = 0.5;
const MAX_SPEED_CLOSED = 16.0; // game units per second
const MAX_SPEED_OPEN = 1.0; // game units per second (2x previous)
const PLAYER_R = 0.25;
const FRUIT_R = 0.18;
const PELLET_R = 0.22;
const SKULL_R = 0.2;
const FRUIT_COUNT = 3;
const SKULL_COUNT = 2;
const SKULL_SPEED = 0.96; // game units per second
const HUNTER_SPEED = 0.64; // game units per second
const GUARDIAN_SPEED = 0.5; // game units per second
const GUARDIAN_ORBIT_R = 0.6; // orbit radius around fruit
const GUARDIAN_FIRST_AT = 15;
const GUARDIAN_EVERY = 15;
const HUNTER_FIRST_AT = 10;
const HUNTER_EVERY = 10;
const MOUTH_OPEN_THRESHOLD = 0.15;
const POWER_DURATION = 5000;
const POWER_WARN = 1500;
const PELLET_EVERY = 8;
const PELLET_LIFETIME = 8000;

// Game area bounds in game units
const MIN_X = 1.6;
const MAX_X = 14.4;
const MIN_Y = 0.9;
const MAX_Y = 7.2;

interface Thing {
  x: number;
  y: number;
  vx: number;
  vy: number;
  seed: number;
  homing?: boolean;
  guardian?: boolean;
  orbitAngle?: number;
}

let px = 8;
let py = 4.5;
let score = 0;
let fruits: Thing[] = [];
let skulls: Thing[] = [];
let pellet: Thing | null = null;
let pelletSpawnedAt = 0;
let alive = true;
let tracking = false;
let mouthOpen = 0;
let deathTime = 0;
let powerUntil = 0;
let fruitsEaten = 0;
let nearFruitButClosed = false;
let w = 16;
let h = 9;
let rc: RoughCanvas;
let seedCounter = 1000;

function randPos(): { x: number; y: number } {
  return { x: MIN_X + Math.random() * (MAX_X - MIN_X), y: MIN_Y + Math.random() * (MAX_Y - MIN_Y) };
}

function randDir(speed: number): { vx: number; vy: number } {
  const angle = Math.random() * Math.PI * 2;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function spawnFruit(): Thing {
  return { ...randPos(), vx: 0, vy: 0, seed: seedCounter++ };
}

function spawnSkull(homing = false): Thing {
  let pos;
  do {
    pos = randPos();
  } while (dist(pos.x, pos.y, px, py) < (PLAYER_R + SKULL_R) * 4);
  return { ...pos, ...randDir(homing ? HUNTER_SPEED : SKULL_SPEED), seed: seedCounter++, homing };
}

function spawnGuardian(): Thing {
  let pos;
  do {
    pos = randPos();
  } while (dist(pos.x, pos.y, px, py) < (PLAYER_R + SKULL_R) * 4);
  return { ...pos, vx: 0, vy: 0, seed: seedCounter++, guardian: true, orbitAngle: Math.random() * Math.PI * 2 };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function isPowered(): boolean {
  return performance.now() < powerUntil;
}

function reset() {
  px = 8;
  py = 4.5;
  score = 0;
  alive = true;
  mouthOpen = 0;
  powerUntil = 0;
  fruitsEaten = 0;
  nearFruitButClosed = false;
  pellet = null;
  pelletSpawnedAt = 0;
  fruits = [];
  skulls = [];
  for (let i = 0; i < FRUIT_COUNT; i++) fruits.push(spawnFruit());
  for (let i = 0; i < SKULL_COUNT; i++) skulls.push(spawnSkull());
}

export const faceChomp: Experiment = {
  name: "face chomp",

  setup(ctx, ww, hh) {
    w = ww;
    h = hh;
    rc = rough.canvas(ctx.canvas);
    reset();
  },

  update(face: FaceData | null, dt: number) {
    if (!alive) {
      if (performance.now() - deathTime > 2000) reset();
      return;
    }

    tracking = !!face;
    nearFruitButClosed = false;

    if (face) {
      const nose = face.landmarks[NOSE_TIP];
      const upper = face.landmarks[UPPER_LIP];
      const lower = face.landmarks[LOWER_LIP];
      const bridge = face.landmarks[NOSE_BRIDGE];
      const chin = face.landmarks[CHIN];

      // Nose position for movement (already in game units)
      const noseX = w - nose.x; // mirror
      const noseY = nose.y;

      // Mouth openness: lip gap normalized by face height
      const faceH = Math.abs(chin.y - bridge.y);
      const lipGap = Math.abs(lower.y - upper.y);
      const rawOpen = Math.min(1, lipGap / (faceH * MOUTH_OPEN_THRESHOLD));
      mouthOpen = mouthOpen * MOUTH_SMOOTH + rawOpen * (1 - MOUTH_SMOOTH);

      // Move toward nose position, speed capped by mouth state
      const maxSpeed = mouthOpen < 0.3 ? MAX_SPEED_CLOSED : MAX_SPEED_OPEN;
      const targetX = Math.max(0, Math.min(w, px * SMOOTH + noseX * (1 - SMOOTH)));
      const targetY = Math.max(0, Math.min(h, py * SMOOTH + noseY * (1 - SMOOTH)));
      let dx = targetX - px;
      let dy = targetY - py;
      const moveDist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = maxSpeed * dt;
      if (moveDist > maxDist && moveDist > 0.0001) {
        dx = (dx / moveDist) * maxDist;
        dy = (dy / moveDist) * maxDist;
      }
      px = Math.max(0, Math.min(w, px + dx));
      py = Math.max(0, Math.min(h, py + dy));

      // Check if near a fruit but mouth closed
      for (const f of fruits) {
        if (dist(px, py, f.x, f.y) < PLAYER_R + FRUIT_R && mouthOpen < 0.3) {
          nearFruitButClosed = true;
          break;
        }
      }
    }

    // Move skulls
    const powered = isPowered();
    for (const s of skulls) {
      if (s.guardian) {
        // Guardian behavior: patrol near fruits, orbit when close
        // Same behavior whether powered or not (guardians don't flee)
        let nearestFruit: Thing | null = null;
        let nearestDist = Infinity;
        for (const f of fruits) {
          const d = dist(s.x, s.y, f.x, f.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearestFruit = f;
          }
        }

        if (nearestFruit) {
          if (nearestDist > GUARDIAN_ORBIT_R + 0.1) {
            // Move toward nearest fruit
            let dx = nearestFruit.x - s.x;
            let dy = nearestFruit.y - s.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0.001) {
              s.x += (dx / len) * GUARDIAN_SPEED * dt;
              s.y += (dy / len) * GUARDIAN_SPEED * dt;
            }
          } else {
            // Orbit the fruit
            s.orbitAngle = (s.orbitAngle ?? 0) + dt * 1.5;
            s.x = nearestFruit.x + Math.cos(s.orbitAngle) * GUARDIAN_ORBIT_R;
            s.y = nearestFruit.y + Math.sin(s.orbitAngle) * GUARDIAN_ORBIT_R;
          }
        }
        s.x = Math.max(MIN_X * 0.5, Math.min(MAX_X * 1.05, s.x));
        s.y = Math.max(MIN_Y * 0.5, Math.min(MAX_Y * 1.05, s.y));
      } else if (s.homing) {
        if (powered) {
          // Flee from player when powered
          let dx = s.x - px;
          let dy = s.y - py;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) {
            s.x += (dx / len) * HUNTER_SPEED * 0.7 * dt;
            s.y += (dy / len) * HUNTER_SPEED * 0.7 * dt;
          }
          s.x = Math.max(MIN_X * 0.5, Math.min(MAX_X * 1.05, s.x));
          s.y = Math.max(MIN_Y * 0.5, Math.min(MAX_Y * 1.05, s.y));
        } else {
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
            if (sd < 2.4 && sd > 0.001) {
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
        }
      } else {
        // Bounce off edges
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < MIN_X * 0.5 || s.x > MAX_X * 1.05) s.vx *= -1;
        if (s.y < MIN_Y * 0.5 || s.y > MAX_Y * 1.05) s.vy *= -1;
        s.x = Math.max(MIN_X * 0.5, Math.min(MAX_X * 1.05, s.x));
        s.y = Math.max(MIN_Y * 0.5, Math.min(MAX_Y * 1.05, s.y));
      }
    }

    // Expire power pellet
    if (pellet && performance.now() - pelletSpawnedAt > PELLET_LIFETIME) {
      pellet = null;
    }

    // Check fruit collection — only when mouth is open
    if (mouthOpen > 0.3) {
      for (let i = fruits.length - 1; i >= 0; i--) {
        if (dist(px, py, fruits[i].x, fruits[i].y) < PLAYER_R + FRUIT_R) {
          fruitsEaten++;
          score++;
          fruits[i] = spawnFruit();
          if (fruitsEaten >= HUNTER_FIRST_AT && (fruitsEaten - HUNTER_FIRST_AT) % HUNTER_EVERY === 0) {
            skulls.push(spawnSkull(true));
          } else if (fruitsEaten % 5 === 0) {
            skulls.push(spawnSkull());
          }
          // Spawn guardian
          if (fruitsEaten >= GUARDIAN_FIRST_AT && (fruitsEaten - GUARDIAN_FIRST_AT) % GUARDIAN_EVERY === 0) {
            skulls.push(spawnGuardian());
          }
          // Spawn a power pellet every N fruit
          if (!pellet && !powered && fruitsEaten % PELLET_EVERY === 0) {
            pellet = spawnFruit();
            pelletSpawnedAt = performance.now();
          }
        }
      }

      // Check power pellet collection
      if (pellet && dist(px, py, pellet.x, pellet.y) < PLAYER_R + PELLET_R) {
        powerUntil = performance.now() + POWER_DURATION;
        pellet = null;
      }

      // Eat skulls when powered
      if (powered) {
        for (let i = skulls.length - 1; i >= 0; i--) {
          if (dist(px, py, skulls[i].x, skulls[i].y) < PLAYER_R + SKULL_R) {
            skulls.splice(i, 1);
          }
        }
      }
    }

    // Check skull collision (only when not powered)
    if (!powered) {
      for (const s of skulls) {
        if (dist(px, py, s.x, s.y) < PLAYER_R + SKULL_R) {
          alive = false;
          deathTime = performance.now();
        }
      }
    }
  },

  draw(ctx, ww, hh) {
    w = ww;
    h = hh;
    const powered = isPowered();
    const powerRemaining = powerUntil - performance.now();
    const warning = powered && powerRemaining < POWER_WARN;

    // Fruits
    for (const f of fruits) {
      rc.circle(f.x, f.y, FRUIT_R * 2, {
        fill: '#0f0', fillStyle: 'solid', stroke: 'none',
        roughness: 1.2, seed: f.seed,
      });
      // Stem
      rc.line(f.x, f.y - FRUIT_R, f.x + 0.05, f.y - FRUIT_R - 0.1, {
        stroke: '#090', strokeWidth: 0.03, roughness: 1.5, seed: f.seed + 500,
      });
    }

    // Power pellet
    if (pellet) {
      const pulse = 0.8 + Math.sin(performance.now() / 150) * 0.2;
      rc.circle(pellet.x, pellet.y, PELLET_R * pulse * 2, {
        fill: '#fff', fillStyle: 'solid', stroke: 'none',
        roughness: 1, seed: pellet.seed,
      });
      rc.circle(pellet.x, pellet.y, PELLET_R * pulse * 1.2, {
        fill: '#ff0', fillStyle: 'solid', stroke: 'none',
        roughness: 0.8, seed: pellet.seed + 1,
      });
    }

    // Skulls
    for (const s of skulls) {
      const sx = s.x;
      const sy = s.y;

      // Guardian orbit ring indicator
      if (s.guardian && !powered) {
        rc.circle(sx, sy, GUARDIAN_ORBIT_R, {
          stroke: 'rgba(0, 200, 100, 0.2)', strokeWidth: 0.02,
          fill: 'none', roughness: 1.5, seed: s.seed + 10,
        });
      }

      let fillColor: string;
      if (powered) {
        const flash = warning && Math.floor(performance.now() / 150) % 2 === 0;
        fillColor = flash ? '#fff' : '#22f';
      } else if (s.guardian) {
        fillColor = '#0c6';
      } else {
        fillColor = s.homing ? '#a0f' : '#f44';
      }
      rc.circle(sx, sy, SKULL_R * 2, {
        fill: fillColor, fillStyle: 'solid', stroke: 'none',
        roughness: 1.2, seed: s.seed,
      });
      // Eyes
      rc.circle(sx - 0.06, sy - 0.04, 0.08, {
        fill: '#000', fillStyle: 'solid', stroke: 'none',
        roughness: 0.5, seed: s.seed + 1,
      });
      rc.circle(sx + 0.06, sy - 0.04, 0.08, {
        fill: '#000', fillStyle: 'solid', stroke: 'none',
        roughness: 0.5, seed: s.seed + 2,
      });
      // Mouth
      if (powered) {
        rc.line(sx - 0.08, sy + 0.06, sx - 0.04, sy + 0.09, { stroke: '#000', strokeWidth: 0.03, roughness: 1, seed: s.seed + 3 });
        rc.line(sx - 0.04, sy + 0.09, sx, sy + 0.06, { stroke: '#000', strokeWidth: 0.03, roughness: 1, seed: s.seed + 4 });
        rc.line(sx, sy + 0.06, sx + 0.04, sy + 0.09, { stroke: '#000', strokeWidth: 0.03, roughness: 1, seed: s.seed + 5 });
        rc.line(sx + 0.04, sy + 0.09, sx + 0.08, sy + 0.06, { stroke: '#000', strokeWidth: 0.03, roughness: 1, seed: s.seed + 6 });
      } else {
        rc.line(sx - 0.08, sy + 0.08, sx + 0.08, sy + 0.08, { stroke: '#000', strokeWidth: 0.03, roughness: 1, seed: s.seed + 3 });
      }
    }

    // Player
    const cx = px;
    const cy = py;
    if (alive) {
      const canMove = mouthOpen < 0.3;
      const mouthAngle = canMove ? 0.15 : 0.8;
      let playerColor: string;
      if (!tracking) {
        playerColor = '#666';
      } else if (powered) {
        const flash = warning && Math.floor(performance.now() / 150) % 2 === 0;
        playerColor = flash ? '#ff0' : '#4cf';
      } else {
        playerColor = canMove ? '#ff0' : '#aa0';
      }
      // Pac-man arc
      rc.arc(cx, cy, PLAYER_R * 2, PLAYER_R * 2, mouthAngle, Math.PI * 2 - mouthAngle, true, {
        fill: playerColor, fillStyle: 'solid', stroke: 'none',
        roughness: 1, seed: 1,
      });
      // Eye
      rc.circle(cx - 0.02, cy - 0.1, 0.08, {
        fill: '#000', fillStyle: 'solid', stroke: 'none',
        roughness: 0.5, seed: 2,
      });
    } else {
      rc.circle(cx, cy, PLAYER_R * 2, {
        fill: 'rgba(255, 255, 0, 0.3)', fillStyle: 'solid', stroke: 'none',
        roughness: 1.5, seed: 3,
      });
    }

    // "Open your mouth!" hint — keep native text
    if (nearFruitButClosed && alive) {
      const msg = "open your mouth!";
      ctx.font = "bold 0.3px monospace";
      ctx.textAlign = "center";
      const metrics = ctx.measureText(msg);
      const pw = metrics.width + 0.3;
      const ph = 0.45;
      const hx = cx;
      const hy = cy - PLAYER_R - 0.4;

      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.beginPath();
      ctx.roundRect(hx - pw / 2, hy - ph / 2, pw, ph, 0.08);
      ctx.fill();

      ctx.fillStyle = "#ff0";
      ctx.fillText(msg, hx, hy + 0.1);
    }

    // Score — native text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 0.35px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${score}`, w - 0.25, 0.5);

    // Death message — native text
    if (!alive) {
      ctx.fillStyle = "#f44";
      ctx.font = "bold 0.6px monospace";
      ctx.textAlign = "center";
      ctx.fillText("CHOMP'D", w / 2, h / 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "0.25px monospace";
      ctx.fillText(`score: ${score}`, w / 2, h / 2 + 0.5);
    }
  },
};
