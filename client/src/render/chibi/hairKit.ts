// Geometry helpers for hair and headgear: bands around the head, lines over the top, hat domes,
// the hair cap with its face opening, bangs and knotted cloth tails.

import { HR, faceWindow, windowGeom } from "./geom";
import { INK, LINE, cel, circle, ellipse, light, onHead, poly, type View } from "./paint";

export type Pt = [number, number];

/** A band running around the head at height h (-1 top .. 1 bottom), front half only. */
export function ringPts(h: number, R = HR): Pt[] {
  const ring = Math.sqrt(1 - h * h);
  const out: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 16;
    out.push([Math.sin(a) * ring * R, h * R * 0.92 + Math.cos(a) * ring * R * 0.22]);
  }
  return out;
}

/** A line over the top of the head along azimuth `phi` (0 = front-to-back), visible part only. */
export function meridianPts(v: View, phi: number, t0: number, t1: number, R = HR): Pt[] {
  const a = phi + v.yaw;
  const fx = Math.sin(a);
  const fd = Math.cos(a);
  const out: Pt[] = [];
  for (let i = 0; i <= 18; i++) {
    const t = t0 + ((t1 - t0) * i) / 18;
    const depth = Math.cos(t) * fd + Math.sin(t) * 0.5;
    if (depth < -0.08) continue;
    out.push([Math.cos(t) * fx * R, -Math.sin(t) * R * 0.92 + Math.cos(t) * fd * R * 0.22]);
  }
  return out;
}

export function strokeBand(g: CanvasRenderingContext2D, pts: Pt[], color: string, w: number) {
  if (pts.length < 2) return;
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = INK;
  g.lineWidth = w + LINE * 1.6;
  g.stroke(p);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke(p);
  g.strokeStyle = light(color, 0.35);
  g.lineWidth = w * 0.3;
  g.globalAlpha *= 0.8;
  g.save();
  g.translate(-0.4, -w * 0.22);
  g.stroke(p);
  g.restore();
  g.globalAlpha /= 0.8;
}

/** The region of the head above the band at height h (for hats). */
export function domePath(h: number, R: number): Path2D {
  const pts = ringPts(h, R);
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  const last = pts[pts.length - 1]!;
  const angR = Math.atan2(last[1], last[0]);
  p.arc(0, 0, R, angR, Math.PI - angR, true);
  p.closePath();
  return p;
}

/** Hair covering the head with a hole for the face, plus the anime shine band. */
export function capWithWindow(g: CanvasRenderingContext2D, color: string, v: View, grow = 1) {
  const cap = ellipse(0, -0.8, HR * 1.06, HR * 1.02);
  const win = faceWindow(v, grow);
  const p = new Path2D(cap);
  if (win) p.addPath(win);
  g.save();
  g.clip(cap);
  cel(g, p, color, { rule: "evenodd", line: 0, dx: 2.4, dy: 2.8 });
  g.strokeStyle = light(color, 0.45);
  g.globalAlpha = 0.75;
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(-1.5, -2, HR * 0.72, -2.55, -1.75);
  g.stroke();
  g.globalAlpha = 1;
  if (win) {
    g.strokeStyle = INK;
    g.lineWidth = 1.3;
    g.stroke(win);
  }
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = LINE;
  g.stroke(cap);
}

/** Pointed bangs hanging from the top of the face opening. */
export function bangs(g: CanvasRenderingContext2D, color: string, v: View, spots: number[], len: number, lean: number, w = 3.2) {
  const wg = windowGeom(v);
  if (v.c < -0.3 || !wg) return;
  const vis = Math.min(1, (v.c + 0.3) * 1.6);
  const wx = wg.x;
  const rx = wg.rx;
  const top = wg.y - wg.ry + 0.6;
  for (const k of spots) {
    const x = wx + k * rx;
    if (Math.hypot(x, top) > HR * 0.98) continue;
    const p = poly([[x - w, top - 2], [x + w, top - 2], [x + lean, top + len * vis]]);
    cel(g, p, color, { dx: 0.5, dy: 1, line: 1.2 });
  }
}

/** Two cloth tails flaring from a knot at the back of the head. */
export function knotTails(g: CanvasRenderingContext2D, color: string, v: View, front: boolean, h = -0.15) {
  const k = onHead(v, Math.PI, h, HR);
  if (front !== k.d >= 0) return;
  const dir = k.x >= 0 ? 1 : -1;
  for (const [ang, len] of [[0.5, 9], [1.2, 8]] as const) {
    const a = Math.PI / 2 - dir * ang;
    const tx = k.x + Math.cos(a) * len + (front ? 0 : dir * 6);
    const ty = k.y + Math.sin(a) * len;
    cel(g, poly([[k.x - 1.6, k.y - 1], [k.x + 1.6, k.y + 1], [tx + 1.8, ty], [tx - 1.2, ty + 1.6]]), color, { dx: 0.4, dy: 0.6, line: 1.2 });
  }
  if (front) cel(g, circle(k.x, k.y, 2.4), color, { dx: 0.4, dy: 0.6, line: 1.2 });
}

