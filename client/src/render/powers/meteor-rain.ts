// Meteor Rain visuals. The marked area is a slowly turning dashed ring with hazard ticks;
// every meteor gets a warning circle that fills in toward the impact while a flaming rock
// streaks down from the sky onto it. The impact itself is the shared "explode" event
// (fiery burst, floor ripple, shake).

import type { NetEffect } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { envelope, neonStroke, perFrame } from "./ult-fx";

const ORANGE = "#FF7A2B";
const HOT = "#FFD34D";
/** Where meteors fall from, relative to their target (up and to the right, off screen). */
const SKY_X = 260;
const SKY_Y = -720;

export function drawMeteorWarn(rc: RenderCtx, e: NetEffect) {
  if (e.n === 0) drawArea(rc, e);
  else drawMeteor(rc, e);
}

function drawArea(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const a = envelope(e, 0.25, 0.35);
  ctx.save();
  // Faint hazard fill
  const g = ctx.createRadialGradient(e.x, e.y, e.r * 0.2, e.x, e.y, e.r);
  g.addColorStop(0, withAlpha(ORANGE, 0.02 * a));
  g.addColorStop(1, withAlpha(ORANGE, 0.12 * a));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
  ctx.fill();
  // Turning dashed rim
  ctx.setLineDash([26, 16]);
  ctx.lineDashOffset = -time * 60;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
  neonStroke(ctx, ORANGE, 4, 0.75 * a, HOT);
  ctx.setLineDash([]);
  // Hazard ticks pointing inward
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = withAlpha(HOT, 0.6 * a);
  ctx.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + time * 0.25;
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(ang) * e.r * 0.93, e.y + Math.sin(ang) * e.r * 0.93);
    ctx.lineTo(e.x + Math.cos(ang) * e.r * 1.05, e.y + Math.sin(ang) * e.r * 1.05);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeteor(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const p = Math.min(1, e.age / Math.max(0.01, e.life));
  const pulse = 0.5 + 0.5 * Math.sin(time * (10 + p * 26));
  const born = Math.min(1, e.age / 0.12);
  ctx.save();
  // Warning disc: filled from the center out as the meteor closes in.
  ctx.fillStyle = withAlpha("#FF2E2E", 0.1 + 0.08 * pulse);
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * born, 0, Math.PI * 2);
  ctx.fill();
  const fill = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * p);
  fill.addColorStop(0, withAlpha(HOT, 0.55));
  fill.addColorStop(0.7, withAlpha(ORANGE, 0.4));
  fill.addColorStop(1, withAlpha("#FF2E2E", 0.55));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(e.x, e.y, Math.max(0.1, e.r * p), 0, Math.PI * 2);
  ctx.fill();
  // Rim + crosshair
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * born, 0, Math.PI * 2);
  neonStroke(ctx, "#FF3B2E", 3 + 2 * p, 0.7 + 0.3 * pulse, HOT);
  ctx.beginPath();
  const k = e.r * 0.35;
  ctx.moveTo(e.x - k, e.y);
  ctx.lineTo(e.x + k, e.y);
  ctx.moveTo(e.x, e.y - k);
  ctx.lineTo(e.x, e.y + k);
  neonStroke(ctx, ORANGE, 2, 0.6, HOT);

  // The meteor: eases in fast at the end, growing as it "gets closer".
  const f = 1 - p;
  const fall = f * f;
  const mx = e.x + SKY_X * fall;
  const my = e.y + SKY_Y * fall;
  const size = 14 + 20 * p;
  // Ground shadow under the target, tightening as it lands.
  ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.3 * p})`;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, size * (2.2 - p), size * (1.2 - p * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();
  // Flaming tail back toward the sky.
  const tl = 130 + 90 * p;
  const len = Math.hypot(SKY_X, SKY_Y);
  const ux = SKY_X / len;
  const uy = SKY_Y / len;
  const tail = ctx.createLinearGradient(mx, my, mx + ux * tl, my + uy * tl);
  tail.addColorStop(0, withAlpha(HOT, 0.95));
  tail.addColorStop(0.35, withAlpha(ORANGE, 0.6));
  tail.addColorStop(1, withAlpha("#FF2E2E", 0));
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(mx - uy * size, my + ux * size);
  ctx.lineTo(mx + ux * tl, my + uy * tl);
  ctx.lineTo(mx + uy * size, my - ux * size);
  ctx.closePath();
  ctx.fill();
  drawGlow(ctx, mx, my, size * 3.2, ORANGE, 0.9);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#3a1408";
  ctx.beginPath();
  ctx.arc(mx, my, size * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = HOT;
  ctx.lineWidth = 3;
  ctx.stroke();
  drawGlow(ctx, mx - ux * size * 0.2, my - uy * size * 0.2, size * 1.2, "#FFF1C2", 0.9);
  ctx.restore();
  // Embers shed from the tail.
  for (let i = perFrame(70, rc.dt); i > 0; i--) {
    const t = Math.random() * 0.5;
    rc.fx.particles.spawn(mx + ux * tl * t, my + uy * tl * t, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.45, 5 + Math.random() * 5, Math.random() < 0.5 ? ORANGE : HOT);
  }
}
