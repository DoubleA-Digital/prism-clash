// Ricochet Prism visuals: four prism shards orbit the player, each cycling through the
// spectrum and joined by faint refracted beams, so everyone knows their shots will bounce.
// The shards blink in the last second.

import type { NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, rainbow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { anchor, changed, ownerAlpha } from "./util";

const SHARDS = 4;

export function drawPrismAura(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const at = anchor(rc, e.owner) ?? e;
  const alpha = ownerAlpha(rc, e.owner);
  if (changed(rc, "prismOn", e.id, 0, e.age)) {
    for (let i = 0; i < 6; i++) rc.fx.particles.burst(at.x, at.y, 5, rainbow(i / 6), 340, 0.5, 7, PSHAPE.shard);
    rc.fx.ring(at.x, at.y, 20, 90, 0.35, "#ffffff", 4);
  }
  const left = e.life - e.age;
  const blink = left < 1 ? 0.5 + 0.5 * Math.sin(time * 26) : 1;
  const grow = Math.min(1, e.age / 0.2);
  const a = alpha * blink;
  if (a <= 0.02) return;
  const R = 54 * grow;
  const pts: [number, number, string][] = [];
  for (let i = 0; i < SHARDS; i++) {
    const ang = time * 2.6 + (i / SHARDS) * Math.PI * 2;
    pts.push([at.x + Math.cos(ang) * R, at.y + Math.sin(ang) * R, rainbow(time * 0.6 + i / SHARDS)]);
  }
  ctx.save();
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = "lighter";
  // Refracted beams between neighbors.
  ctx.lineWidth = 2.5;
  for (let i = 0; i < SHARDS; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % SHARDS];
    if (!p || !q) continue;
    ctx.strokeStyle = withAlpha(p[2], 0.5);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
  }
  for (const [x, y, col] of pts) {
    drawGlow(ctx, x, y, 28, col, 0.85);
    const rot = time * 5 + x * 0.01;
    ctx.fillStyle = withAlpha(col, 0.55);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const t = rot + (k / 3) * Math.PI * 2;
      const px = x + Math.cos(t) * 13;
      const py = y + Math.sin(t) * 13;
      if (k) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  if (Math.random() < 0.25 * a) {
    const p = pts[Math.floor(Math.random() * SHARDS)];
    if (p) rc.fx.particles.spawn(p[0], p[1], (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 0.4, 5, p[2], PSHAPE.spark);
  }
}
