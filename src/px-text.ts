// Draw text at pixel scale — game-unit font sizes (e.g. 0.3px) are below
// browser minimum and silently fail. This converts game coords to pixel coords
// using the current canvas transform.
export function pxText(
  ctx: CanvasRenderingContext2D,
  text: string, gameX: number, gameY: number,
  font: string, color: string, align: CanvasTextAlign = 'left',
) {
  ctx.save();
  const t = ctx.getTransform();
  const sx = Math.sqrt(t.a * t.a + t.b * t.b);
  const px = t.a * gameX + t.c * gameY + t.e;
  const py = t.b * gameX + t.d * gameY + t.f;
  ctx.resetTransform();
  const match = font.match(/([\d.]+)px/);
  const pxFont = match ? font.replace(match[0], `${parseFloat(match[1]) * sx}px`) : font;
  ctx.font = pxFont;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, px, py);
  ctx.restore();
}
