// Natural and street props drawn live (few are ever in view, and they stay crisp at any
// zoom): faceted rocks with light from the top-left, crystals with an inner glow, concrete
// barriers and benches (or wooden bridge railings), neon chain-link fences and glass panels.

import type { Solid } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import { hash } from "./rand";

interface RockShape {
  outer: number[];
  inner: number[];
  moss: boolean;
}

const rocks = new Map<number, RockShape>();
const LX = -0.6;
const LY = -0.8;

function rockShape(s: Solid): RockShape {
  const hit = rocks.get(s.idx);
  if (hit) return hit;
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const c = Math.min(w, h) * (0.2 + 0.14 * s.variant);
  const j = (k: number) => 0.6 + hash(s.idx, k) * 0.7;
  const dent = (k: number) => hash(s.idx, k, 3) * Math.min(w, h) * 0.07;
  const cx = s.x0 + w / 2;
  const cy = s.y0 + h / 2;
  const outer = [
    s.x0 + c * j(1), s.y0,
    cx + (hash(s.idx, 9) - 0.5) * w * 0.3, s.y0 + dent(1),
    s.x1 - c * j(2), s.y0,
    s.x1, s.y0 + c * j(3),
    s.x1 - dent(2), cy + (hash(s.idx, 10) - 0.5) * h * 0.3,
    s.x1, s.y1 - c * j(4),
    s.x1 - c * j(5), s.y1,
    cx + (hash(s.idx, 11) - 0.5) * w * 0.3, s.y1 - dent(3),
    s.x0 + c * j(6), s.y1,
    s.x0, s.y1 - c * j(7),
    s.x0 + dent(4), cy + (hash(s.idx, 12) - 0.5) * h * 0.3,
    s.x0, s.y0 + c * j(8),
  ];
  const fx = cx - w * 0.07;
  const fy = cy - h * 0.1;
  const k = 0.5 + hash(s.idx, 13) * 0.12;
  const inner: number[] = [];
  for (let i = 0; i < outer.length; i += 2) inner.push(fx + ((outer[i] ?? 0) - cx) * k, fy + ((outer[i + 1] ?? 0) - cy) * k);
  const shape = { outer, inner, moss: hash(s.idx, 14) < 0.45 };
  rocks.set(s.idx, shape);
  return shape;
}

const poly = (ctx: CanvasRenderingContext2D, p: readonly number[], dx = 0, dy = 0) => {
  ctx.beginPath();
  for (let i = 0; i < p.length; i += 2) {
    if (i) ctx.lineTo((p[i] ?? 0) + dx, (p[i + 1] ?? 0) + dy);
    else ctx.moveTo((p[i] ?? 0) + dx, (p[i + 1] ?? 0) + dy);
  }
  ctx.closePath();
};

