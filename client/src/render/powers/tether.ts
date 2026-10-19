// Storm Tether visuals: the bolt in flight, then a crackling chain between caster and target
// that heats from blue to white to red as it stretches toward its snap length. Routed through
// portals it is drawn as two segments, one into each portal. A snap whips both halves back.

import type { NetEffect, NetProjectile } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, mix, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { anchor, bolt, changed } from "./util";

const BLUE = "#4DA6FF";
const HOT = "#FF4A5E";

export function drawTetherBolt(rc: RenderCtx, p: NetProjectile) {
  const { ctx } = rc;
  const sp = Math.hypot(p.vx, p.vy) || 1;
  const tx = p.x - (p.vx / sp) * 70;
  const ty = p.y - (p.vy / sp) * 70;
  drawGlow(ctx, p.x, p.y, 44, BLUE, 0.95);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(BLUE, 0.7);
  ctx.lineWidth = 6;
  bolt(ctx, tx, ty, p.x, p.y, 10, 14);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  bolt(ctx, tx, ty, p.x, p.y, 6, 14);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fill();
  if (Math.random() < 0.7) rc.fx.particles.spawn(p.x, p.y, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, 0.18, 4, "#cfe6ff", PSHAPE.spark);
}

function chainSegment(rc: RenderCtx, ax: number, ay: number, bx: number, by: number, col: string, a: number, thick: number) {
  const { ctx, time } = rc;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = a;
  ctx.strokeStyle = withAlpha(col, 0.35);
  ctx.lineWidth = 12 * thick;
  bolt(ctx, ax, ay, bx, by, 9);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(col, 0.9);
  ctx.lineWidth = 3.5 * thick;
  bolt(ctx, ax, ay, bx, by, 14);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.6;
  bolt(ctx, ax, ay, bx, by, 6);
  ctx.stroke();
  // Chain links: beads marching from caster to target.
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.floor(len / 46);
  ctx.fillStyle = withAlpha("#ffffff", 0.85);
  for (let i = 1; i <= n; i++) {
    const t = ((i + time * 2.5) % (n + 1)) / (n + 1);
    ctx.beginPath();
    ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, 2.6 * thick, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawTether(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const a = anchor(rc, e.owner);
  const b = anchor(rc, e.link);
  if (!a || !b) return;
  const routed = e.n === 1;
  const segs: [number, number, number, number][] = routed ? [[a.x, a.y, e.x, e.y], [e.x2, e.y2, b.x, b.y]] : [[a.x, a.y, b.x, b.y]];
  const length = segs.reduce((s, [x0, y0, x1, y1]) => s + Math.hypot(x1 - x0, y1 - y0), 0);

  if (e.v >= 1) {
    // Snapped: both halves whip back toward their owners and fade.
    if (changed(rc, "tetherSnap", e.id, 1)) {
      rc.fx.particles.burst(b.x, b.y, 40, BLUE, 620, 0.6, 10, PSHAPE.spark);
      rc.fx.particles.burst(b.x, b.y, 18, "#ffffff", 420, 0.45, 8);
      rc.fx.ring(b.x, b.y, 10, 150, 0.4, "#ffffff", 6);
      rc.fx.ring(b.x, b.y, 10, 230, 0.55, BLUE, 4);
    }
    const k = Math.max(0, Math.min(1, 1 - (e.life - e.age) / 0.45));
    const fade = 1 - k;
    for (const [x0, y0, x1, y1] of segs) {
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      chainSegment(rc, x0, y0, x0 + (mx - x0) * (1 - k), y0 + (my - y0) * (1 - k), HOT, fade, 1);
      chainSegment(rc, x1, y1, x1 + (mx - x1) * (1 - k), y1 + (my - y1) * (1 - k), HOT, fade, 1);
    }
    return;
  }

  if (changed(rc, "tetherOn", e.id, 0, e.age)) {
    rc.fx.particles.burst(b.x, b.y, 24, BLUE, 400, 0.4, 7, PSHAPE.spark);
    rc.fx.ring(b.x, b.y, 8, 90, 0.3, BLUE, 4);
  }
  const tension = Math.min(1.2, length / Math.max(1, e.r));
  const heat = Math.max(0, (tension - 0.6) / 0.4);
  const col = heat < 0.5 ? mix(BLUE, "#ffffff", heat * 2) : mix("#ffffff", HOT, Math.min(1, (heat - 0.5) * 2));
  const flicker = heat > 0.8 ? 0.65 + 0.35 * Math.sin(time * 40) : 1;
  const fadeOut = Math.min(1, (e.life - e.age) / 0.4);
  for (const [x0, y0, x1, y1] of segs) chainSegment(rc, x0, y0, x1, y1, col, flicker * fadeOut, 1 + heat * 0.4);

  // Anchors glow at both ends; portal ends show where the chain bends through.
  drawGlow(ctx, a.x, a.y, 40, col, 0.5);
  drawGlow(ctx, b.x, b.y, 46 + heat * 30, col, 0.6 + heat * 0.3);
  if (routed) {
    drawGlow(ctx, e.x, e.y, 40, col, 0.6);
    drawGlow(ctx, e.x2, e.y2, 40, col, 0.6);
  }
  // Danger: the snap radius around the caster appears as the chain nears its limit.
  if (heat > 0.25 && !routed) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(HOT, 0.45 * heat);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 10]);
    ctx.lineDashOffset = time * 40;
    ctx.beginPath();
    ctx.arc(a.x, a.y, e.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  if (Math.random() < 0.35) {
    const [x0, y0, x1, y1] = segs[Math.floor(Math.random() * segs.length)] ?? [a.x, a.y, b.x, b.y];
    const t = Math.random();
    rc.fx.particles.spawn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.2, 4, col, PSHAPE.spark);
  }
}
