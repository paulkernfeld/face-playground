// Global color palette — "bougie kids toys"
// Muted, warm, Scandinavian-inspired. Not neon primary colors.
// Designed to read well on dark canvas (#1a1a2e) backgrounds.

// Primary accent colors
export const rose = '#E09090';       // dusty rose
export const sage = '#8CC0A0';       // sage green
export const honey = '#DDB878';      // soft honey/mustard
export const teal = '#7CC0B8';       // muted teal
export const lavender = '#B8A8D0';   // warm lavender
export const sky = '#90B8D0';        // soft blue
export const terra = '#CC9888';      // warm terra cotta
export const cream = '#F0E8D8';      // oat/cream

// Neutrals
export const charcoal = '#3D3935';   // warm dark (replaces pure #333)
export const ink = '#2D2A28';        // deepest text
export const stone = '#8A8580';      // muted text

// Canvas background
export const canvasBg = '#1a1a2e';

// Semantic aliases
export const success = sage;
export const warning = honey;
export const danger = rose;

// Per-experiment menu accents (1 per experiment, same order as registry)
export const experimentColors = [
  teal,      // head cursor
  honey,     // face chomp
  sage,      // tension
  lavender,  // body creature
  rose,      // red light green light
  sky,       // rhythm
  terra,     // yoga
  cream,     // posture
];

// Body creature palettes (per-person in multi-person tracking)
export const CREATURE_PALETTES = [
  { body: rose, lArm: lavender, rArm: teal, lLeg: honey, rLeg: rose, hat: honey, smile: rose },
  { body: sky, lArm: terra, rArm: sage, lLeg: lavender, rLeg: sky, hat: terra, smile: sky },
  { body: sage, lArm: honey, rArm: rose, lLeg: teal, rLeg: sage, hat: rose, smile: sage },
  { body: terra, lArm: sky, rArm: teal, lLeg: rose, rLeg: terra, hat: sky, smile: terra },
];

// Spark/particle colors
export const SPARK_COLORS = [honey, rose, teal, lavender, cream];

// Ball accent colors (body creature beach balls)
export const BALL_COLORS: [string, string][] = [
  [rose, cream], [sky, cream], [honey, cream],
  [sage, cream], [lavender, cream], [terra, cream],
];
