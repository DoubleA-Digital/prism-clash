// Singularity visuals: the thrown orb, then a black hole with a spinning accretion
// disk, lensing rings that contract inward, and a pre-detonation flash.

import type { NetEffect, NetProjectile } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";

const VIOLET = "#9B5CFF";

export function drawSingularityOrb(rc: RenderCtx, p: NetProjectile) {
  const { ctx, time } = rc;
  drawGlow(ctx, p.x, p.y, 46, VIOLET, 0.9);
  ctx.fillStyle = "#05010c";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#E7D6FF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 13 + Math.sin(time * 20) * 1.5, 0, Math.PI * 2);
  ctx.stroke();
  if (Math.random() < 0.6) rc.fx.particles.spawn(p.x, p.y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 0.4, 7, VIOLET);
}

export function drawSingularity(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const born = Math.min(1, e.age / 0.2);
  const left = e.life - e.age;
  const warn = left < 0.45 ? 1 - left / 0.45 : 0;
  // Pull field
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const t = ((time * 0.9 + i / 4) % 1);
    const rr = e.r * (1 - t) * born;
    ctx.strokeStyle = withAlpha(VIOLET, 0.28 * t);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Accretion disk
  ctx.translate(e.x, e.y);
  ctx.rotate(time * 2.2);
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = withAlpha(k === 1 ? "#ff7bf2" : VIOLET, 0.75);
    ctx.lineWidth = 5 - k;
    ctx.beginPath();
    ctx.ellipse(0, 0, (60 + k * 16) * born, (28 + k * 8) * born, k * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  drawGlow(ctx, e.x, e.y, 120 * born, VIOLET, 0.6 + warn * 0.4);
  ctx.fillStyle = "#020006";
  ctx.beginPath();
  ctx.arc(e.x, e.y, 30 * born * (1 - warn * 0.4), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha("#ffffff", 0.8);
  ctx.lineWidth = 2;
  ctx.stroke();
  if (warn > 0) drawGlow(ctx, e.x, e.y, 170 * warn, "#ffffff", warn * 0.7);
  // Debris spiralling in
  if (Math.random() < 0.8) {
    const a = Math.random() * Math.PI * 2;
    const d = e.r * (0.6 + Math.random() * 0.4);
    rc.fx.particles.spawn(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, -Math.cos(a) * 260 - Math.sin(a) * 160, -Math.sin(a) * 260 + Math.cos(a) * 160, 0.7, 6, Math.random() < 0.5 ? VIOLET : "#ff7bf2");
  }
}
