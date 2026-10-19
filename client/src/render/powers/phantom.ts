// Phantom Mark visuals: a violet afterimage streak along the dash, and a rotating hexagram
// sigil under each marked enemy whose outer ring fills as the fuse burns. Once the caster
// shoots them it turns hot pink, grows, and shows "x2".

import type { NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { anchor, changed } from "./util";

const VIOLET = "#C06BFF";
const HOT = "#FF4FD8";
const TAU = Math.PI * 2;

export function drawPhantomDash(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  if (changed(rc, "phantomGo", e.id, 0, e.age)) {
    rc.fx.particles.cone(e.x, e.y, 16, e.angle + Math.PI, 1.2, VIOLET, 360, 0.4, 6);
    rc.fx.ring(e.x, e.y, 10, 80, 0.3, VIOLET, 4);
  }
  const len = Math.hypot(e.x2 - e.x, e.y2 - e.y);
  if (len < 4) return;
  const fade = Math.max(0, Math.min(1, (e.life - e.age) / 0.35));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  const g = ctx.createLinearGradient(e.x, e.y, e.x2, e.y2);
  g.addColorStop(0, withAlpha(VIOLET, 0));
  g.addColorStop(1, withAlpha(VIOLET, 0.55 * fade));
  ctx.strokeStyle = g;
  ctx.lineWidth = e.r * 1.6;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x2, e.y2);
  ctx.stroke();
  const g2 = ctx.createLinearGradient(e.x, e.y, e.x2, e.y2);
  g2.addColorStop(0, withAlpha("#ffffff", 0));
  g2.addColorStop(1, withAlpha("#ffffff", 0.9 * fade));
  ctx.strokeStyle = g2;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x2, e.y2);
  ctx.stroke();
  // Ghost silhouettes left along the path.
  const n = Math.min(5, Math.floor(len / 45));
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const x = e.x + (e.x2 - e.x) * t;
    const y = e.y + (e.y2 - e.y) * t;
    ctx.strokeStyle = withAlpha(VIOLET, 0.6 * t * fade);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, e.r * 0.9, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSigil(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const at = anchor(rc, e.link) ?? e;
  const doubled = e.n === 1;
  const col = doubled ? HOT : VIOLET;
  const k = Math.min(1, e.age / Math.max(0.01, e.life));
  const born = Math.min(1, e.age / 0.15);
  // Wider than a core, so the brand rings the marked player instead of hiding them.
  const R = e.r * 1.3 * (doubled ? 1.25 : 1) * (0.6 + 0.4 * born);
  if (changed(rc, "sigilOn", e.id, 0, e.age)) {
    rc.fx.particles.burst(at.x, at.y, 14, VIOLET, 260, 0.4, 7, PSHAPE.spark);
    rc.fx.ring(at.x, at.y, 70, 20, 0.3, VIOLET, 4);
  }
  if (doubled && changed(rc, "sigilX2", e.id, 1)) {
    rc.fx.particles.burst(at.x, at.y, 20, HOT, 340, 0.4, 8, PSHAPE.spark);
    rc.fx.ring(at.x, at.y, 20, 110, 0.3, HOT, 5);
  }
  const pulse = 0.5 + 0.5 * Math.sin(time * (8 + k * 26));
  drawGlow(ctx, at.x, at.y, R * 2.2, col, 0.35 + 0.35 * pulse * k);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  // Hexagram turning faster as it nears detonation.
  ctx.rotate(time * (1.5 + k * 6));
  ctx.strokeStyle = withAlpha(col, 0.95);
  ctx.fillStyle = withAlpha(col, 0.1 + 0.12 * pulse * k);
  ctx.lineWidth = 4;
  for (const off of [0, Math.PI]) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = off - Math.PI / 2 + (i / 3) * TAU;
      if (i) ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      else ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.rotate(-time * (1.5 + k * 6));
  ctx.strokeStyle = withAlpha(col, 0.4);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.stroke();
  // Fuse: the outer ring fills clockwise; it's full when it pops.
  ctx.strokeStyle = withAlpha("#ffffff", 0.9);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.12, -Math.PI / 2, -Math.PI / 2 + k * TAU);
  ctx.stroke();
  ctx.restore();
  if (doubled) {
    const s = rc.invScale;
    ctx.save();
    ctx.font = `800 ${18 * s}px Rajdhani, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4 * s;
    ctx.strokeStyle = "rgba(5,4,13,0.9)";
    const ty = at.y + R * 1.12 + 14 * s;
    ctx.strokeText("x2", at.x, ty);
    ctx.fillStyle = HOT;
    ctx.fillText("x2", at.x, ty);
    ctx.restore();
  }
}
