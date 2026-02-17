# Sketchy UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace polished CSS/canvas rendering with rough.js hand-drawn aesthetic across the entire app.

**Architecture:** Add roughjs dependency. Use rough.svg() for HTML menu card borders, rough.canvas() for experiment shape drawing. Each experiment creates its own RoughCanvas in setup(). Use `seed` option for stable wobble on game entities.

**Tech Stack:** roughjs, existing Vite + TypeScript setup

---

### Task 1: Install roughjs and sketch menu cards

**Files:**
- Modify: `package.json` (add roughjs)
- Modify: `src/main.ts:88-138` (showMenu function - add SVG rough borders after innerHTML)
- Modify: `src/style.css:154-206` (card styles - remove polished border-radius/shadow, add .card-sketch)

**Step 1: Install roughjs**

Run: `npm install roughjs`

**Step 2: Update card CSS to remove polished styling**

In `src/style.css`, change `.experiment-card`:
- `border-radius: 20px` → `border-radius: 3px`
- Remove `box-shadow`
- Remove `overflow: hidden`
- Add `background: rgba(255,255,255,0.9)`

Remove `.experiment-card::before` (the clean accent bar — rough line replaces it).

Add new class:
```css
.card-sketch {
  position: absolute;
  inset: -3px;
  width: calc(100% + 6px);
  height: calc(100% + 6px);
  pointer-events: none;
  z-index: 1;
}
```

**Step 3: Add rough SVG borders to cards in showMenu()**

After `menuEl.innerHTML = html`, loop through cards and add rough SVG borders:

```ts
import rough from 'roughjs';

// Inside showMenu(), after setting innerHTML and before adding click listeners:
menuEl.querySelectorAll(".experiment-card").forEach((card) => {
  const el = card as HTMLElement;
  const color = el.style.getPropertyValue('--accent');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'card-sketch');
  svg.setAttribute('viewBox', '0 0 100 130');
  const rc = rough.svg(svg);
  // Border
  svg.appendChild(rc.rectangle(3, 3, 94, 124, {
    stroke: color, strokeWidth: 2, roughness: 1.5, bowing: 1, fill: 'none',
  }));
  // Top accent line
  svg.appendChild(rc.line(3, 8, 97, 8, {
    stroke: color, strokeWidth: 3, roughness: 1.2,
  }));
  el.appendChild(svg);
});
```

**Step 4: Add slight random rotation to title**

In showMenu() HTML, add inline style:
```ts
const tilt = (Math.random() - 0.5) * 3; // -1.5 to 1.5 degrees
// In the h1: style="transform: rotate(${tilt}deg)"
```

**Step 5: Verify and commit**

Run: `npm run dev`, check menu visually — cards should have wobbly hand-drawn borders
Run: `npx tsc --noEmit`
Commit: `git add -A && git commit -m "Add rough.js sketchy borders to menu cards"`

---

### Task 2: Convert head-cursor experiment

**Files:**
- Modify: `src/experiments/head-cursor.ts` (replace all canvas shape draws with rough.js)

**Step 1: Import rough and create instance in setup**

```ts
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';

let rc: RoughCanvas;

// In setup():
rc = rough.canvas(ctx.canvas);
```

**Step 2: Replace trail dots**

Replace `ctx.arc` trail loop with:
```ts
rc.circle(trail[i].x, trail[i].y, (0.05 + t * 0.15) * 2, {
  fill: `rgba(0, 255, 100, ${t * 0.5})`,
  fillStyle: 'solid',
  stroke: 'none',
  roughness: 0.8,
  seed: i + 1,
});
```

**Step 3: Replace cursor circle and crosshair**

Cursor outer ring:
```ts
rc.circle(cx, cy, 0.44, {
  stroke: color, strokeWidth: 0.04, fill: 'none', roughness: 1.2, seed: 100,
});
```

Center dot:
```ts
rc.circle(cx, cy, 0.1, {
  fill: color, fillStyle: 'solid', stroke: 'none', roughness: 0.5, seed: 101,
});
```

Crosshair lines (4 calls to `rc.line`):
```ts
rc.line(cx - 0.35, cy, cx - 0.12, cy, { stroke: color, strokeWidth: 0.03, roughness: 1 });
// ... etc for other 3 lines
```

**Step 4: Verify and commit**

Run: `npm run dev`, select head cursor, check that cursor/trail look hand-drawn
Run: `npx tsc --noEmit`
Commit: `git add src/experiments/head-cursor.ts && git commit -m "Convert head-cursor to rough.js rendering"`

---

### Task 3: Convert face-chomp experiment

**Files:**
- Modify: `src/experiments/face-chomp.ts`

**Step 1: Import rough, add seed to Thing, create instance**

```ts
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';

let rc: RoughCanvas;

interface Thing {
  x: number; y: number; vx: number; vy: number;
  homing?: boolean; guardian?: boolean; orbitAngle?: number;
  seed: number; // NEW
}
```

