// Magnetar visuals: the capture field around the player (a dashed boundary with field lines
// drifting inward), the orbit ring the stolen shots spin on with one pip per held shot, and
// a draining timer arc. The held shots themselves are real projectiles drawn by the renderer.

import { POWERS, type NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { anchor, changed, ownerAlpha } from "./util";

const RED = "#FF5A4E";
const POLE = "#6FB7FF";
const TAU = Math.PI * 2;

export function drawMagnet(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const at = anchor(rc, e.owner) ?? e;
  const a = ownerAlpha(rc, e.owner) * Math.min(1, (e.life - e.age) / 0.25);
  const born = Math.min(1, e.age / 0.2);
  const R = e.r * (1 - (1 - born) ** 3);
  if (changed(rc, "magnetOn", e.id, 0, e.age)) {
    rc.fx.ring(at.x, at.y, e.r * 1.3, e.r, 0.3, RED, 5);
    rc.fx.particles.burst(at.x, at.y, 20, RED, 300, 0.4, 7, PSHAPE.spark);
  }
  if (e.n > 0 && changed(rc, "magnetN", e.id, e.n)) rc.fx.ring(at.x, at.y, POWERS.magnetar.orbitRadius + 16, POWERS.magnetar.orbitRadius, 0.2, "#ffffff", 3);
  if (a <= 0.02 || R < 2) return;
  const charge = Math.min(1, e.n / POWERS.magnetar.maxCaptured);
  drawGlow(ctx, at.x, at.y, R * 1.15, RED, (0.18 + 0.3 * charge) * a);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = "lighter";
  // Field boundary: two-tone dashes rotating opposite ways (the poles).
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 14]);
  ctx.strokeStyle = withAlpha(RED, 0.75);
  ctx.lineDashOffset = time * 40;
  ctx.beginPath();
  ctx.arc(at.x, at.y, R, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(POLE, 0.55);
  ctx.lineDashOffset = -time * 40 + 16;
  ctx.beginPath();
  ctx.arc(at.x, at.y, R - 5, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // Field lines curving inward, drifting toward the core.
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 10; i++) {
    const t = (time * 0.9 + i * 0.37) % 1;
    const base = (i / 10) * TAU + time * 0.4;
    const r0 = R * (1 - t * 0.55);
    ctx.strokeStyle = withAlpha(i % 2 ? RED : POLE, 0.55 * (1 - t));
    ctx.beginPath();
    ctx.arc(at.x, at.y, r0, base, base + 0.35);
    ctx.stroke();
  }
  // Orbit ring with one pip per held shot.
  const orbit = POWERS.magnetar.orbitRadius;
  ctx.strokeStyle = withAlpha("#ffffff", 0.25 + 0.35 * charge);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(at.x, at.y, orbit, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < e.n; i++) {
    const ang = e.angle + (i / e.n) * TAU;
    drawGlow(ctx, at.x + Math.cos(ang) * orbit, at.y + Math.sin(ang) * orbit, 16, RED, 0.6);
  }
  // Time left.
  const frac = Math.max(0, (e.life - e.age) / e.life);
  ctx.strokeStyle = withAlpha("#ffffff", 0.8);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(at.x, at.y, R + 7, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
  ctx.stroke();
  ctx.restore();
  if (e.n > 0) {
    const s = rc.invScale;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `800 ${14 * s}px Rajdhani, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3.5 * s;
    ctx.strokeStyle = "rgba(5,4,13,0.9)";
    const label = `${e.n}/${POWERS.magnetar.maxCaptured}`;
    const ty = at.y + R + 16 * s;
    ctx.strokeText(label, at.x, ty);
    ctx.fillStyle = e.n >= POWERS.magnetar.maxCaptured ? "#ffffff" : RED;
    ctx.fillText(label, at.x, ty);
    ctx.restore();
  }
  if (Math.random() < 0.4 * a) {
    const ang = Math.random() * TAU;
    rc.fx.particles.spawn(at.x + Math.cos(ang) * R, at.y + Math.sin(ang) * R, -Math.cos(ang) * 180, -Math.sin(ang) * 180, 0.45, 4, Math.random() < 0.5 ? RED : POLE, PSHAPE.spark, 0.5);
  }
}
