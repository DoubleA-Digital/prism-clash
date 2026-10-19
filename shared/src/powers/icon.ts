// Drawing helpers for power and ultimate icons. Icons are simple bold glyphs in the
// power's signature color; the client caches each one to an offscreen canvas.

export type Ctx = CanvasRenderingContext2D;

export function glow(ctx: Ctx, color: string, blur: number, width: number) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill = false) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}

export function poly(ctx: Ctx, pts: readonly [number, number][], close = true, fill = false) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
  if (fill) ctx.fill();
  else ctx.stroke();
}

export function arc(ctx: Ctx, x: number, y: number, r: number, a0: number, a1: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
}

/** Regular polygon points. */
export function ngon(n: number, r: number, rot = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}
