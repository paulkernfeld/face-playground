/**
 * Wrapper around rough.js RoughCanvas that scales game-unit coordinates
 * to pixel-like coordinates internally. Rough.js has hardcoded pixel-scale
 * offsets (1, 1.5, 0.3) in its renderer that break when drawing in small
 * coordinate systems like our 16x9 game units.
 *
 * This wrapper applies ctx.scale(1/S, 1/S) before each draw call and
 * multiplies all coordinates/sizes by S, so rough.js sees pixel-scale
 * values while the canvas transform maps everything back to game units.
 */
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import type { Options } from 'roughjs/bin/core';

const S = 100;

export class GameRoughCanvas {
  private rc: RoughCanvas;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.rc = rough.canvas(canvas);
    this.ctx = canvas.getContext('2d')!;
  }

  private wrap(fn: () => void) {
    this.ctx.save();
    this.ctx.scale(1 / S, 1 / S);
    fn();
    this.ctx.restore();
  }

  private opts(o?: Options): Options {
    if (!o) return {};
    const scaled = { ...o };
    if (scaled.strokeWidth !== undefined) scaled.strokeWidth *= S;
    return scaled;
  }

  circle(x: number, y: number, diameter: number, options?: Options) {
    this.wrap(() => {
      this.rc.circle(x * S, y * S, diameter * S, this.opts(options));
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, options?: Options) {
    this.wrap(() => {
      this.rc.line(x1 * S, y1 * S, x2 * S, y2 * S, this.opts(options));
    });
  }

  rectangle(x: number, y: number, w: number, h: number, options?: Options) {
    this.wrap(() => {
      this.rc.rectangle(x * S, y * S, w * S, h * S, this.opts(options));
    });
  }

  arc(x: number, y: number, w: number, h: number, start: number, stop: number, closed: boolean, options?: Options) {
    this.wrap(() => {
      this.rc.arc(x * S, y * S, w * S, h * S, start, stop, closed, this.opts(options));
    });
  }
}
