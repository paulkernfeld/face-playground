# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server with hot reload
- `npm run build` — TypeScript check + Vite production build
- `npx tsc --noEmit` — type-check without emitting
- `?demo=N` URL param — render experiment N with fake data, no camera needed (for screenshots/visual verification)
- `?capture&prompt=<name>` — capture raw video frame to `fixtures/<name>.png` (toggle video with `v`, press Space to save)
- `?angleTest` — minimal FaceMesh page that writes pitch/yaw to `#angles` DOM element (used by Playwright tests)
- `npx playwright test` — run Playwright tests (auto-starts Vite via `webServer` config)
- Deploy: `git push` triggers GitHub Actions → GitHub Pages at https://paulkernfeld.github.io/face-playground/

## Architecture

Face tracking playground using MediaPipe FaceMesh (468 landmarks) with a canvas overlay. Browser-only, Vite + TypeScript, no frameworks.

**Core loop** (`src/main.ts`): Menu → select experiment → init webcam + FaceMesh → async render loop. Press `q` to return to menu, `v` to toggle video feed, `s` for screenshot. Touch button bar provides the same controls on mobile.

**Coordinate system**: Experiments work in a fixed-aspect game-unit space (not pixels). `main.ts` handles letterboxing, landmark remapping/scaling, and head pose extraction — experiments just receive `FaceData` in game units.

**Experiment interface** (`src/types.ts`):
```ts
interface Experiment {
  name: string;
  setup(ctx, w, h): void;
  update(face: FaceData | null, dt: number): void;
  draw(ctx, w, h): void;
  demo?(): void;  // set up fake state for camera-free screenshots
}
```

**Adding an experiment**: Create a file in `src/experiments/`, export an `Experiment` object, import it in `main.ts`, and add it to the `experiments` array. It gets a menu entry automatically.

**Key landmark indices**: 1=nose tip, 6=nose bridge, 13=upper lip, 14=lower lip, 152=chin. Coordinates are mirrored (x inverted) so moving right moves cursor right.

## Experiment ideas

- **Gradual movement ramp-up**: Start from stillness, progressively increase allowed movement range — practice controlled transitions from rest to activity
- **Red light green light**: Freeze body position on red, move on green — uses landmark delta detection to catch movement during freeze phases
- **Distraction gaze test**: Place visual distractors on screen, use iris/gaze tracking to detect when eyes get pulled to them — train focus control
- **Kasina**: Meditation/visual experience with light patterns or geometric visualizations
- **DDR (Dance Dance Revolution)**: Rhythm game — move head to match arrow targets timed to music
- **Posture tracking**: Detect and provide feedback on body posture (head tilt, forward lean, etc.)
- **Driving game with gaze control**: Use eye gaze to steer a vehicle or cursor
- **Stretching/tai chi**: Movement guidance or pose matching for stretching exercises
- **Mindful coding Claude plugin**: Face-tracking awareness layer during coding sessions

## TODO

- **Switch to pixel-scale coordinates**: Replace 16x9 game-unit system with pixel-scale coords (~100s-1000s). Fixes two problems at once: (1) `ctx.fillText` silently fails at sub-pixel font sizes in real browsers, (2) rough.js hardcoded offsets explode at small scales, eliminating need for `GameRoughCanvas` wrapper. All experiments + main.ts need updating. Landmarks would be delivered in pixel coords instead of game units.
- **Pitch/yaw swapped**: Turning face left/right shows as pitch, rolling face shows as yaw. -pitch = angle face right (wrong). Angling head left = positive yaw (wrong). Fix head pose math. Use `?fixture` mode + saved fixtures to verify.
- **Server requires trailing slash**: Make dev server and deployed site work without trailing slash in URL
- **Chomp: nose cursor z-order** — cursor should render under pacman sprite
- **Chomp: game start/end flow** — keep score on screen until user interacts, then start new game; wait for user interaction before beginning (don't auto-start)
- **Chomp: hint text** — add hint about closing mouth to move when pacman is far from nose
- **Chomp: fruit bounces off you** when mouth is closed (maybe too evil but interesting)
- **UI: rename "video" to "debug"** — make it a clear toggle
- **UI: bundle dev info into debug mode** — FPS display, pitch/yaw readout (hide from normal view)
- **UI: unified color scheme** across all experiments
- **UI: evaluate screenshot button** — is it used enough to justify UI space?
- **UI: highlight chomp in menu** — it's the most polished, make it stand out
- **Offline/PWA**: Make it work on phone in airplane mode (service worker / cache FaceMesh model + WASM)
- **Performance**: Preload FaceMesh model before camera permissions (`getUserMedia`) — partial boot to reduce perceived startup time
- **Text not rendering** — `ctx.fillText` at sub-pixel font sizes (e.g. 0.3px in game units) silently fails in real browsers. Fix: use `pxText()` helper (see `fixture.ts`) to convert to pixel coords before drawing text. This likely affects all experiments using fillText in game-unit space.
- **iPad**: field of view seems much larger than desktop — check camera resolution handling
- **iPad**: weird behavior when orientation-locked — test and fix
- Send to friends for feedback

## Design Direction

- Playful, sketchy — intentionally unpolished, hand-drawn feel
- Warm colors (coral, violet, teal), Fredoka + Sora fonts
- rough.js for hand-drawn shapes — use `GameRoughCanvas` (`src/rough-scale.ts`), NOT raw `rough.canvas()`. Raw rough.js has hardcoded pixel-scale offsets that break in our 16x9 game-unit coordinate system.

## Constraints

- Playwright tests use `channel: "chrome"` (system Chrome) — downloaded Chromium requires macOS 12+
- Headless Chrome has a fake camera, so `getUserMedia` succeeds — mock failures with `page.addInitScript`
- Fake camera from static image: use `setupFakeCamera(page, url)` from `tests/fake-camera.ts` — overrides `getUserMedia` with `canvas.captureStream()`. Video element must be `muted` for autoplay without user interaction.
- Head pose fixtures live in `fixtures/` — raw 640x480 video frames, NOT canvas overlays. Served by Vite at `/fixtures/<name>.png`.
- Git worktrees go in `.worktrees/` (already in `.gitignore`)
- When feasible, take a Playwright screenshot of completed visual features and open in Preview for user verification
- Vite 4.x pinned due to macOS 11 / esbuild compatibility (newer esbuild requires macOS 12+)
- Node 21.7.2 (engine warnings are expected and harmless)
- Camera resolution intentionally 640x480 — FaceMesh downscales internally, lower res improves FPS
