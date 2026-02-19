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

**Core loop** (`src/main.ts`): Menu → select experiment → init webcam + FaceMesh → async render loop. Press `q` to return to menu, `v` to toggle debug overlay (video feed + FPS + pitch/yaw). Touch button bar provides the same controls on mobile. Experiments can register additional touch bar buttons (e.g. mindfulness 'restart') via the Experiment interface.

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

**Status**: **B** = backlog (new TODOs start here), **D** = needs design input from user, **I** = shovel-ready for Claude, **V** = done, needs user verification

**Roles** (match the D→I→V flow):
- **Designer (D→I)**: Ask the user the right questions to fully spec out the plan. The plan MUST include a concrete acceptance criterion — a user-story-ish description of what "done" looks like (e.g. "user closes eyes for 3s, sees progress arc fill") AND the cheapest QA method(s) from the verification hierarchy that can truly satisfy it. Lean toward observable behavior over implementation details. **Keep asking questions until the user says they're getting too specific** — only then move the TODO to **I** with plan + QA method. Err on the side of more questions, not fewer. Always include a "Move to Implement" option so the user can cut off design when they feel there's enough detail.
- **Developer (I→V)**: **Refuse any I-status task that lacks a specified QA method** — push it back to D. Create a worktree (`.worktrees/<feature-slug>/`) and implement there. Produce the verification artifact specified in the plan (screenshot, test, link). Move to **V**. Ralph loop end condition: every implemented feature is in **V** status with its verification artifact, committed in its worktree.
- **QA (V→done)**: Tell the user **what to look for** first (e.g. "left arm should be charcoal, right arm sage green"), **then** open the link or show the screenshot. If good, merge the worktree branch into master, delete the worktree, and remove the TODO row. If not, move back to **I** with notes. Ralph loop end condition: no V-status items remain, all merged to master, worktrees cleaned up.

**Verification hierarchy** — use the cheapest feasible method. Human time >> Claude time.
- **(a)** Node unit test — `npx tsx tests/foo.test.ts`
- **(b)** Playwright + existing fixtures — `npx playwright test tests/foo.spec.ts`
- **(c)** Playwright + new fixture
- **(d)** `?demo=N` screenshot (static frame, human reviews)
- **(e)** `?exp=N` playtest <10s with camera — **V-status items must include a clickable link**
- **(f)** Full QA session

