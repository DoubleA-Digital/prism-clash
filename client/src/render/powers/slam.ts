// Shockwave Slam visuals. While the caster is airborne, the landing spot is telegraphed: a
// growing shadow and a danger ring the size of the blast, with a second ring closing in as
// the countdown. On impact: a huge cyan ring, debris, and glowing floor cracks that fade.
// The "shockwave" kind is shared with Decoy Swarm's pop; drawShockwave dispatches by source.

import { POWERS, type NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import { drawDecoyPop } from "./decoy";
import { firstSight, hash01 } from "./once";
import type { RenderCtx } from "./types";

const CYAN = "#3DE0FF";
const C = POWERS.shockwaveSlam;
const CRACKS = 9;

export function drawShockwave(rc: RenderCtx, e: NetEffect) {
  if (e.source === "decoySwarm") return drawDecoyPop(rc, e);
  if (e.source !== "shockwaveSlam") {
    const t = Math.min(1, e.age / Math.max(0.01, e.life));
    rc.ctx.strokeStyle = withAlpha(rc.color(e.owner), 1 - t);
    rc.ctx.lineWidth = 4;
    rc.ctx.beginPath();
    rc.ctx.arc(e.x, e.y, e.r * t, 0, Math.PI * 2);
    rc.ctx.stroke();
    return;
  }
  if (e.n === 0) drawLeap(rc, e);
  else drawImpact(rc, e);
}

function drawLeap(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const t = Math.min(1, e.age / C.airTime);
  ctx.save();
  // Danger zone
  ctx.fillStyle = withAlpha(CYAN, 0.06 + 0.1 * t);
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(CYAN, 0.45 + 0.45 * t);
  ctx.lineWidth = 3 + 2 * t;
  ctx.setLineDash([16, 10]);
  ctx.lineDashOffset = -time * 60;
  ctx.stroke();
  ctx.setLineDash([]);
  // Countdown ring closing in from outside.
  ctx.strokeStyle = withAlpha("#ffffff", 0.35 + 0.5 * t);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * (1.45 - 0.45 * t), 0, Math.PI * 2);
  ctx.stroke();
  // Growing shadow where they'll land.
  ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.35 * t})`;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 6, 18 + 22 * t, 9 + 11 * t, 0, 0, Math.PI * 2);
  ctx.fill();
  // Inward chevrons
  ctx.strokeStyle = withAlpha(CYAN, 0.8);
  ctx.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + time * 0.8;
    const d = e.r * (0.92 - 0.35 * t);
    const x = e.x + Math.cos(a) * d;
    const y = e.y + Math.sin(a) * d;
    const nx = -Math.cos(a);
    const ny = -Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x - ny * 10 - nx * 8, y + nx * 10 - ny * 8);
    ctx.lineTo(x, y);
    ctx.lineTo(x + ny * 10 - nx * 8, y - nx * 10 - ny * 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawImpact(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  if (firstSight(`slam:${e.id}`, rc.time)) {
    rc.fx.ring(e.x, e.y, e.r * 0.15, e.r * 1.35, 0.55, CYAN, 12);
    rc.fx.ring(e.x, e.y, e.r * 0.1, e.r * 0.9, 0.35, "#ffffff", 6);
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 300 + Math.random() * 600;
      rc.fx.particles.spawn(e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + Math.random() * 0.4, 5 + Math.random() * 6, Math.random() < 0.3 ? "#ffffff" : CYAN, Math.random() < 0.5 ? PSHAPE.shard : PSHAPE.spark, 3.2);
    }
  }
  const t = Math.min(1, Math.max(0, e.age - C.airTime) / C.comboWindow);
  const a = 1 - t;
  // Shock disc
  const ease = 1 - (1 - Math.min(1, t * 2.2)) ** 3;
  drawGlow(ctx, e.x, e.y, e.r * 1.2, CYAN, 0.55 * a);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = withAlpha(CYAN, 0.7 * a);
  ctx.lineWidth = 22 * a + 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * ease, 0, Math.PI * 2);
  ctx.stroke();
  // Floor cracks: jagged radial lines, glowing then cooling.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? withAlpha(CYAN, 0.5 * a) : `rgba(255,255,255,${0.85 * a})`;
    ctx.lineWidth = pass === 0 ? 7 : 2;
    ctx.beginPath();
    for (let k = 0; k < CRACKS; k++) {
      let ang = (k / CRACKS) * Math.PI * 2 + hash01(e.id, k) * 0.5;
      const len = e.r * (0.55 + 0.4 * hash01(e.id, k + 30));
      let x = e.x + Math.cos(ang) * 22;
      let y = e.y + Math.sin(ang) * 22;
      ctx.moveTo(x, y);
      for (let j = 1; j <= 4; j++) {
        ang += (hash01(e.id, k * 7 + j) - 0.5) * 0.7;
        const step = (len / 4) * Math.min(1, t * 6 + 0.2);
        x += Math.cos(ang) * step;
        y += Math.sin(ang) * step;
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}
