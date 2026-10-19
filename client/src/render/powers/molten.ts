// Molten Path visuals: each lava drop is a round-capped capsule back to the previous drop, so
// the trail reads as one glowing ribbon. Hot magma underneath, dark crust plates on top that
// grow as it cools (the bright gaps between them are the cracks), embers drifting up.

import type { NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow } from "../glow";
import { hash01 } from "./once";
import type { RenderCtx } from "./types";

const PLATES = 3;

function capsule(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, width: number) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx + (ax === bx && ay === by ? 0.01 : 0), by);
  ctx.stroke();
}

export function drawMolten(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const born = Math.min(1, e.age / 0.12);
  const fade = Math.max(0, Math.min(1, (e.life - e.age) / 0.6));
  const s = born * fade;
  if (s <= 0.01) return;
  const cool = Math.min(1, e.age / e.life);
  const r = e.r * (0.7 + 0.3 * born) * (0.85 + 0.15 * fade);
  const ax = e.n === 1 ? e.x2 : e.x;
  const ay = e.n === 1 ? e.y2 : e.y;
  const pulse = 0.85 + 0.15 * Math.sin(time * 6 + e.id * 0.7);

  drawGlow(ctx, e.x, e.y, r * 2.3, "#ff4a12", 0.22 * s * (1 - cool * 0.5));
  ctx.save();
  ctx.lineCap = "round";
  // Everything bright is additive, so overlapping drops melt into one even ribbon instead of
  // stacking like coins: a dim red halo, the molten body, then the white-hot vein.
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(150,20,6,${0.3 * s})`;
  capsule(ctx, ax, ay, e.x, e.y, r * 2.15);
  ctx.strokeStyle = `rgba(255,${Math.round(80 - cool * 40)},16,${(0.42 - cool * 0.2) * s})`;
  capsule(ctx, ax, ay, e.x, e.y, r * 1.6);
  ctx.strokeStyle = `rgba(255,200,110,${(0.32 - cool * 0.22) * s * pulse})`;
  capsule(ctx, ax, ay, e.x, e.y, r * 0.6);
  ctx.globalCompositeOperation = "source-over";

  // Crust plates: irregular dark polygons that spread as the lava cools.
  const plate = r * (0.32 + 0.3 * cool);
  ctx.fillStyle = `rgba(${Math.round(60 - cool * 25)},${Math.round(12 - cool * 6)},6,${(0.4 + cool * 0.4) * s})`;
  for (let k = 0; k < PLATES; k++) {
    const t = (k + 0.5) / PLATES;
    const off = (hash01(e.id, k) - 0.5) * r * 0.9;
    const dx = e.x - ax;
    const dy = e.y - ay;
    const len = Math.hypot(dx, dy) || 1;
    const cx = ax + dx * t - (dy / len) * off;
    const cy = ay + dy * t + (dx / len) * off;
    const rot = hash01(e.id, k + 7) * Math.PI * 2;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2;
      const rr = plate * (0.7 + 0.5 * hash01(e.id, k * 5 + i + 20));
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Embers, mostly from fresh lava.
  if (Math.random() < 0.12 * s * (1.2 - cool)) {
    const a = Math.random() * Math.PI * 2;
    rc.fx.particles.spawn(e.x + Math.cos(a) * r * 0.7, e.y + Math.sin(a) * r * 0.7, (Math.random() - 0.5) * 40, -50 - Math.random() * 60, 0.7, 4 + Math.random() * 3, Math.random() < 0.5 ? "#ffb347" : "#ff5a1f", PSHAPE.glow, 1.2, -30);
  }
}
