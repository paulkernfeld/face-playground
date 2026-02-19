# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server with hot reload
- `npm run build` — TypeScript check + Vite production build
- `npx tsc --noEmit` — type-check without emitting
- `?demo=N` URL param — render experiment N (1-indexed) with fake data, no camera needed (for screenshots/visual verification)
- `?play=N` URL param — run experiment N live with no camera (face=null), for Playwright tests that need the game loop running
- `?exp=N` URL param — jump straight into experiment N with camera (skips menu click), for quick human verification
- `?capture&prompt=<name>` — capture raw video frame to `fixtures/<name>.png` (toggle video with `v`, press Space to save)
- `?angleTest` — minimal FaceMesh page that writes pitch/yaw to `#angles` DOM element (used by Playwright tests)
- `npx playwright test` — run Playwright tests (auto-starts Vite via `webServer` config)
- `npx tsx tests/yoga-classify.test.ts` — pure Node yoga classifier tests (~60ms, no browser needed)
- `npx tsx tests/ddr-pattern.test.ts` — pure Node DDR pattern sequence tests (~30ms, no browser needed)
- `npx playwright test tests/extract-landmarks.spec.ts` — one-time extraction of yoga landmark fixtures (slow, needs Chrome)
- `npx tsx scripts/overlay-demo.ts <exp-number> <fixture>` — render experiment with real pose data overlaid on fixture photo (e.g. `3 yoga-mountain`)
- Deploy: `git push` triggers GitHub Actions → GitHub Pages at https://paulkernfeld.github.io/face-playground/
- **Before pushing**: ensure `git status` is clean — no stale screenshots, untracked tool dirs, or uncommitted changes

## Architecture

Face tracking playground using MediaPipe FaceMesh (468 landmarks) with a canvas overlay. Browser-only, Vite + TypeScript, no frameworks.

**Core loop** (`src/main.ts`): Menu → select experiment → init webcam + FaceMesh → async render loop. Press `q` to return to menu, `v` to toggle debug overlay (video feed + FPS + pitch/yaw), `s` for screenshot. Touch button bar provides the same controls on mobile.

**Coordinate system**: Experiments work in a fixed-aspect game-unit space (not pixels). `main.ts` handles letterboxing, landmark remapping/scaling, and head pose extraction — experiments just receive `FaceData` in game units.

**Experiment interface** (`src/types.ts`): defines `setup`, `update`, `draw`, `cleanup` (required), `demo` and `updatePose` (optional).

**Adding an experiment**: Create a file in `src/experiments/`, export an `Experiment` object, import it in `main.ts`, and add it to the `experiments` array. It gets a menu entry automatically. No module-level mutable state (listeners, timers, audio contexts) — acquire resources in `setup()`, release in `cleanup()`.

**Shared body creature rendering** (`src/experiments/creature-shared.ts`): Extracted `PersonState`, `drawPerson()`, `updatePeople()`, pupil physics, sparks, palettes, and landmark constants. Body-tracking experiments should import from here rather than duplicating creature rendering code.

**DDR rhythm experiment** (`src/experiments/ddr.ts`): Uses Web Audio API with look-ahead scheduling for precise beat timing. Audio clock (`audioCtx.currentTime`) is the master clock — all arrow timing derives from it. Don't try to play sounds from rAF callbacks (causes jitter). Arrow pattern in `src/ddr-pattern.ts`, detection matches head direction (pitch for up/down, yaw for left/right).

**Web Audio sound effects**: `face-chomp.ts` and `body-creature.ts` both have a `playDing()` function (synthesized sine sweep). If more experiments need sounds, extract to a shared module.

**Key landmark indices**: 1=nose tip, 6=nose bridge, 13=upper lip, 14=lower lip, 152=chin. `gameUnits` are in raw camera coords (not mirrored) — experiments mirror X themselves (e.g. `w - nose.x`).

**Transform matrix** (`FaceData.rawTransformMatrix`): 4x4 column-major from MediaPipe. Rotation used for pitch/yaw. Translation: `m[12]`=tx, `m[13]`=ty, `m[14]`=tz (cm-ish units). `?angleTest` exposes these as `data-tx/ty/tz` attributes for fixture-based measurement.

