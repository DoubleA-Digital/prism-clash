// Boomerang Glaive visuals: a three-bladed spinning disc with motion-blur afterimages. The
// thrower sees the catch zone at the throw point while it's coming back. Caught: a "CAUGHT!"
// flourish as it snaps into your core. In a Singularity it glows violet and the shred zone
// around the black hole is outlined.

import { POWERS, type NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import { firstSight } from "./once";
import type { RenderCtx } from "./types";

const TEAL = "#2EF2D0";
const VIOLET = "#B07CFF";
const C = POWERS.boomerangGlaive;
const PHASE = { out: 0, back: 1, caught: 2, orbit: 3 } as const;

function blade(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, edge: string, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha *= alpha;
  for (let i = 0; i < 3; i++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.moveTo(r * 0.18, -r * 0.16);
    ctx.quadraticCurveTo(r * 0.7, -r * 0.6, r * 1.05, -r * 0.28);
    ctx.quadraticCurveTo(r * 0.62, -r * 0.12, r * 0.42, r * 0.22);
    ctx.closePath();
    ctx.fillStyle = "rgba(232,255,250,0.92)";
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
  ctx.fillStyle = "#05040d";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

export function drawGlaive(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const orbiting = e.n === PHASE.orbit;
  const col = orbiting ? VIOLET : TEAL;
  const r = e.r * 1.9;
  const spin = time * (orbiting ? 30 : 24) + e.id;

  if (e.n === PHASE.caught) {
    if (firstSight(`glaive-catch:${e.id}`, time)) {
      const mine = e.owner === rc.myId;
      rc.fx.label(e.x, e.y - 95, "CAUGHT!", mine ? "Cooldown reset" : "", TEAL);
      rc.fx.ring(e.x, e.y, 10, 90, 0.4, TEAL, 5);
      rc.fx.particles.burst(e.x, e.y, 24, TEAL, 360, 0.45, 6, PSHAPE.spark);
    }
    const t = Math.min(1, (e.life - e.age) / C.caughtLinger);
    drawGlow(ctx, e.x, e.y, 70 * t, TEAL, 0.8 * t);
    blade(ctx, e.x, e.y, r * t, spin * 1.6, TEAL, t);
    return;
  }

  // Catch zone for the thrower while it flies home.
  if (e.owner === rc.myId && e.n === PHASE.back && e.v < 1) {
    ctx.save();
    ctx.strokeStyle = withAlpha(TEAL, 0.55 + 0.25 * Math.sin(time * 10));
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath();
    ctx.arc(e.x2, e.y2, C.catchRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (orbiting) {
    // Shred zone around the black hole the blade is circling.
    const cx = e.x - Math.cos(e.angle) * C.orbitRadius;
    const cy = e.y - Math.sin(e.angle) * C.orbitRadius;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(VIOLET, 0.35 + 0.2 * Math.sin(time * 12));
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = time * 80;
    ctx.beginPath();
    ctx.arc(cx, cy, C.orbitHitRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = withAlpha(TEAL, 0.5);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, C.orbitRadius, e.angle - 1.4, e.angle);
    ctx.stroke();
    ctx.restore();
  }

  // Motion-blur afterimages along the velocity.
  const sp = Math.hypot(e.vx, e.vy);
  for (let i = 3; i >= 1; i--) {
    const k = i * 0.018;
    blade(ctx, e.x - e.vx * k, e.y - e.vy * k, r, spin - i * 0.5, col, 0.22 * (4 - i) * Math.min(1, sp / 400));
  }
  drawGlow(ctx, e.x, e.y, r * 2.8, col, 0.7);
  blade(ctx, e.x, e.y, r, spin, col, 1);
  if (sp > 200 && Math.random() < 0.5) {
    const a = Math.random() * Math.PI * 2;
    rc.fx.particles.spawn(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, -Math.sin(a) * 260, Math.cos(a) * 260, 0.25, 3, Math.random() < 0.5 ? "#ffffff" : col, PSHAPE.spark, 4);
  }
}
