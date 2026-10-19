// Time Bubble visuals: a brass-tinted dome with a clock-tick rim, a sweeping hand and a rim
// arc that drains as time runs out (so everyone can read how long it lasts), slow ripples
// crawling inward and dust that hangs in the air. Flickers just before it collapses.

import type { NetEffect } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { changed } from "./util";

const BRASS = "#FFD166";
const TAU = Math.PI * 2;

export function drawBubble(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const born = Math.min(1, e.age / 0.25);
  const ease = 1 - (1 - born) ** 3;
  const left = e.life - e.age;
  const ending = left < 0.6 ? 0.55 + 0.45 * Math.sin(time * 30) : 1;
  const r = e.r * ease;
  const own = rc.color(e.owner);
  if (changed(rc, "bubbleOn", e.id, 0, e.age)) {
    rc.fx.ring(e.x, e.y, 20, e.r, 0.35, BRASS, 6);
    rc.fx.particles.burst(e.x, e.y, 30, BRASS, e.r * 2.2, 0.5, 8);
  }
  if (r < 2) return;
  ctx.save();
  // Dome tint, brighter toward the rim like a lens.
  const g = ctx.createRadialGradient(e.x, e.y, r * 0.2, e.x, e.y, r);
  g.addColorStop(0, withAlpha(BRASS, 0.04 * ending));
  g.addColorStop(0.8, withAlpha(BRASS, 0.1 * ending));
  g.addColorStop(1, withAlpha(BRASS, 0.24 * ending));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = "lighter";
  // Ripples crawling inward at a slowed pace.
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.18 + i / 3) % 1;
    ctx.strokeStyle = withAlpha(BRASS, 0.18 * (1 - t) * ending);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * TAU;
      const wob = 1 + Math.sin(a * 6 + time * 1.5 + i) * 0.015;
      const rr = r * (1 - t * 0.85) * wob;
      if (k) ctx.lineTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
      else ctx.moveTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  // Rim: shimmering edge, then the remaining-time arc on top.
  ctx.strokeStyle = withAlpha(BRASS, 0.55 * ending);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, TAU);
  ctx.stroke();
  const frac = Math.max(0, left / e.life);
  ctx.strokeStyle = withAlpha("#ffffff", 0.85 * ending);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r + 6, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
  ctx.stroke();
  // Owner's color as a thin inner ring: whose bubble this is.
  ctx.strokeStyle = withAlpha(own, 0.5 * ending);
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 9]);
  ctx.beginPath();
  ctx.arc(e.x, e.y, r - 10, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // Clock ticks around the rim, turning slowly.
  ctx.strokeStyle = withAlpha(BRASS, 0.9 * ending);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + time * 0.05;
    const major = i % 6 === 0;
    ctx.lineWidth = major ? 4 : 2;
    const r0 = r - (major ? 26 : 14);
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
    ctx.lineTo(e.x + Math.cos(a) * (r - 3), e.y + Math.sin(a) * (r - 3));
    ctx.stroke();
  }
  // A sweeping hand: one revolution over the bubble's life.
  const ha = -Math.PI / 2 + (e.age / e.life) * TAU;
  const hg = ctx.createLinearGradient(e.x, e.y, e.x + Math.cos(ha) * r, e.y + Math.sin(ha) * r);
  hg.addColorStop(0, withAlpha(BRASS, 0));
  hg.addColorStop(1, withAlpha(BRASS, 0.5 * ending));
  ctx.strokeStyle = hg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x + Math.cos(ha) * (r - 4), e.y + Math.sin(ha) * (r - 4));
  ctx.stroke();
  ctx.fillStyle = withAlpha(BRASS, 0.08 * ending);
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.arc(e.x, e.y, r - 4, ha - 0.5, ha);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawGlow(ctx, e.x, e.y, 26, BRASS, 0.5 * ending);
  // Dust hanging in the slowed air.
  if (Math.random() < 0.6) {
    const a = Math.random() * TAU;
    const d = Math.sqrt(Math.random()) * r * 0.95;
    rc.fx.particles.spawn(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 1.6, 4, Math.random() < 0.5 ? BRASS : "#ffffff", 0, 0.2);
  }
}
