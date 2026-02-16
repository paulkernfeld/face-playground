# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server with hot reload
- `npm run build` — TypeScript check + Vite production build
- `npx tsc --noEmit` — type-check without emitting

## Architecture

Face tracking playground using MediaPipe FaceMesh (468 landmarks) with a canvas overlay. Browser-only, Vite + TypeScript, no frameworks.

**Core loop** (`src/main.ts`): Keyboard-driven menu → select experiment by number key → init webcam + FaceMesh → async render loop (`while (currentExp) { await rAF; await faceMesh.send(); update; draw }`). The loop awaits FaceMesh inference each frame to prevent send pileup. Press `q` to return to menu, `v` to toggle video feed, `s` for screenshot.

**Landmark remapping**: Raw FaceMesh coordinates (0..1) are remapped with a 5% margin so experiments don't require pushing face to camera edges. Raw landmarks are kept separately for the mesh overlay so it aligns with the video feed.

**Experiment interface** (`src/types.ts`):
```ts
interface Experiment {
  name: string;
  setup(ctx, w, h): void;
  update(landmarks: Landmarks | null, dt: number): void;
  draw(ctx, w, h): void;
}
```

**Adding an experiment**: Create a file in `src/experiments/`, export an `Experiment` object, import it in `main.ts`, and add it to the `experiments` array. It gets a menu entry automatically.

**Key landmark indices**: 1=nose tip, 6=nose bridge, 13=upper lip, 14=lower lip, 152=chin. Coordinates are mirrored (x inverted) so moving right moves cursor right.

## Constraints

- Vite 4.x pinned due to macOS 11 / esbuild compatibility (newer esbuild requires macOS 12+)
- Node 21.7.2 (engine warnings are expected and harmless)
- Camera resolution intentionally 640x480 — FaceMesh downscales internally, lower res improves FPS