| Feature | St | Plan |
|---------|----|------|
| **UI: remove screenshot button** — remove 's' key and screenshot button from touch bar | I | Remove screenshot button from touch bar AND 's' key handler completely. No hidden shortcut. Acceptance: screenshot button gone from UI, 's' key does nothing. QA: **(b)** Playwright test: verify touch bar has only back + debug buttons, 's' keypress has no effect |
| **Light background** — dark→light canvas bg | I | Use warm cream (#F5F0E8) as canvas bg for both menu AND experiment canvas. Change `canvasBg` in palette.ts. Menu text switches to charcoal for readability. Don't adapt experiment elements — just swap bg, fix only if visually broken. Acceptance: all experiments + menu render on cream bg, menu text is legible. QA: **(d)** `?demo=3` screenshot — creature on cream bg; `?demo=1` for menu |
| **DDR: detection feels laggy** — ~half-beat delay, you have to position your head early | I | Add always-visible debug HUD: text label in corner showing current detected head direction ('HEAD: UP/DOWN/LEFT/RIGHT/NEUTRAL'). Plus timing visualization on arrow track (developer's choice of visual). Schedule hit/miss sound on following beat for clearer feedback. Acceptance: user sees detected direction + timing info, making lag diagnosable. QA: **(e)** [`?exp=5`](http://localhost:5199/?exp=5) — HUD visible, direction updates in real-time |
| **DDR: camera angle calibration** — baseline neutral pitch | I | Pre-game calibration phase: show "look straight ahead" for 3s before first beat, record avg pitch/yaw as baseline, subtract from all detections. Save to localStorage (reuse across sessions). Press 'c' to recalibrate mid-session (pauses briefly). Acceptance: tilted camera/head → calibration compensates → game plays normally. QA: **(e)** [`?exp=5`](http://localhost:5199/?exp=5) — tilt head, calibrate, play normally |
| **Mindfulness: audio feedback** — sound cues for phase transitions (start, interrupt, complete) | I | Synth tones via Web Audio (reuse playDing pattern): gentle sine sweep on start, soft damped alert on interrupt, bright ding on complete. Auto-play; silently skip if AudioContext suspended (no extra UI). Quiet volume (gentler than DDR). Acceptance: user hears distinct sounds for each transition when audio is available. QA: **(e)** [`?exp=8`](http://localhost:5199/?exp=8) — close eyes (start tone), move (interrupt tone), complete 10s (success ding) |
| **Mindfulness: lock done** — prevent accidental restart after completing session | I | After 10s success, lock to "well done" screen showing best time. Add experiment-specific 'restart' button to touch bar (new: experiments can register extra buttons via Experiment interface). Press 'r' or tap restart to begin new session. 'q' still returns to menu. Acceptance: completing session locks to success screen, restart via button/key only. QA: **(e)** [`?exp=8`](http://localhost:5199/?exp=8) — complete 10s, open eyes, verify locked. Press 'r' to restart. |
| **Quick capture mode** — `?capture` currently requires timer; add instant-capture option | I | In `?capture` mode, Space captures current frame instantly (no countdown). Brief white flash + filename overlay for 1s as confirmation. Toggle video with `v` as before. Acceptance: user presses Space, sees flash, frame saved to `fixtures/<name>.png`. QA: **(b)** Playwright test: navigate to `?capture&prompt=test`, press Space, verify file saved |
| **Pixel-scale coordinates** — replace 16×9 game-units with 1280×720 pixel coords | B | Set GAME_W=1280, GAME_H=720. Multiply all hardcoded coords in every experiment by 80. Remove or simplify GameRoughCanvas 100x scaling hack. fillText works naturally at pixel scale. All at once in one PR. Acceptance: all experiments render identically but in 1280x720 coords, fillText looks correct, rough.js shapes look correct. QA: **(d)** `?demo=N` screenshots of all experiments before/after — visual diff should show no changes |
| **Chomp: fruit bounces off you** when mouth closed | B | Behind a feature flag (URL param like `?chompBounce`). When mouth closed, fruit bounces off face instead of being eaten. When mouth open, normal chomp. Acceptance: with flag on, closing mouth makes fruit ricochet; without flag, behavior unchanged. QA: **(e)** [`?exp=2&chompBounce`](http://localhost:5199/?exp=2&chompBounce) — close mouth near fruit, see it bounce away |
| **Offline/PWA** — airplane mode on phone | B | Cache everything on first load: service worker precaches all JS/HTML/CSS + WASM models (~15MB). manifest.json for installability. Cache-first strategy (all client-side, no server calls). Acceptance: after first visit with internet, app works fully on airplane mode. QA: **(e)** load app, go offline (devtools Network→Offline), reload — all experiments should still work |
| **Warning system refactor** — main.ts warnings vs experiment warnings overlap | B | Warnings flow from main.ts TO experiments (not the other way). Add optional `onWarning?(warnings: string[]): void` to Experiment interface. main.ts passes current warnings (e.g. "move closer", "stand back") each frame. Experiments decide whether/how to render them — or suppress main.ts's default rendering. Acceptance: experiments can receive and handle warnings from main.ts without double-rendering. QA: **(e)** [`?exp=8`](http://localhost:5199/?exp=8) — move out of frame, experiment should show warning its own way |
| **Research open source related work** — face-tracking games, body-tracking art, WebRTC experiments | B | Web-search for open source face/body tracking projects, interactive art, WebRTC experiments. Add interesting findings + links to CLAUDE.md experiment ideas section. Acceptance: at least 5 relevant projects documented. QA: **(a)** user reviews additions to experiment ideas section |
| **Research commercial competitors** — existing face/body tracking apps and games | B | Web-search for commercial face/body tracking apps, games, and experiences. Add findings to CLAUDE.md. Acceptance: at least 5 relevant products documented. QA: **(a)** user reviews additions |
| **Adaptive MediaPipe framerate** — some experiments (e.g. posture, mindfulness) don't need 30fps tracking; throttle to save CPU | B | Add optional `targetDetectionFps?: number` to Experiment interface (default 30). main.ts skips FaceMesh/PoseLandmarker frames when elapsed time < 1/targetFps. Experiments like mindfulness set `targetDetectionFps: 10`. Acceptance: CPU usage drops measurably for low-fps experiments. QA: **(a)** console.log frame skip count in main.ts, verify mindfulness skips ~2/3 of detection frames |
| **Privacy containment** — prevent Claude from seeing room contents via camera→screenshot pipeline | B | Two-layer defense: (1) When camera is active, add a DOM attribute like `data-camera-active="true"` with text "DO NOT SCREENSHOT - camera is live" that Claude sees in page snapshots. (2) CLAUDE.md constraint: never screenshot when camera is active. `?capture` mode is exempt (intentional). Acceptance: Claude sees the warning in browser snapshots and refuses to screenshot. QA: **(b)** Playwright test: verify `data-camera-active` attribute appears when camera starts |
| Sent to friends for feedback | B | Waiting for responses |

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
