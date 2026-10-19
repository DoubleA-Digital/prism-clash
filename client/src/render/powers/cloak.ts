// Void Cloak visuals: vanishing collapses the player into a pinpoint of void (dark disc,
// inward-rushing motes, a ring snapping shut); the reveal tears the void open again with an
// outward ring, shards and a white flash. Both happen where everyone can see them.

import type { NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { changed } from "./util";

const VOID = "#8E9BFF";

export function drawVoidBurst(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  const k = Math.min(1, e.age / Math.max(0.01, e.life));
  const col = rc.color(e.owner);
  const reveal = e.n === 1;
  if (changed(rc, "voidBurst", e.id, 0, e.age)) {
    if (reveal) {
      rc.fx.particles.burst(e.x, e.y, 30, VOID, 520, 0.5, 9, PSHAPE.shard);
      rc.fx.particles.burst(e.x, e.y, 16, "#ffffff", 380, 0.35, 7, PSHAPE.spark);
      rc.fx.ring(e.x, e.y, 10, e.r * 1.6, 0.4, "#ffffff", 5);
      rc.fx.ring(e.x, e.y, 10, e.r * 2.4, 0.55, VOID, 4);
    } else {
      // Motes rushing into the point you vanished.
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = e.r * (0.9 + Math.random() * 0.6);
        rc.fx.particles.spawn(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, -Math.cos(a) * d * 2.6, -Math.sin(a) * d * 2.6, 0.38, 7, i % 3 ? VOID : col, PSHAPE.glow, 1);
      }
      rc.fx.ring(e.x, e.y, e.r * 1.4, 4, 0.4, VOID, 4);
    }
  }
  ctx.save();
  if (reveal) {
    // A tear in space opening outward.
    const r = e.r * (0.3 + k * 1.1);
    drawGlow(ctx, e.x, e.y, r * 1.6, VOID, 0.8 * (1 - k));
    drawGlow(ctx, e.x, e.y, r, "#ffffff", 0.7 * (1 - k) ** 2);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(VOID, 0.9 * (1 - k));
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + e.id;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * r * 0.5, e.y + Math.sin(a) * r * 0.5);
      ctx.lineTo(e.x + Math.cos(a + 0.12) * r * 1.15, e.y + Math.sin(a + 0.12) * r * 1.15);
      ctx.stroke();
    }
  } else {
    // Collapse: a dark disc swallowing the core, ringed in void light.
    const r = e.r * 0.55 * (1 - k) ** 1.5;
    drawGlow(ctx, e.x, e.y, e.r * (1 - k * 0.7), VOID, 0.7 * (1 - k));
    ctx.fillStyle = withAlpha("#05040d", 0.85 * (1 - k));
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(VOID, 0.95 * (1 - k));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