Add `seed: Math.random() * 2**31 | 0` to spawnFruit(), spawnSkull(), spawnGuardian().

In setup(): `rc = rough.canvas(ctx.canvas);`

**Step 2: Replace fruit drawing**

```ts
for (const f of fruits) {
  rc.circle(f.x, f.y, FRUIT_R * 2, {
    fill: '#0f0', fillStyle: 'solid', stroke: '#090', strokeWidth: 0.02,
    roughness: 1.2, seed: f.seed,
  });
  // Stem as rough line
  rc.line(f.x, f.y - FRUIT_R, f.x + 0.05, f.y - FRUIT_R - 0.1, {
    stroke: '#090', strokeWidth: 0.03, roughness: 1.5, seed: f.seed + 1,
  });
}
```

**Step 3: Replace skull drawing**

```ts
rc.circle(sx, sy, SKULL_R * 2, {
  fill: skullColor, fillStyle: 'solid', stroke: 'none', roughness: 1, seed: s.seed,
});
// Eyes as tiny rough circles
rc.circle(sx - 0.06, sy - 0.04, 0.08, {
  fill: '#000', fillStyle: 'solid', stroke: 'none', roughness: 0.5, seed: s.seed + 1,
});
rc.circle(sx + 0.06, sy - 0.04, 0.08, {
  fill: '#000', fillStyle: 'solid', stroke: 'none', roughness: 0.5, seed: s.seed + 2,
});
// Mouth as rough line(s) — keep ctx for this since rough lines work well
```

**Step 4: Replace player (pac-man) drawing**

```ts
rc.arc(cx, cy, PLAYER_R * 2, PLAYER_R * 2, mouthAngle, Math.PI * 2 - mouthAngle, true, {
  fill: playerColor, fillStyle: 'solid', stroke: 'none', roughness: 0.8, seed: 999,
});
// Eye
rc.circle(cx - 0.02, cy - 0.1, 0.08, {
  fill: '#000', fillStyle: 'solid', stroke: 'none', roughness: 0.5, seed: 998,
});
```

**Step 5: Replace power pellet**

```ts
rc.circle(pellet.x, pellet.y, PELLET_R * pulse * 2, {
  fill: '#fff', fillStyle: 'solid', stroke: 'none', roughness: 1, seed: 500,
});
rc.circle(pellet.x, pellet.y, PELLET_R * pulse * 1.2, {
  fill: '#ff0', fillStyle: 'solid', stroke: 'none', roughness: 0.8, seed: 501,
});
```

**Step 6: Replace hint/warning pill backgrounds**

Use `rc.rectangle` for the "open your mouth!" and death message backgrounds.

**Step 7: Verify and commit**

Run: `npm run dev`, play face-chomp, check all elements look hand-drawn
Run: `npx tsc --noEmit`
Commit: `git add src/experiments/face-chomp.ts && git commit -m "Convert face-chomp to rough.js rendering"`

---

### Task 4: Convert tension experiment

**Files:**
- Modify: `src/experiments/blendshape-debug.ts`

**Step 1: Import rough, create instance**

```ts
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';

let rc: RoughCanvas;
// In setup(): rc = rough.canvas(ctx.canvas);
```

**Step 2: Replace bar graph rectangles with rough rectangles**

Background bars:
```ts
rc.rectangle(barX, y + 0.02, BAR_MAX, 0.25, {
  fill: 'rgba(255,255,255,0.05)', fillStyle: 'solid', stroke: 'none', roughness: 0.4,
});
```

Value bars:
```ts
rc.rectangle(barX, y + 0.02, val * BAR_MAX, 0.25, {
  fill: fillColor, fillStyle: 'solid', stroke: 'none', roughness: 0.6,
});
```

**Step 3: Verify and commit**

Run: `npm run dev`, check tension experiment bars look sketchy
Run: `npx tsc --noEmit`
Commit: `git add src/experiments/blendshape-debug.ts && git commit -m "Convert tension bars to rough.js rendering"`

---

### Task 5: Convert angle warnings

**Files:**
- Modify: `src/main.ts:341-370` (drawAngleWarnings function)

**Step 1: Import rough and create canvas instance**

In main.ts, after canvas is created:
```ts
import rough from 'roughjs';
const rc = rough.canvas(canvas);
```

**Step 2: Replace warning pill with rough rectangle**

```ts
rc.rectangle(tx - pw / 2, ty - ph / 2 - 0.08, pw, ph, {
  fill: 'rgba(15, 15, 35, 0.7)', fillStyle: 'solid', stroke: 'none', roughness: 0.6,
});
```

Keep text rendering with native ctx (text stays crisp).

**Step 3: Verify and commit**

Run: `npm run dev`, trigger angle warning, check it has rough background
Run: `npx tsc --noEmit`
Commit: `git add src/main.ts && git commit -m "Convert angle warnings to rough.js rendering"`
