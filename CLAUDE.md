# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server with hot reload
- `npm run build` — TypeScript check + Vite production build
- `npx tsc --noEmit` — type-check without emitting
- `?demo=N` URL param — render experiment N (1-indexed) with fake data, no camera needed (for screenshots/visual verification)
- `?capture&prompt=<name>` — capture raw video frame to `fixtures/<name>.png` (toggle video with `v`, press Space to save)
- `?angleTest` — minimal FaceMesh page that writes pitch/yaw to `#angles` DOM element (used by Playwright tests)
- `npx playwright test` — run Playwright tests (auto-starts Vite via `webServer` config)
- `npx tsx tests/yoga-classify.test.ts` — pure Node yoga classifier tests (~60ms, no browser needed)
- `npx playwright test tests/extract-landmarks.spec.ts` — one-time extraction of yoga landmark fixtures (slow, needs Chrome)
- Deploy: `git push` triggers GitHub Actions → GitHub Pages at https://paulkernfeld.github.io/face-playground/
- **Before pushing**: ensure `git status` is clean — no stale screenshots, untracked tool dirs, or uncommitted changes

## Architecture

Face tracking playground using MediaPipe FaceMesh (468 landmarks) with a canvas overlay. Browser-only, Vite + TypeScript, no frameworks.

**Core loop** (`src/main.ts`): Menu → select experiment → init webcam + FaceMesh → async render loop. Press `q` to return to menu, `v` to toggle debug overlay (video feed + FPS + pitch/yaw), `s` for screenshot. Touch button bar provides the same controls on mobile.

**Coordinate system**: Experiments work in a fixed-aspect game-unit space (not pixels). `main.ts` handles letterboxing, landmark remapping/scaling, and head pose extraction — experiments just receive `FaceData` in game units.

**Experiment interface** (`src/types.ts`):
```ts
interface Experiment {
  name: string;
  setup(ctx, w, h): void;
  update(face: FaceData | null, dt: number): void;
  draw(ctx, w, h, debug?): void;  // debug=true when 'v' overlay is active
  demo?(): void;  // set up fake state for camera-free screenshots
}
```

**Adding an experiment**: Create a file in `src/experiments/`, export an `Experiment` object, import it in `main.ts`, and add it to the `experiments` array. It gets a menu entry automatically.

**Shared body creature rendering** (`src/experiments/creature-shared.ts`): Extracted `PersonState`, `drawPerson()`, `updatePeople()`, pupil physics, sparks, palettes, and landmark constants. Body-tracking experiments should import from here rather than duplicating creature rendering code.

**DDR rhythm experiment** (`src/experiments/ddr.ts`): Uses Web Audio API with look-ahead scheduling for precise beat timing. Audio clock (`audioCtx.currentTime`) is the master clock — all arrow timing derives from it. Don't try to play sounds from rAF callbacks (causes jitter). 120 BPM kick on every beat, arrows every other beat.

**Web Audio sound effects**: `face-chomp.ts` and `body-creature.ts` both have a `playDing()` function (synthesized sine sweep). If more experiments need sounds, extract to a shared module.

**Key landmark indices**: 1=nose tip, 6=nose bridge, 13=upper lip, 14=lower lip, 152=chin. `gameUnits` are in raw camera coords (not mirrored) — experiments mirror X themselves (e.g. `w - nose.x`).

**Transform matrix** (`FaceData.rawTransformMatrix`): 4x4 column-major from MediaPipe. Rotation used for pitch/yaw. Translation: `m[12]`=tx, `m[13]`=ty, `m[14]`=tz (cm-ish units). `?angleTest` exposes these as `data-tx/ty/tz` attributes for fixture-based measurement.

**Experiments** (1-indexed for `?demo=N`): 1=headCursor, 2=faceChomp, 3=bodyCreature, 4=redLightGreenLight, 5=ddr, 6=yoga, 7=posture.

## Experiment ideas

- **Gradual movement ramp-up**: Start from stillness, progressively increase allowed movement range — practice controlled transitions from rest to activity
- **Distraction gaze test**: Place visual distractors on screen, use iris/gaze tracking to detect when eyes get pulled to them — train focus control
- **Kasina**: Meditation/visual experience with light patterns or geometric visualizations
- **Driving game with gaze control**: Use eye gaze to steer a vehicle or cursor
- **Mindful coding Claude plugin**: Face-tracking awareness layer during coding sessions
- **Breathing rate detector**: Track chest/shoulder movement or subtle face motion to estimate breathing rate
- **Heartbeat detector**: Use rPPG (remote photoplethysmography) — measure subtle redness/blueness changes in face skin to detect pulse (see Verkruysse et al. / Brown University research)
- **Mindfulness**: Close your eyes and stay still for a set duration, detect via blendshapes
- **Face yoga**: Guided facial exercises — open mouth wide, puff cheeks, raise eyebrows, etc.

## TODO

**Remove items from this list when completed** — don't leave stale TODOs.

