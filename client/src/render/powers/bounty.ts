// Bounty Beacon visuals: a gold pillar of light rising from the marked player, a rotating
// crosshair on the floor under them, a "BOUNTY" tag, and (for everyone else) a gold arrow at
// the edge of their view pointing at the target when it's far away.

import { FX, type NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import { firstSight } from "./once";
import type { RenderCtx } from "./types";

const GOLD = "#FFD34D";
const BEAM_HEIGHT = 1400;

export function drawBeacon(rc: RenderCtx, e: NetEffect) {
  const { ctx, time, invScale } = rc;
  if (firstSight(`beacon:${e.id}`, time)) {
    const mine = e.link === rc.myId;
    rc.fx.label(e.x, e.y - 120, mine ? "YOU HAVE A BOUNTY!" : "BOUNTY!", mine ? "Everyone who hits you charges their ult" : `Hit ${rc.playerName(e.link)} to charge your ult`, GOLD, true);
    rc.fx.ring(e.x, e.y, 200, 30, 0.6, GOLD, 6);
    rc.fx.particles.burst(e.x, e.y, 30, GOLD, 420, 0.7, 8, PSHAPE.spark);
  }
  const a = Math.min(1, e.age / 0.25) * Math.min(1, Math.max(0, (e.life - e.age) / 0.5));
  if (a <= 0.01) return;
  const pulse = 0.75 + 0.25 * Math.sin(time * 5);
  const w = (34 + 10 * pulse) * Math.min(1, e.age / 0.25 + 0.2);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Pillar of light (rises "up" the screen, the readable direction from a top-down camera).
  const g = ctx.createLinearGradient(0, e.y, 0, e.y - BEAM_HEIGHT);
  g.addColorStop(0, withAlpha(GOLD, 0.8 * a));
  g.addColorStop(0.35, withAlpha(GOLD, 0.35 * a));
  g.addColorStop(1, withAlpha(GOLD, 0));
  ctx.fillStyle = g;
  ctx.fillRect(e.x - w / 2, e.y - BEAM_HEIGHT, w, BEAM_HEIGHT);
  const core = ctx.createLinearGradient(0, e.y, 0, e.y - BEAM_HEIGHT * 0.8);
  core.addColorStop(0, `rgba(255,246,200,${0.45 * a})`);
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(e.x - w * 0.12, e.y - BEAM_HEIGHT * 0.8, w * 0.24, BEAM_HEIGHT * 0.8);

  // Crosshair on the floor.
  const R = e.r * 2.3;
  ctx.translate(e.x, e.y);
  ctx.rotate(time * 1.4);
  ctx.strokeStyle = withAlpha(GOLD, 0.9 * a);
  ctx.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    const a0 = (k * Math.PI) / 2 + 0.25;
    ctx.beginPath();
    ctx.arc(0, 0, R, a0, a0 + Math.PI / 2 - 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0 - 0.25) * (R - 12), Math.sin(a0 - 0.25) * (R - 12));
    ctx.lineTo(Math.cos(a0 - 0.25) * (R + 14), Math.sin(a0 - 0.25) * (R + 14));
    ctx.stroke();
  }
  ctx.rotate(-time * 3);
  ctx.setLineDash([5, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Rising sparkles in the beam.
  if (Math.random() < 0.5 * a) rc.fx.particles.spawn(e.x + (Math.random() - 0.5) * w, e.y - Math.random() * 40, 0, -180 - Math.random() * 160, 0.9, 5, Math.random() < 0.6 ? GOLD : "#ffffff", PSHAPE.glow, 0.4);

  // Tag over the head, screen-sized.
  const s = invScale;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${14 * s}px Orbitron, system-ui, sans-serif`;
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = "rgba(5,4,13,0.9)";
  const ty = e.y - e.r - 84 * s;
  ctx.strokeText("★ BOUNTY ★", e.x, ty);
  ctx.fillStyle = GOLD;
  ctx.fillText("★ BOUNTY ★", e.x, ty);
  ctx.restore();

  drawPointer(rc, e, a);
}

/** Gold arrow at the edge of the local player's view toward a far-away bounty. */
function drawPointer(rc: RenderCtx, e: NetEffect, a: number) {
  if (e.link === rc.myId) return;
  const me = rc.player(rc.myId);
  if (!me) return;
  const dx = e.x - me.x;
  const dy = e.y - me.y;
  const d = Math.hypot(dx, dy);
  const edge = FX.viewHeight * 0.4;
  if (d < edge + 120) return;
  const ux = dx / d;
  const uy = dy / d;
  const x = me.x + ux * edge;
  const y = me.y + uy * edge;
  const s = rc.invScale;
  const { ctx, time } = rc;
  const bob = Math.sin(time * 6) * 5 * s;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(x + ux * bob, y + uy * bob);
  drawGlow(ctx, 0, 0, 42 * s, GOLD, 0.6);
  ctx.rotate(Math.atan2(uy, ux));
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = "rgba(5,4,13,0.9)";
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.moveTo(18 * s, 0);
  ctx.lineTo(-8 * s, -13 * s);
  ctx.lineTo(-3 * s, 0);
  ctx.lineTo(-8 * s, 13 * s);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.rotate(-Math.atan2(uy, ux));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${11 * s}px Orbitron, system-ui, sans-serif`;
  ctx.lineWidth = 3 * s;
  const label = "★";
  ctx.strokeText(label, -ux * 28 * s, -uy * 28 * s);
  ctx.fillText(label, -ux * 28 * s, -uy * 28 * s);
  ctx.restore();
}
