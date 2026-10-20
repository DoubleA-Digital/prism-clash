// Signature hair pieces and face gear: ponytail, brawler spikes, afro cloud, mohawk crest,
// bandana mask, glowing hood eyes, neon shades and the sniper's scope eyepiece.

import type { HeroDef } from "@prism/shared";
import { HR, eyeSpots, faceWindow } from "./geom";
import { ringPts, strokeBand, type Pt } from "./hairKit";
import { INK, LINE, cel, circle, ellipse, light, onHead, poly, shade, type View } from "./paint";

export function ponytail(g: CanvasRenderingContext2D, def: HeroDef, v: View, front: boolean) {
  const a = onHead(v, Math.PI, -0.55, HR);
  if (front !== a.d >= -0.05) return;
  const fx = -v.s * 7 - Math.max(0, v.c) * 10;
  const tip: Pt = [a.x + fx, a.y + 22 - Math.max(0, v.c) * 5];
  const mid: Pt = [a.x + fx * 0.55, a.y + 6];
  const nx = -(tip[1] - a.y);
  const ny = tip[0] - a.x;
  const nl = Math.hypot(nx, ny) || 1;
  const ox = (nx / nl) * 4.4;
  const oy = (ny / nl) * 4.4;
  const p = new Path2D();
  p.moveTo(a.x + ox * 0.6, a.y + oy * 0.6);
  p.quadraticCurveTo(mid[0] + ox * 1.4, mid[1] + oy * 1.4, tip[0], tip[1]);
  p.quadraticCurveTo(mid[0] - ox * 1.2, mid[1] - oy * 1.2, a.x - ox * 0.6, a.y - oy * 0.6);
  p.closePath();
  cel(g, p, def.palette.hair, { dx: 1, dy: 1.4 });
  g.strokeStyle = light(def.palette.hair, 0.3);
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(a.x, a.y + 1);
  g.quadraticCurveTo(mid[0] + ox * 0.3, mid[1] + oy * 0.3, tip[0] - ox * 0.15, tip[1] - 2.5);
  g.stroke();
  cel(g, ellipse(a.x, a.y, 3, 2.2), def.palette.gear, { dx: 0.4, dy: 0.6, line: 1.2 });
}

export function spikes(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const sweep = -v.s * 4.5;
  const list: [number, number, number][] = [[-172, 9, 6], [-148, 12, 7], [-122, 13, 7.5], [-96, 14, 7.5], [-70, 13, 7.5], [-44, 11, 7], [-18, 8, 6]];
  for (const [deg, len, w] of list) {
    const a = (deg * Math.PI) / 180;
    const bx = Math.cos(a) * HR * 0.78;
    const by = Math.sin(a) * HR * 0.78 - 1;
    const tx = Math.cos(a) * (HR * 0.78 + len) + sweep * (0.5 + Math.abs(Math.cos(a)) * 0.2);
    const ty = Math.sin(a) * (HR * 0.78 + len) - 1;
    const px = -Math.sin(a) * w * 0.5;
    const py = Math.cos(a) * w * 0.5;
    cel(g, poly([[bx - px, by - py], [tx, ty], [bx + px, by + py]]), def.palette.hair, { dx: 1.2, dy: 1.6 });
  }
}

export function afroCloud(g: CanvasRenderingContext2D, def: HeroDef) {
  const p = new Path2D();
  const R = HR * 1.24;
  p.addPath(ellipse(0, -4, R, R * 0.96));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    p.addPath(circle(Math.cos(a) * R * 0.96, -4 + Math.sin(a) * R * 0.93, 5.2));
  }
  g.strokeStyle = INK;
  g.lineWidth = LINE * 2;
  g.stroke(p);
  cel(g, p, def.palette.hair, { line: 0, dx: 2.6, dy: 3 });
  g.strokeStyle = light(def.palette.hair, 0.25);
  g.lineWidth = 1.4;
  for (const [x, y, r, a0, a1] of [[-8, -14, 5, 3.3, 4.6], [3, -18, 4, 3.4, 4.6], [-14, -4, 4, 2.8, 4]] as const) {
    g.beginPath();
    g.arc(x, y, r, a0, a1);
    g.stroke();
  }
}

/** Glowing hood eyes, drawn over the hood's shadow. */
export function glowEyes(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  g.save();
  g.shadowColor = def.palette.accent;
  g.shadowBlur = 6;
  for (const e of eyeSpots(v)) {
    const w = 4.6 * e.k;
    g.fillStyle = def.palette.accent;
    g.beginPath();
    g.roundRect(e.x - w * 0.55, e.y - 1.4, w * 1.1, 3.6, 1.6);
    g.fill();
    g.fillStyle = "#eafff6";
    g.beginPath();
    g.roundRect(e.x - w * 0.28, e.y - 0.6, w * 0.56, 1.5, 0.7);
    g.fill();
  }
  g.restore();
}