- **Switch to pixel-scale coordinates**: Replace 16x9 game-unit system with pixel-scale coords (~100s-1000s). Fixes two problems at once: (1) `ctx.fillText` silently fails at sub-pixel font sizes in real browsers, (2) rough.js hardcoded offsets explode at small scales, eliminating need for `GameRoughCanvas` wrapper. All experiments + main.ts need updating. Landmarks would be delivered in pixel coords instead of game units.
- **Pitch/yaw swapped**: Turning face left/right shows as pitch, rolling face shows as yaw. -pitch = angle face right (wrong). Angling head left = positive yaw (wrong). Fix head pose math. Use `?fixture` mode + saved fixtures to verify.
- **Chomp: fruit bounces off you** when mouth is closed (maybe too evil but interesting)
- **UI: evaluate screenshot button** — is it used enough to justify UI space?
- **Offline/PWA**: Make it work on phone in airplane mode (service worker / cache FaceMesh model + WASM)
- **Light background**: Switch from dark canvas bg to light — users need light for camera tracking anyway
- **Yoga: use angles not positions** — match joint angles instead of absolute body position, so it works regardless of where you stand
- **Yoga: alignment visibility** — unaligned body parts render in charcoal, aligned parts in color; show full limb segments (arm, not just elbow)
- **DDR: fixed repeating pattern** — replace random arrows with: up, center, down, center, left, right, left, right (loop forever)
- **DDR: nod detection feels off** — timing/threshold for head nod detection doesn't feel right, needs tuning
- **DDR: camera angle calibration** — camera being too low/high shifts the neutral pitch; add initial calibration step to establish baseline
- **Mindfulness experiment** — simple: close your eyes and stay still, detect via blendshapes
- **Warning system refactor** — chomp's "open your mouth" warning may overlap the main file's face-visibility warning. Refactor so main.ts sends errors/warnings down to experiments via `FaceData` or a callback, and experiments can optionally render them. Face-visibility warning should override game-level warnings.
- **iPad**: field of view seems much larger than desktop — check camera resolution handling
- **Creature: thicker limbs** — limbs are too spindly/skeletal, gives a creepy look. Thicken arms and legs so creatures feel more like chunky cartoon characters
- **Creature: fingers** — show fingers/hands instead of just wrist endpoints, even simple mitten shapes would help
- **Creature: face shape** — draw a face outline/head shape, not just floating eyes. Round head or oval that follows the pose
- **Experiment cleanup**: Ensure every experiment cleans up after itself (audio contexts, timers, event listeners) when returning to menu
- Sent to friends for feedback — waiting for responses

## Philosophy

- Client-only, fully local — no server, no data leaves the browser (privacy by design)
- Easy/fast/fun to add new experiments — low friction from idea to working demo
- Ship quickly, iterate with real usage

## Design Direction

- Playful, sketchy — intentionally unpolished, hand-drawn feel
- Warm muted colors from `src/palette.ts` (rose, sage, honey, teal, lavender, sky, terra), Fredoka + Sora fonts
- **No hardcoded hex colors in experiments** — always import from `src/palette.ts`
- rough.js for hand-drawn shapes — use `GameRoughCanvas` (`src/rough-scale.ts`), NOT raw `rough.canvas()`. Raw rough.js has hardcoded pixel-scale offsets that break in our 16x9 game-unit coordinate system.

## Constraints

- Playwright tests use `channel: "chrome"` (system Chrome) — downloaded Chromium requires macOS 12+
- Headless Chrome has a fake camera, so `getUserMedia` succeeds — mock failures with `page.addInitScript`
- Fake camera from static image: use `setupFakeCamera(page, url)` from `tests/fake-camera.ts` — overrides `getUserMedia` with `canvas.captureStream()`. Video element must be `muted` for autoplay without user interaction.
- Head pose fixtures live in `fixtures/` — raw 640x480 video frames, NOT canvas overlays. Served by Vite at `/fixtures/<name>.png`.
- Yoga pose fixtures prefixed `yoga-` (e.g. `fixtures/yoga-mountain.png`) with extracted `.landmarks.json` for fast Node tests
- `tsx@3.12.x` pinned — newer tsx uses esbuild 0.18+ which requires macOS 12+
- Git worktrees go in `.worktrees/` (already in `.gitignore`)
- When feasible, take a Playwright screenshot of completed visual features and open in Preview for user verification
- Vite 4.x pinned due to macOS 11 / esbuild compatibility (newer esbuild requires macOS 12+)
- Node 21.7.2 (engine warnings are expected and harmless)
- Camera resolution intentionally 640x480 — FaceMesh downscales internally, lower res improves FPS
- **No multi-line bash scripts** — keep each Bash tool call to a single simple command. Don't chain with `&&`, don't use `sleep`, don't combine background processes with waits. If commands need to run sequentially, use separate Bash calls.
- **Dev server for screenshots** — use `npm run dev -- --port 5199` (not `npx vite`) to start the dev server in background. `npm run dev` is allowlisted; raw `npx vite` is not.
- **No `git -C`** — use `cd` to switch directories instead. `git -C` triggers extra approval prompts.
- **`verbatimModuleSyntax` enabled** — use `import type { Foo }` for type-only imports, or `tsc` will error
- **No `ctx.fillText` in game-unit space** — sub-pixel font sizes (anything under ~1px) silently fail. Use `console.log` for debug output, or `pxText()` helper for user-facing text. See TODO for planned pixel-coord fix.
- **Playwright screenshots** — save to `.screenshots/` directory (gitignored), e.g. `filename: ".screenshots/demo.png"`
