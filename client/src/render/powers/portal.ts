// Portal Pair visuals: swirling elliptical rings, orange and blue, linked by a faint
// dotted thread while both exist. Unpaired orange portals flicker until the second lands.

import type { NetEffect } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";

const ORANGE = "#FF8A2B";
const BLUE = "#3FA9FF";

export function drawPortal(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const col = e.n === 0 ? ORANGE : BLUE;
  const born = Math.min(1, e.age / 0.25);
  const ending = Math.min(1, Math.max(0, (e.life - e.age) / 0.6));
  const s = born * ending;
  const paired = e.link !== 0;
  const flicker = paired ? 1 : 0.55 + 0.45 * Math.sin(time * 14);
  drawGlow(ctx, e.x, e.y, e.r * 2.4 * s, col, 0.55 * flicker);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const rr = e.r * s * (1 - i * 0.18);
    ctx.strokeStyle = withAlpha(col, (0.9 - i * 0.18) * flicker);
    ctx.lineWidth = 4 - i * 0.6;
    ctx.beginPath();
    const a0 = time * (3 + i) * (e.n === 0 ? 1 : -1);
    ctx.ellipse(0, 0, rr, rr * 0.92, a0, 0.3, Math.PI * 2 - 0.3);
    ctx.stroke();
  }
  // Spiral arms
  ctx.strokeStyle = withAlpha("#ffffff", 0.5 * flicker);
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.08) {
      const a = time * 4 * (e.n === 0 ? 1 : -1) + k * 2.09 + t * 4;
      const rr = e.r * s * (1 - t) * 0.85;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Dotted thread between paired portals (drawn once per pair, from the orange side). */
export function drawPortalLinks(rc: RenderCtx, effects: readonly NetEffect[]) {
  const { ctx, time } = rc;
  for (const e of effects) {
    if (e.kind !== "portal" || e.n !== 0 || !e.link) continue;
    const b = effects.find((o) => o.id === e.link);
    if (!b) continue;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(e.x, e.y, b.x, b.y);
    g.addColorStop(0, withAlpha(ORANGE, 0.35));
    g.addColorStop(1, withAlpha(BLUE, 0.35));
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 14]);
    ctx.lineDashOffset = -time * 60;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}
