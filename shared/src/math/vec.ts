// Small 2D math helpers. Hot paths use plain numbers to avoid allocations.

export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist = (ax: number, ay: number, bx: number, by: number) => len(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smallest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export const lerpAngle = (a: number, b: number, t: number) => a + angleDiff(a, b) * t;

/** Distance from point P to segment AB, plus the closest point's parameter t in [0,1]. */
export function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number; cx: number; cy: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { d: len(px - cx, py - cy), t, cx, cy };
}

/** First time t in [0,1] when a circle moving from A to B touches a circle at C (radius sum r), or -1. */
export function sweepCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a === 0) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Quantize to a fixed step for the network (positions to 1/8 unit). */
export const q8 = (v: number) => Math.round(v * 8);
export const dq8 = (v: number) => v / 8;
export const qAngle = (a: number) => Math.round((((a % TAU) + TAU) % TAU) * (65535 / TAU));
export const dqAngle = (v: number) => v * (TAU / 65535);
