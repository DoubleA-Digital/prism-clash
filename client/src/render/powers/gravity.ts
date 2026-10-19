// Gravity Flip visuals: a green orb with counter-rotating spiral arms, and on the victim a
// spinning ring of reversed arrows plus an upside-down chevron badge for the whole 2.5s.
// "FLIPPED!" pops when it lands; the victim also gets a green screen pulse.

import type { NetEffect, NetProjectile } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow } from "../glow";
import { firstSight } from "./once";
import type { RenderCtx } from "./types";

const GREEN = "#7BFF6B";
const PALE = "#E9FFE4";

export function drawGravityOrb(rc: RenderCtx, p: NetProjectile) {
  const { ctx, time } = rc;
  drawGlow(ctx, p.x, p.y, 74, GREEN, 0.95);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.lineCap = "round";
  for (let arm = 0; arm < 2; arm++) {
    const dir = arm === 0 ? 1 : -1;
    ctx.strokeStyle = arm === 0 ? GREEN : PALE;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const a = dir * time * 9 + t * 4.2 + arm * Math.PI;
      const rr = 7 + t * 24;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = "#04140a";
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  if (Math.random() < 0.7) {
    const a = time * 9 + Math.random() * 6.28;
    rc.fx.particles.spawn(p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, -p.vx * 0.15 - Math.sin(a) * 90, -p.vy * 0.15 + Math.cos(a) * 90, 0.45, 6, GREEN);
  }
}

export function drawFlip(rc: RenderCtx, e: NetEffect) {
  const { ctx, time, invScale } = rc;
  const victimIsMe = e.link === rc.myId;
  if (firstSight(`flip:${e.id}`, time)) {
    rc.fx.label(e.x, e.y - 105, victimIsMe ? "CONTROLS FLIPPED!" : "FLIPPED!", victimIsMe ? "Your movement is reversed" : rc.playerName(e.link), GREEN, victimIsMe);
    rc.fx.ring(e.x, e.y, 80, 20, 0.35, GREEN, 5);
    rc.fx.particles.burst(e.x, e.y, 26, GREEN, 380, 0.5, 7, PSHAPE.spark);
    if (victimIsMe) rc.fx.screenFlash(GREEN, 0.5);
  }
  const fadeIn = Math.min(1, e.age / 0.15);
  const fadeOut = Math.min(1, Math.max(0, (e.life - e.age) / 0.35));
  const a = fadeIn * fadeOut;
  if (a <= 0.01) return;
  const R = e.r * 2.05;
  ctx.save();
  ctx.globalAlpha = a;
  drawGlow(ctx, e.x, e.y, R * 1.5, GREEN, 0.3);
  // Ring of arrows chasing the "wrong" way.
  ctx.strokeStyle = GREEN;
  ctx.fillStyle = GREEN;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    const a0 = -time * 3.2 + (k * Math.PI * 2) / 3;
    const a1 = a0 + 1.35;
    ctx.beginPath();
    ctx.arc(e.x, e.y, R, a0, a1);
    ctx.stroke();
    const hx = e.x + Math.cos(a0) * R;
    const hy = e.y + Math.sin(a0) * R;
    const tx = Math.sin(a0);
    const ty = -Math.cos(a0);
    ctx.beginPath();
    ctx.moveTo(hx + tx * 9, hy + ty * 9);
    ctx.lineTo(hx + Math.cos(a0) * 7, hy + Math.sin(a0) * 7);
    ctx.lineTo(hx - Math.cos(a0) * 7, hy - Math.sin(a0) * 7);
    ctx.closePath();
    ctx.fill();
  }
  // Swapped-arrows badge over the head (screen-sized), wobbling.
  const s = invScale;
  const bx = e.x;
  const by = e.y - e.r - 52 * s;
  ctx.translate(bx, by);
  ctx.rotate(Math.sin(time * 7) * 0.25);
  ctx.fillStyle = "rgba(4,20,10,0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, 15 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 2.5 * s;
  ctx.stroke();
  ctx.strokeStyle = PALE;
  ctx.lineWidth = 2.6 * s;
  const arrow = (x: number, up: boolean) => {
    const d = up ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(x, -8 * s * d);
    ctx.lineTo(x, 8 * s * d);
    ctx.moveTo(x - 4.5 * s, 3.5 * s * d);
    ctx.lineTo(x, 8 * s * d);
    ctx.lineTo(x + 4.5 * s, 3.5 * s * d);
    ctx.stroke();
  };
  arrow(-5 * s, true);
  arrow(5 * s, false);
  ctx.restore();
  // The victim's own view gets a faint pulsing green edge around them as a constant reminder.
  if (victimIsMe) drawGlow(ctx, e.x, e.y, 260, GREEN, 0.12 * a * (0.6 + 0.4 * Math.sin(time * 8)));
}
