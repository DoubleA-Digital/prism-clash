// Decoy Swarm visuals: each decoy is a smaller, see-through copy of the owner's hero (same
// body, gun, color, name and health bar, so at a glance they pass) with scrolling hologram
// scanlines and the odd glitch. Like real fighters they're hidden out of your line of sight.
// A popped decoy is a white starburst; if it blinded you, your screen whites out for the
// blind duration.

import { hasStatusBit, PLAYER, POWERS, type NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import { drawLookalike } from "./lookalike";
import { firstSight } from "./once";
import type { RenderCtx } from "./types";

const HOLO = "#8FE9FF";

export function drawDecoy(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  if (e.owner !== rc.myId && rc.canSee && !rc.canSee(e.x, e.y)) return;
  if (firstSight(`decoy:${e.id}`, time)) rc.fx.particles.burst(e.x, e.y, 6, HOLO, 160, 0.35, 5);
  const fadeIn = Math.min(1, e.age / 0.15);
  const fadeOut = Math.min(1, Math.max(0, (e.life - e.age) / 0.5));
  const glitch = Math.random() < 0.06;
  const flicker = 0.6 + 0.15 * Math.sin(time * 23 + e.id) + (glitch ? -0.3 : 0);
  const alpha = fadeIn * fadeOut * flicker;
  if (alpha <= 0.02) return;
  const s = e.r / PLAYER.radius;
  const jx = glitch ? (Math.random() - 0.5) * 10 : 0;
  ctx.save();
  ctx.translate(e.x + jx, e.y);
  ctx.scale(s, s);
  drawLookalike(rc, e.owner, {
    x: 0, y: 0, aim: Math.atan2(e.vy, e.vx) || e.angle, alpha, speed: Math.hypot(e.vx, e.vy), showBar: e.owner !== rc.myId, invScale: rc.invScale / s, seed: e.id,
  });
  ctx.restore();

  // Hologram scanlines clipped to the core.
  const R = e.r * 1.15;
  ctx.save();
  ctx.beginPath();
  ctx.arc(e.x + jx, e.y, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = withAlpha(HOLO, 0.4 * fadeIn * fadeOut);
  ctx.lineWidth = 1.4;
  const off = (time * 30) % 5;
  ctx.beginPath();
  for (let y = -R + off; y < R; y += 5) {
    ctx.moveTo(e.x + jx - R, e.y + y);
    ctx.lineTo(e.x + jx + R, e.y + y);
  }
  ctx.stroke();
  ctx.restore();
  // Owner sees a small marker so they know which ones are theirs.
  if (e.owner === rc.myId) {
    ctx.save();
    ctx.strokeStyle = withAlpha(HOLO, 0.5 * fadeIn * fadeOut);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 1.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** A popped decoy (a "shockwave" effect with source decoySwarm): blinding starburst. */
export function drawDecoyPop(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  if (firstSight(`pop:${e.id}`, time)) {
    rc.fx.particles.burst(e.x, e.y, 46, "#ffffff", 720, 0.55, 6, PSHAPE.spark);
    rc.fx.particles.burst(e.x, e.y, 24, HOLO, 420, 0.6, 9);
    rc.fx.ring(e.x, e.y, 10, e.r, 0.35, "#ffffff", 6);
  }
  const t = Math.min(1, e.age / 0.4);
  const a = 1 - t;
  if (a > 0.01) {
    drawGlow(ctx, e.x, e.y, e.r * (0.8 + t * 0.7), "#ffffff", a);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 3;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + e.id;
      const r0 = e.r * 0.15;
      const r1 = e.r * (0.55 + 0.45 * t) * (k % 2 ? 0.6 : 1);
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(ang) * r0, e.y + Math.sin(ang) * r0);
      ctx.lineTo(e.x + Math.cos(ang) * r1, e.y + Math.sin(ang) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Blinded by it: white out the local screen for the blind duration.
  const me = rc.player(rc.myId);
  if (me && hasStatusBit(me.status, "blinded") && Math.hypot(me.x - e.x, me.y - e.y) <= POWERS.decoySwarm.flashRadius + 80) {
    rc.fx.screenFlash("#ffffff", 1 - e.age / e.life * 0.6);
  }
}
