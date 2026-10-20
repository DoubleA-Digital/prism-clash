// Visuals for the looter-shooter effects: smoke clouds (block sight), shock mines, the
// Prism Lance beam, Energy Blade slashes, and supply drops (a marked landing zone, the crate
// falling out of the sky, then a light beacon).

import type { NetEffect } from "@prism/shared";
import { drawGlow, rainbow, withAlpha } from "./glow";
import type { RenderCtx } from "./powers/types";

export function drawSmoke(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  const grow = Math.min(1, e.age / 0.6);
  const fade = Math.min(1, (e.life - e.age) / 1.2);
  const r = e.r * grow;
  ctx.save();
  ctx.globalAlpha = 0.92 * fade;
  for (let k = 0; k < 9; k++) {
    const a = k * 0.7 + rc.time * 0.15 * (k % 2 ? 1 : -1);
    const d = r * (k ? 0.45 : 0);
    const rr = r * (k ? 0.55 : 0.75);
    const g = ctx.createRadialGradient(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 0, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, rr);
    g.addColorStop(0, "rgba(190,200,230,0.95)");
    g.addColorStop(0.6, "rgba(120,130,170,0.8)");
    g.addColorStop(1, "rgba(80,90,130,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawMine(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  const armed = e.age > 0.4;
  const blink = armed && Math.sin(rc.time * 9 + e.id) > 0.6;
  const col = rc.color(e.owner);
  ctx.save();
  ctx.strokeStyle = withAlpha("#5fd0ff", armed ? 0.25 : 0.1);
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#151830";
  ctx.beginPath();
  ctx.arc(e.x, e.y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.stroke();
  if (blink) drawGlow(ctx, e.x, e.y, 26, "#5fd0ff", 0.9);
  ctx.fillStyle = blink ? "#ffffff" : "#5fd0ff";
  ctx.beginPath();
  ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawBeam(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  const t = 1 - e.age / Math.max(0.01, e.life);
  const col = e.v >= 0.99 ? rainbow(rc.time * 2 + e.id * 0.3) : rc.color(e.owner);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.strokeStyle = withAlpha(col, 0.35 * t);
  ctx.lineWidth = e.r * 3.2;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x2, e.y2);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(col, 0.9 * t);
  ctx.lineWidth = e.r;
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${t})`;
  ctx.lineWidth = Math.max(1.5, e.r * 0.35);
  ctx.stroke();
  ctx.restore();
  drawGlow(ctx, e.x2, e.y2, 30 + e.r * 3, col, t);
}

export function drawSlash(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  const k = Math.min(1, e.age / Math.max(0.01, e.life));
  const col = rc.color(e.owner);
  const p = rc.pos?.(e.owner) ?? e;
  const half = Math.PI / 3;
  const a0 = e.angle - half + k * half * 0.4;
  const a1 = e.angle - half + k * half * 2.2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const [w, a] of [[16, 0.25], [6, 0.9]] as const) {
    ctx.strokeStyle = withAlpha(col, a * (1 - k * 0.8));
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(p.x, p.y, e.r * 0.85, a0, a1);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, e.r * 0.85, a0, a1);
  ctx.stroke();
  ctx.restore();
}

/** Falling (n = 0, v = fall time): landing ring closing in, crate dropping. Landed: a beacon. */
export function drawSupply(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  const gold = "#ffd34d";
  if (e.n === 0) {
    const k = Math.min(1, e.age / Math.max(0.1, e.v));
    ctx.save();
    ctx.strokeStyle = withAlpha(gold, 0.5 + 0.4 * Math.sin(rc.time * 8));
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -rc.time * 40;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + (1 - k) * 140, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(0,0,0,${0.2 + 0.35 * k})`;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 10, 40 * (0.4 + k * 0.6), 18 * (0.4 + k * 0.6), 0, 0, Math.PI * 2);
    ctx.fill();
    // The crate, high above and dropping.
    const h = (1 - k) * 700;
    drawCrate(ctx, e.x, e.y - h, 0.6 + 0.4 * k, rc.time);
    ctx.restore();
    return;
  }
  const fade = Math.min(1, (e.life - e.age) / 2);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createLinearGradient(e.x, e.y - 900, e.x, e.y);
  g.addColorStop(0, withAlpha(gold, 0));
  g.addColorStop(1, withAlpha(gold, 0.35 * fade));
  ctx.fillStyle = g;
  ctx.fillRect(e.x - 24, e.y - 900, 48, 900);
  ctx.restore();
  drawGlow(ctx, e.x, e.y, 120, gold, 0.5 * fade);
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, time: number) {
  const w = 70 * s;
  drawGlow(ctx, x, y, w * 1.6, "#ffd34d", 0.6);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(time * 2) * 0.08);
  ctx.fillStyle = "#3a2a10";
  ctx.fillRect(-w / 2, -w / 2, w, w);
  ctx.strokeStyle = "#ffd34d";
  ctx.lineWidth = 4 * s;
  ctx.strokeRect(-w / 2, -w / 2, w, w);
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(w / 2, 0);
  ctx.moveTo(0, -w / 2);
  ctx.lineTo(0, w / 2);
  ctx.stroke();
  ctx.restore();
}
