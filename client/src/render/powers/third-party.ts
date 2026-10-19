// Third-Party visuals. Everyone sees the caster circled by crimson vulture talons (a warning:
// this player hits twice as hard on anyone already in a fight). Only the caster sees the
// red "×2" crosshairs on enemies that currently qualify for double damage.

import type { NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import { firstSight } from "./once";
import type { RenderCtx } from "./types";

const CRIMSON = "#FF2B4A";
const DEEP = "#8A0A1E";

export function drawVulture(rc: RenderCtx, e: NetEffect) {
  if (e.n === 1) return drawMarker(rc, e);
  const { ctx, time } = rc;
  if (firstSight(`vulture:${e.id}`, time)) {
    rc.fx.ring(e.x, e.y, 90, 24, 0.4, CRIMSON, 5);
    if (e.owner === rc.myId) rc.fx.label(e.x, e.y - 100, "THIRD-PARTY", "Double damage on enemies already in a fight", CRIMSON);
  }
  const a = Math.min(1, e.age / 0.2) * Math.min(1, Math.max(0, (e.life - e.age) / 0.4));
  if (a <= 0.01) return;
  drawGlow(ctx, e.x, e.y, e.r * 3, CRIMSON, 0.32 * a);
  ctx.save();
  ctx.globalAlpha = a;
  // Three talons circling like vultures overhead.
  for (let k = 0; k < 3; k++) {
    const ang = time * 1.7 + (k * Math.PI * 2) / 3;
    const R = e.r * 1.95 + Math.sin(time * 3 + k) * 3;
    ctx.save();
    ctx.translate(e.x + Math.cos(ang) * R, e.y + Math.sin(ang) * R);
    ctx.rotate(ang + Math.PI / 2);
    const flap = Math.sin(time * 9 + k * 2) * 0.25;
    ctx.fillStyle = DEEP;
    ctx.strokeStyle = CRIMSON;
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * 10, -6 - flap * 8, side * 17, 2 + flap * 6);
      ctx.quadraticCurveTo(side * 9, 0, side * 3, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  // Thin red halo
  ctx.strokeStyle = withAlpha(CRIMSON, 0.55);
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 9]);
  ctx.lineDashOffset = time * 20;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * 1.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  if (Math.random() < 0.3 * a) rc.fx.particles.spawn(e.x + (Math.random() - 0.5) * 40, e.y + (Math.random() - 0.5) * 40, 0, 50, 0.6, 4, CRIMSON, PSHAPE.glow, 1);
}

/** Caster-only crosshair on a target worth third-partying. */
function drawMarker(rc: RenderCtx, e: NetEffect) {
  if (e.owner !== rc.myId) return;
  const { ctx, time, invScale } = rc;
  if (firstSight(`vmark:${e.id}`, time)) rc.fx.ring(e.x, e.y, 110, e.r * 1.9, 0.3, CRIMSON, 4);
  const a = Math.min(1, e.age / 0.12) * Math.min(1, Math.max(0, (e.life - e.age) / 0.2));
  if (a <= 0.01) return;
  const pulse = 1 + Math.sin(time * 10) * 0.06;
  const R = e.r * 1.85 * pulse;
  ctx.save();
  ctx.globalAlpha = a;
  drawGlow(ctx, e.x, e.y, R * 1.4, CRIMSON, 0.3);
  ctx.translate(e.x, e.y);
  ctx.strokeStyle = CRIMSON;
  ctx.lineWidth = 3;
  ctx.rotate(time * 0.9);
  for (let k = 0; k < 4; k++) {
    const a0 = (k * Math.PI) / 2 + 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, R, a0, a0 + Math.PI / 2 - 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0 - 0.3) * (R - 10), Math.sin(a0 - 0.3) * (R - 10));
    ctx.lineTo(Math.cos(a0 - 0.3) * (R + 12), Math.sin(a0 - 0.3) * (R + 12));
    ctx.stroke();
  }
  ctx.rotate(-time * 0.9);
  const s = invScale;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${18 * s}px Orbitron, system-ui, sans-serif`;
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = "rgba(5,4,13,0.9)";
  ctx.strokeText("×2", R * 0.85, -R * 0.85);
  ctx.fillStyle = CRIMSON;
  ctx.fillText("×2", R * 0.85, -R * 0.85);
  ctx.restore();
}