export function drawRock(ctx: CanvasRenderingContext2D, s: Solid, edge: string) {
  const { outer, inner, moss } = rockShape(s);
  ctx.fillStyle = "rgba(0,0,10,0.4)";
  poly(ctx, outer, 7, 11);
  ctx.fill();
  ctx.fillStyle = "#1c2140";
  poly(ctx, outer);
  ctx.fill();
  // Side facets, lit by how much they face the light.
  const n = outer.length / 2;
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    const ex = (outer[b] ?? 0) - (outer[a] ?? 0);
    const ey = (outer[b + 1] ?? 0) - (outer[a + 1] ?? 0);
    const len = Math.hypot(ex, ey) || 1;
    const lit = ((ey / len) * LX - (ex / len) * LY + 1) / 2;
    const l = Math.round(26 + lit * 40);
    ctx.fillStyle = `rgb(${l},${l + 6},${l + 34})`;
    ctx.beginPath();
    ctx.moveTo(outer[a] ?? 0, outer[a + 1] ?? 0);
    ctx.lineTo(outer[b] ?? 0, outer[b + 1] ?? 0);
    ctx.lineTo(inner[b] ?? 0, inner[b + 1] ?? 0);
    ctx.lineTo(inner[a] ?? 0, inner[a + 1] ?? 0);
    ctx.closePath();
    ctx.fill();
  }
  // Top facet.
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const g = ctx.createLinearGradient(s.x0, s.y0, s.x0 + w * 0.6, s.y0 + h * 0.8);
  g.addColorStop(0, "#5a6498");
  g.addColorStop(1, "#353c6c");
  ctx.fillStyle = g;
  poly(ctx, inner);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,12,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < outer.length; i += 4) {
    ctx.moveTo(outer[i] ?? 0, outer[i + 1] ?? 0);
    ctx.lineTo(inner[i] ?? 0, inner[i + 1] ?? 0);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(220,235,255,0.22)";
  poly(ctx, inner);
  ctx.stroke();
  if (moss) {
    ctx.fillStyle = "rgba(50,170,120,0.35)";
    const mx = (inner[0] ?? 0) + w * 0.08;
    const my = (inner[1] ?? 0) + h * 0.06;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(mx + k * w * 0.06, my + Math.sin(k * 2) * h * 0.04, w * 0.07, h * 0.045, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = withAlpha(edge, 0.32);
  ctx.lineWidth = 2;
  poly(ctx, outer);
  ctx.stroke();
}

const CRYSTAL_COLORS = ["#8fe7ff", "#b98cff", "#ff8ad8", "#7dffcf"];

export function drawCrystal(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const cx = s.x0 + w / 2;
  const cy = s.y0 + h / 2;
  const col = CRYSTAL_COLORS[Math.floor(s.variant * CRYSTAL_COLORS.length)] ?? "#8fe7ff";
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.4 + s.variant * 20);
  drawGlow(ctx, cx, cy + h * 0.1, Math.max(w, h) * 1.6, col, 0.22 + 0.08 * pulse, 0.05);
  ctx.fillStyle = "rgba(0,0,12,0.4)";
  ctx.beginPath();
  ctx.ellipse(cx + 8, s.y1 + 2, w * 0.55, h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rocky base filling the footprint, with small satellite shards.
  ctx.fillStyle = "#1b1a46";
  ctx.beginPath();
  ctx.roundRect(s.x0, s.y0 + h * 0.08, w, h * 0.92, Math.min(w, h) * 0.3);
  ctx.fill();
  ctx.fillStyle = "#2a2a66";
  ctx.beginPath();
  ctx.roundRect(s.x0 + 3, s.y0 + h * 0.08 + 3, w - 6, h * 0.5, Math.min(w, h) * 0.25);
  ctx.fill();
  for (const [fx, sz] of [[0.14, 0.22], [0.86, 0.18]] as const) {
    const bx = s.x0 + w * fx;
    const by = s.y1 - h * 0.12;
    const r = Math.min(w, h) * sz;
    ctx.fillStyle = withAlpha(col, 0.75);
    ctx.beginPath();
    ctx.moveTo(bx, by - r * 1.6);
    ctx.lineTo(bx + r * 0.7, by - r * 0.2);
    ctx.lineTo(bx, by + r * 0.4);
    ctx.lineTo(bx - r * 0.7, by - r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(235,252,255,0.7)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  const top = [cx + w * (hash(s.idx, 1) - 0.5) * 0.2, s.y0 - h * 0.18];
  const pts = [top[0] ?? cx, top[1] ?? s.y0, s.x1 + w * 0.04, s.y0 + h * 0.28, s.x1 - w * 0.04, s.y1 - h * 0.12, cx, s.y1 + h * 0.06, s.x0 + w * 0.04, s.y1 - h * 0.12, s.x0 - w * 0.04, s.y0 + h * 0.28];
  const rx = (top[0] ?? cx) + w * 0.06;
  // Left face (lit), right face (shadow), split by the ridge.
  ctx.fillStyle = withAlpha(col, 0.95);
  ctx.beginPath();
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  ctx.lineTo(rx, cy + h * 0.1);
  ctx.lineTo(pts[6] ?? 0, pts[7] ?? 0);
  ctx.lineTo(pts[8] ?? 0, pts[9] ?? 0);
  ctx.lineTo(pts[10] ?? 0, pts[11] ?? 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#24206a";
  ctx.beginPath();
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  ctx.lineTo(pts[2] ?? 0, pts[3] ?? 0);
  ctx.lineTo(pts[4] ?? 0, pts[5] ?? 0);
  ctx.lineTo(pts[6] ?? 0, pts[7] ?? 0);
  ctx.lineTo(rx, cy + h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(col, 0.35);
  ctx.fill();
  // Darker lower-left facet for depth.
  ctx.fillStyle = "rgba(20,20,80,0.45)";
  ctx.beginPath();
  ctx.moveTo(pts[8] ?? 0, pts[9] ?? 0);
  ctx.lineTo(pts[6] ?? 0, pts[7] ?? 0);
  ctx.lineTo(rx, cy + h * 0.1);
  ctx.lineTo(cx - w * 0.15, cy + h * 0.2);
  ctx.closePath();
  ctx.fill();
  // Inner glow core and edges.
  drawGlow(ctx, rx - w * 0.08, cy, Math.max(w, h) * 0.55, "#ffffff", 0.25 + 0.25 * pulse, 0.1);
  ctx.strokeStyle = "rgba(235,252,255,0.9)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i) ctx.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
    else ctx.moveTo(pts[i] ?? 0, pts[i + 1] ?? 0);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.beginPath();
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  ctx.lineTo(rx, cy + h * 0.1);
  ctx.lineTo(pts[6] ?? 0, pts[7] ?? 0);
  ctx.stroke();
  if (pulse > 0.85) {
    const sx = s.x0 + w * (0.25 + 0.3 * hash(s.idx, Math.floor(time)));
    const sy = s.y0 + h * 0.3;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(sx - 5, sy - 0.8, 10, 1.6);
    ctx.fillRect(sx - 0.8, sy - 5, 1.6, 10);
  }
}

/** Concrete barrier / bench (city), or a wooden railing (bridges). */
export function drawCover(ctx: CanvasRenderingContext2D, s: Solid, rail: boolean) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const horiz = w >= h;
  if (rail) {
    ctx.fillStyle = "rgba(0,0,10,0.35)";
    ctx.fillRect(s.x0 + 3, s.y0 + 6, w, h);
    ctx.fillStyle = "#6b4630";
    ctx.fillRect(s.x0, s.y0 + (horiz ? h * 0.25 : 0), horiz ? w : w, horiz ? h * 0.5 : h);
    ctx.fillStyle = "rgba(255,220,170,0.18)";
    if (horiz) ctx.fillRect(s.x0, s.y0 + h * 0.25, w, 2);
    else ctx.fillRect(s.x0, s.y0, 2, h);
    ctx.fillStyle = "#3e2618";
    const len = horiz ? w : h;
    for (let t = 0; t <= len; t += 44) {
      const px = horiz ? s.x0 + Math.min(t, w - 14) : s.x0 - 1;
      const py = horiz ? s.y0 - 1 : s.y0 + Math.min(t, h - 14);
      ctx.fillRect(px, py, horiz ? 14 : w + 2, horiz ? h + 2 : 14);
      ctx.fillStyle = "rgba(255,200,150,0.15)";
      ctx.fillRect(px + 2, py + 2, horiz ? 10 : w - 2, 2);
      ctx.fillStyle = "#3e2618";
    }
    return;
  }
  ctx.fillStyle = "rgba(0,0,10,0.4)";
  ctx.beginPath();
  ctx.roundRect(s.x0 + 4, s.y0 + 8, w, h, 7);
  ctx.fill();
  ctx.fillStyle = "#14163a";
  ctx.beginPath();
  ctx.roundRect(s.x0, s.y0 + 5, w, h, 7);
  ctx.fill();
  const g = ctx.createLinearGradient(s.x0, s.y0, s.x0, s.y1);
  g.addColorStop(0, "#3a3f7c");
  g.addColorStop(1, "#262a5a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(s.x0, s.y0, w, h, 7);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(s.x0 + 5, s.y0 + 2, w - 10, 2);
  // Neon accent stripe and reflectors.
  ctx.fillStyle = "rgba(169,112,255,0.85)";
  if (horiz) ctx.fillRect(s.x0 + 8, s.y0 + h / 2 - 1.5, w - 16, 3);
  else ctx.fillRect(s.x0 + w / 2 - 1.5, s.y0 + 8, 3, h - 16);
  ctx.fillStyle = "#ffd34d";
  const len = horiz ? w : h;
  for (let t = 18; t < len - 10; t += 60) {
    if (horiz) ctx.fillRect(s.x0 + t, s.y0 + 3, 6, 3);
    else ctx.fillRect(s.x0 + 3, s.y0 + t, 3, 6);
  }
  ctx.strokeStyle = "rgba(169,112,255,0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(s.x0, s.y0, w, h, 7);
  ctx.stroke();
}

export function drawFence(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const horiz = w >= h;
  const dmg = s.maxHp > 0 ? 1 - s.hp / s.maxHp : 0;
  const cx = s.x0 + w / 2;
  const cy = s.y0 + h / 2;
  // Mesh band (chain-link) with a soft shadow.
  ctx.fillStyle = "rgba(0,0,10,0.3)";
  if (horiz) ctx.fillRect(s.x0, cy + 2, w, 8);
  else ctx.fillRect(cx + 2, s.y0, 8, h);
  ctx.save();
  ctx.beginPath();
  if (horiz) ctx.rect(s.x0, cy - 5, w, 10);
  else ctx.rect(cx - 5, s.y0, 10, h);
  ctx.clip();
  ctx.fillStyle = "rgba(20,22,60,0.55)";
  ctx.fillRect(s.x0, s.y0, w, h);
  ctx.strokeStyle = `rgba(170,180,255,${0.32 - dmg * 0.15})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const len = horiz ? w : h;
  for (let t = -12; t < len + 12; t += 7) {
    if (horiz) {
      ctx.moveTo(s.x0 + t, cy - 6);
      ctx.lineTo(s.x0 + t + 12, cy + 6);
      ctx.moveTo(s.x0 + t + 12, cy - 6);
      ctx.lineTo(s.x0 + t, cy + 6);
    } else {
      ctx.moveTo(cx - 6, s.y0 + t);
      ctx.lineTo(cx + 6, s.y0 + t + 12);
      ctx.moveTo(cx + 6, s.y0 + t);
      ctx.lineTo(cx - 6, s.y0 + t + 12);
    }
  }
  ctx.stroke();
  ctx.restore();
  // Neon top wire.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const a = 0.5 + 0.25 * Math.sin(time * 5 + s.variant * 7) - dmg * 0.3;
  ctx.strokeStyle = `rgba(255,46,136,${a * 0.35})`;
  ctx.lineWidth = 7;
  ctx.beginPath();
  if (horiz) {
    ctx.moveTo(s.x0, cy - 4);
    ctx.lineTo(s.x1, cy - 4);
  } else {
    ctx.moveTo(cx - 4, s.y0);
    ctx.lineTo(cx - 4, s.y1);
  }
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,120,190,${a})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  // Posts.
  for (let t = 0; t <= len; t += 48) {
    const px = horiz ? s.x0 + Math.min(t, w) : cx;
    const py = horiz ? cy : s.y0 + Math.min(t, h);
    ctx.fillStyle = "#2c3068";
    ctx.fillRect(px - 5, py - 5, 10, 10);
    ctx.fillStyle = "#5a60a8";
    ctx.fillRect(px - 3, py - 3, 6, 3);
  }
}

export function drawGlass(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const horiz = w >= h;
  const dmg = s.maxHp > 0 ? 1 - s.hp / s.maxHp : 0;
  const g = horiz ? ctx.createLinearGradient(s.x0, 0, s.x1, 0) : ctx.createLinearGradient(0, s.y0, 0, s.y1);
  g.addColorStop(0, "rgba(120,220,255,0.32)");
  g.addColorStop(0.5, "rgba(170,240,255,0.18)");
  g.addColorStop(1, "rgba(120,220,255,0.32)");
  ctx.fillStyle = g;
  ctx.fillRect(s.x0, s.y0, w, h);
  // Moving reflection streaks.
  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x0, s.y0, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  const len = horiz ? w : h;
  const off = ((time * 18 + s.variant * 200) % (len + 60)) - 30;
  ctx.fillStyle = `rgba(230,250,255,${0.5 - dmg * 0.3})`;
  if (horiz) {
    ctx.fillRect(s.x0 + off, s.y0, 8, h);
    ctx.fillRect(s.x0 + off + 14, s.y0, 3, h);
  } else {
    ctx.fillRect(s.x0, s.y0 + off, w, 8);
    ctx.fillRect(s.x0, s.y0 + off + 14, w, 3);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(210,250,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(s.x0 + 0.75, s.y0 + 0.75, w - 1.5, h - 1.5);
  ctx.fillStyle = "#2e3270";
  if (horiz) {
    ctx.fillRect(s.x0 - 3, s.y0 - 2, 7, h + 4);
    ctx.fillRect(s.x1 - 4, s.y0 - 2, 7, h + 4);
  } else {
    ctx.fillRect(s.x0 - 2, s.y0 - 3, w + 4, 7);
    ctx.fillRect(s.x0 - 2, s.y1 - 4, w + 4, 7);
  }
}