export function shades(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const spots = eyeSpots(v);
  if (!spots.length) return;
  g.lineJoin = "round";
  if (spots.length === 2) {
    const [l, r] = spots as [(typeof spots)[0], (typeof spots)[0]];
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(l.x, l.y - 0.8);
    g.lineTo(r.x, r.y - 0.8);
    g.stroke();
  }
  for (const e of spots) {
    const w = 6.4 * e.k;
    const p = new Path2D();
    p.roundRect(e.x - w / 2, e.y - 2.9, w, 5.4, [1.4, 1.4, 2.6, 2.6]);
    const grad = g.createLinearGradient(0, e.y - 3, 0, e.y + 3);
    grad.addColorStop(0, def.palette.accent);
    grad.addColorStop(1, shade(def.palette.accent, 0.75));
    g.save();
    g.shadowColor = def.palette.accent;
    g.shadowBlur = 4;
    g.fillStyle = grad;
    g.fill(p);
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.stroke(p);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillRect(e.x - w * 0.32, e.y - 2, w * 0.22, 1.2);
  }
}

export function scope(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const e = eyeSpots(v).find((s) => s.side === 1);
  strokeBand(g, ringPts(0.12).filter((_, i) => i % 1 === 0), "#2a2f3a", 1.1);
  if (!e) return;
  const r = 3.9;
  g.save();
  g.shadowColor = def.palette.accent;
  g.shadowBlur = 5;
  g.fillStyle = "#2a2f3a";
  g.beginPath();
  g.ellipse(e.x, e.y, r * e.k + 1.4, r + 1.4, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = 1.3;
  g.stroke();
  g.fillStyle = def.palette.accent;
  g.beginPath();
  g.ellipse(e.x, e.y, r * e.k, r, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(def.palette.accent, 0.6);
  g.beginPath();
  g.ellipse(e.x, e.y + 0.6, r * e.k * 0.55, r * 0.55, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(e.x - r * 0.35 * e.k, e.y - r * 0.4, 1.1 * e.k, 0.9, 0, 0, Math.PI * 2);
  g.fill();
}


/** Mohawk crest: a fin of spikes along the top of the head, front to back. */
export function mohawk(g: CanvasRenderingContext2D, def: HeroDef, v: View, front: boolean) {
  const fx = Math.sin(v.yaw);
  const fd = Math.cos(v.yaw);
  const R = HR * 0.96;
  const n = 6;
  const items: { t: number; depth: number; i: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = 0.55 + (i / (n - 1)) * (Math.PI - 0.85);
    items.push({ t, depth: Math.cos(t) * fd + Math.sin(t) * 0.5, i });
  }
  items.sort((p, q) => p.depth - q.depth);
  for (const it of items) {
    if (front !== it.depth >= 0.2) continue;
    const { t } = it;
    const bx = Math.cos(t) * fx * R;
    const by = -Math.sin(t) * R * 0.92 + Math.cos(t) * fd * R * 0.22;
    let dx = bx / R;
    let dy = by / R - 0.7;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    let tx = -Math.sin(t) * fx;
    let ty = -Math.cos(t) * 0.92 - Math.sin(t) * fd * 0.22;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const len = 7 + 5 * Math.sin((Math.PI * it.i) / (n - 1));
    const pts: Pt[] = [
      [bx - tx * 3.6, by - ty * 3.6],
      [bx - dy * 2, by + dx * 2],
      [bx + dx * len, by + dy * len],
      [bx + dy * 2, by - dx * 2],
      [bx + tx * 3.6, by + ty * 3.6],
    ];
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    pts.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
    cel(g, poly(pts), def.palette.hair, { dx: 0.8, dy: 1.2, line: 1.3 });
  }
}

/** Outlaw bandana tied over the nose and mouth, with a little paisley print. */
export function mask(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const win = faceWindow(v, 1.35);
  if (!win) return;
  const col = def.palette.gear;
  const skull = ellipse(0, 0, HR * 1.04, HR * 0.99);
  const top = ringPts(0.34, HR * 1.03);
  const p = new Path2D();
  top.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.lineTo(HR * 1.3, HR * 1.4);
  p.lineTo(-HR * 1.3, HR * 1.4);
  p.closePath();
  const cx = v.s * HR * 0.5;
  g.save();
  g.clip(skull);
  g.clip(win);
  cel(g, p, col, { line: 0, dx: 1.6, dy: 1.6 });
  g.fillStyle = "rgba(255,255,255,0.85)";
  for (const [x, y] of [[-6, 10.5], [-1, 12.6], [4, 10.2], [8.5, 12.4], [-9.5, 13.2], [1.5, 9.3]] as const) {
    g.beginPath();
    g.arc(cx + x * Math.max(0.4, v.c), y, 0.8, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  const edge = new Path2D();
  top.forEach(([x, y], i) => (i ? edge.lineTo(x, y) : edge.moveTo(x, y)));
  g.stroke(edge);
  g.restore();
  if (v.c > -0.2) {
    const k = Math.max(0.35, v.c);
    cel(g, poly([[cx - 5.5 * k, HR * 0.86], [cx + 5.5 * k, HR * 0.86], [cx + 0.6 * k, HR * 0.86 + 6]]), col, { dx: 0.4, dy: 0.8, line: 1.3 });
  }
}