**Experiments** (1-indexed for `?demo=N`): 1=headCursor, 2=faceChomp, 3=bodyCreature, 4=redLightGreenLight, 5=ddr, 6=yoga, 7=posture, 8=mindfulness.

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
- **Posture check CLI command**: Launch Chrome, check posture against saved calibration, report back
- **Shoulder shrugging activity**: Detect/guide shoulder raises and releases via pose landmarks
- **Eye blinking activity**: Track blink rate and patterns via blendshapes
- **Sound effects for more experiments**: Synthesized or sampled audio feedback across experiments
- **Speech synthesis**: Use Web Speech API for voice cues (e.g. "red light", "slouching", "great pose")
- **Soft gaze detection**: Detect relaxed vs focused gaze via iris/pupil tracking
- **Eye yoga (netra vyayamam)**: Guide eyes through all 12 clock positions, figure-8s, near/far focus — trackable via iris landmarks

## TODO

**Remove rows when completed** — don't leave stale TODOs.

**Status**: **D** = needs design input from user, **I** = shovel-ready for Claude, **V** = done, needs user verification

**Roles** (match the D→I→V flow):
- **Design (D→I)**: Ask the user the right questions to fully spec out the plan. Once clear, update the TODO row to **I** with a concrete plan.
- **Implement (I→V)**: Create a worktree (`.worktrees/<feature-slug>/`) and implement there. Verification link must point to the worktree's dev server (e.g. `http://localhost:5200/?demo=3`). Move to **V**. Ralph loop end condition: every implemented feature is in **V** status with a clickable verification link (or passing test), committed in its worktree.
- **QA (V→done)**: Tell the user **what to look for** first (e.g. "left arm should be charcoal, right arm sage green"), **then** open the link. If good, merge the worktree branch into master, delete the worktree, and remove the TODO row. If not, move back to **I** with notes. Ralph loop end condition: no V-status items remain, all merged to master, worktrees cleaned up.

**Verification hierarchy** — use the cheapest feasible method. Human time >> Claude time.
- **(a)** Node unit test — `npx tsx tests/foo.test.ts`
- **(b)** Playwright + existing fixtures — `npx playwright test tests/foo.spec.ts`
- **(c)** Playwright + new fixture
- **(d)** `?demo=N` screenshot (static frame, human reviews)
- **(e)** `?exp=N` playtest <10s with camera — **V-status items must include a clickable link**
- **(f)** Full QA session

