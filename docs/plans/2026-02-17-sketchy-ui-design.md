# Sketchy UI Design

Replace polished CSS rendering with rough.js hand-drawn aesthetic across menu and canvas experiments.

## Dependency

Add `roughjs` (~9kB gzipped). Works on both canvas and SVG.

## Menu

- Cards: rough.js SVG rectangles instead of CSS border-radius + box-shadow
- Colored top accent: rough line stroke
- Remove border-radius: 20px (rough shapes have wobbly corners naturally)
- Title: keep Fredoka, add slight random CSS rotation (-1 to 1 deg)
- Background blobs + gradient: keep as-is (atmospheric, not structural)

## Canvas experiments

- Shared rough canvas instance exported from a util module
- head-cursor: rough circle + rough crosshair lines
- face-chomp: rough circles for pac-man, fruits, skulls
- tension: rough rectangles for bar graphs

## Toolbar / HUD / warnings

- Toolbar buttons: rough-drawn SVG borders
- FPS badge: rough pill outline
- Angle warnings: rough roundedRect on canvas

## What stays clean

- Text (crisp fonts for readability)
- Gradient background + blobs
- Layout and spacing
