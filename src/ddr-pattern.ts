/** Arrow direction in the DDR fixed pattern. "center" = rest beat (no nod required). */
export type ArrowDirection = 'up' | 'down' | 'left' | 'right' | 'center';

/**
 * Fixed 8-step repeating pattern for DDR arrows.
 * "center" beats are rest beats — the arrow is invisible and auto-passes.
 */
const PATTERN: ArrowDirection[] = [
  'up', 'center', 'down', 'center', 'left', 'right', 'left', 'right',
];

/**
 * Get the arrow direction for a given beat number (1-indexed).
 * The pattern repeats every 8 beats.
 */
export function getArrowDirection(beat: number): ArrowDirection {
  // beat is 1-indexed; map to 0-indexed pattern position
  const index = ((beat - 1) % PATTERN.length + PATTERN.length) % PATTERN.length;
  return PATTERN[index];
}

/** Length of the repeating pattern. */
export const PATTERN_LENGTH = PATTERN.length;