| Feature | St | Plan |
|---------|----|------|
| **Pixel-scale coordinates** — replace 16×9 game-units with pixel-scale coords; fixes fillText + rough.js | D | Architectural scope discussion needed |
| **Chomp: fruit bounces off you** when mouth closed | D | "Maybe too evil" — design question |
| **UI: evaluate screenshot button** | D | User usage opinion needed |
| **Offline/PWA** — airplane mode on phone | D | Scope/priority decision |
| **Light background** — dark→light canvas bg | D | Affects all experiments visually |
| **Yoga: use angles not positions** — joint angles instead of absolute position | I | Change classifier to angle-based matching. Verify: **(a)** existing `yoga-classify.test.ts` Node tests still pass |
| **DDR: detection feels laggy** — ~half-beat delay, you have to position your head early | I | Investigate compensation: hit window expansion, latency offset, or visual feedback timing |
| **DDR: camera angle calibration** — baseline neutral pitch | D | UX design for calibration step needed |
| **Mindfulness experiment** — close eyes + stay still via blendshapes | I | New experiment. Verify: **(e)** user opens, closes eyes 3s, sees detection |
| **Warning system refactor** — main.ts warnings vs experiment warnings overlap | D | API design: how experiments receive/render warnings |
| **iPad** — field of view much larger than desktop | D | Needs iPad testing by user |
| **Creature: fingers** — sausage fingers from real landmarks | I | Draw capsules from wrist to each fingertip (pinky 17/18, index 19/20, thumb 21/22). Needs new fixture with hand close to camera. Verify: **(d)** `?demo=3` screenshot + overlay-demo with new fixture |
| **Creature: face from FaceMesh** — use 468 face landmarks to draw head outline (jawline + forehead contour) instead of guessing ellipse from pose landmarks | I | Pass FaceMesh landmarks to drawPerson(), draw face contour polygon. Verify: **(d)** `npx tsx scripts/overlay-demo.ts 3 yoga-mountain` |
| **Research open source related work** — face-tracking games, body-tracking art, WebRTC experiments | D | Survey and document in CLAUDE.md experiment ideas |
| **Research commercial competitors** — existing face/body tracking apps and games | D | Survey and document findings |
| **RAII async/await refactor** — structured cleanup with `withExperiment(fn)` pattern | D | Replace manual cleanup() with scoped resource management. Architectural design needed |
| **Adaptive MediaPipe framerate** — some experiments (e.g. posture, mindfulness) don't need 30fps tracking; throttle to save CPU | D | API design: per-experiment hint or automatic detection |
| **Quick capture mode** — `?capture` currently requires timer; add instant-capture option | D | UX: button or keypress to capture immediately without countdown |
| **Privacy containment** — prevent Claude from seeing room contents via camera→screenshot pipeline | D | Risk: open browser → start camera → screenshot → Claude sees room. Need guardrails (e.g. never screenshot video feed, only canvas overlay; or strip camera frames from screenshots) |
| Sent to friends for feedback | D | Waiting for responses |

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
- Yoga pose fixtures prefixed `yoga-` (e.g. `fixtures/yoga-mountain.png`) with extracted `.landmarks.json` (world-space) and `.image-landmarks.json` (image-space 0..1) for fast Node tests
- `tsx@3.12.x` pinned — newer tsx uses esbuild 0.18+ which requires macOS 12+
- Git worktrees go in `.worktrees/` (already in `.gitignore`)
- When feasible, take a Playwright screenshot of completed visual features and open in Preview for user verification
- Vite 4.x pinned due to macOS 11 / esbuild compatibility (newer esbuild requires macOS 12+)
- Node 21.7.2 (engine warnings are expected and harmless)
- Camera resolution intentionally 640x480 — FaceMesh downscales internally, lower res improves FPS
- **No multi-line bash scripts** — keep each Bash tool call to a single simple command. Don't chain with `&&`, don't use `sleep`, don't combine background processes with waits. If commands need to run sequentially, use separate Bash calls.
- **Dev server for screenshots** — use `Bash(npm run dev -- --port 5199, run_in_background=true)` (no `&`). The `run_in_background` param avoids permission prompts; `&` suffix and raw `npx vite` both trigger prompts.
- **No `curl`** — too broad to whitelist. To check if a local server is up, use `lsof -ti :5199` (checks if anything is listening on the port, no HTTP request).
- **No `git -C`** — use `cd` to switch directories instead. `git -C` triggers extra approval prompts.
- **`verbatimModuleSyntax` enabled** — use `import type { Foo }` for type-only imports, or `tsc` will error
- **No `ctx.fillText` in game-unit space** — sub-pixel font sizes (anything under ~1px) silently fail. Use `console.log` for debug output, or `pxText()` helper for user-facing text. See TODO for planned pixel-coord fix.
- **AudioContext in Playwright** — headless Chrome suspends AudioContext and `currentTime` won't advance. Use `page.addInitScript` to override the constructor with auto-resume. Use `?play=N` instead of pressing menu keys, since `enterExperiment()` blocks on FaceMesh model loading.
- **Exposing game state for tests** — pattern: `(window as any).__ddrArrows = arrows` in game code, then `page.evaluate(() => (window as any).__ddrArrows)` in Playwright. Lightweight way to verify wiring without parsing canvas.
- **Injecting pose data for tests** — set `(window as any).__overridePoses` before experiment starts; both camera and play-mode loops check it. Used by `overlay-demo.ts`.
- **Playwright screenshots** — save to `.screenshots/` directory (gitignored), e.g. `filename: ".screenshots/demo.png"`
