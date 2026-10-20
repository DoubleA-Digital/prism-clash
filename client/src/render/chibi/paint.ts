// Small painting kit shared by every chibi part: cel-shaded fills with a crisp ink outline,
// derived shade / highlight tones, and the projection used to place features on the head.

import { mix } from "../glow";

/** Ink outline color and width (hero units). */
export const INK = "#140c2a";
export const LINE = 1.7;

const toneCache = new Map<string, string>();
/** Cel shadow tone: pulled toward a cool violet so shadows read as neon-lit. */
export function shade(c: string, k = 0.36): string {
  const key = `s${c}${k}`;
  let v = toneCache.get(key);
  if (!v) toneCache.set(key, (v = mix(c, "#24124d", k)));
  return v;
}
export function light(c: string, k = 0.4): string {
  const key = `l${c}${k}`;
  let v = toneCache.get(key);
  if (!v) toneCache.set(key, (v = mix(c, "#ffffff", k)));
  return v;
}

export interface CelOpts {
  /** Shadow tone (defaults to shade(base)). */
  dark?: string;
  /** Offset of the lit area toward the light (top-left). Bigger = wider shadow crescent. */
  dx?: number;
  dy?: number;
  /** Outline width; 0 skips the outline. */
  line?: number;
  rule?: CanvasFillRule;
}

/**
 * Cel fill: the shape in its shadow tone, the same shape shifted toward the light in the base
 * tone (clipped), leaving a hard shadow crescent on the bottom-right. Then an ink outline.
 */
export function cel(g: CanvasRenderingContext2D, p: Path2D, base: string, o: CelOpts = {}) {
  const rule = o.rule ?? "nonzero";
  g.save();
  g.clip(p, rule);
  g.fillStyle = o.dark ?? shade(base);
  g.fill(p, rule);
  g.translate(-(o.dx ?? 1.6), -(o.dy ?? 2.2));
  g.fillStyle = base;
  g.fill(p, rule);
  g.restore();
  const lw = o.line ?? LINE;
  if (lw > 0) {
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.lineJoin = "round";
    g.stroke(p);
  }
}

/** Flat fill plus ink outline. */
export function flat(g: CanvasRenderingContext2D, p: Path2D, fill: string, line = LINE) {
  g.fillStyle = fill;
  g.fill(p);
  if (line > 0) {
    g.lineWidth = line;
    g.strokeStyle = INK;
    g.lineJoin = "round";
    g.stroke(p);
  }
}

/** A soft glossy highlight blob (top-left shine). */
export function shine(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = -0.5, a = 0.55) {
  g.save();
  g.globalAlpha *= a;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function circle(x: number, y: number, r: number): Path2D {
  const p = new Path2D();
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
}
export function ellipse(x: number, y: number, rx: number, ry: number, rot = 0): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
  return p;
}
export function rrect(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
}
export function poly(pts: readonly (readonly [number, number])[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

/**
 * The head's view. `yaw` is how far the face has turned away from the camera:
 * 0 = facing the viewer (aiming down), PI/2 = profile to the right, PI = back of the head.
 */
export interface View {
  yaw: number;
  /** cos(yaw): 1 front, 0 profile, -1 back. */
  c: number;
  /** sin(yaw): sideways amount (0..1, we only draw the right half and mirror). */
  s: number;
}
export const view = (yaw: number): View => ({ yaw, c: Math.cos(yaw), s: Math.sin(yaw) });

/**
 * Projects a point on the head sphere at local azimuth `phi` (0 = the face direction) and
 * height `h` (-1 top .. 1 bottom) to screen x / y offsets, plus its depth toward the viewer.
 * The camera looks down from the front, so front points sit lower than back points.
 */
export function onHead(v: View, phi: number, h: number, R: number): { x: number; y: number; d: number } {
  const a = phi + v.yaw;
  const ring = Math.sqrt(Math.max(0, 1 - h * h));
  const d = Math.cos(a) * ring;
  return { x: Math.sin(a) * ring * R, y: h * R * 0.92 + d * R * 0.22, d };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
