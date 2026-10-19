// Chrono Rewind visuals: the rewind path replays backwards as a chain of ghostly afterimages
// (one effect per path segment, staggered by index), a collapsing clock where you left and a
// clock-face flash where you arrived.

import type { NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { changed } from "./util";

const MINT = "#3DFFB4";
/** Seconds for the afterimages to sweep from the present to the past. */
const SWEEP = 0.32;

/** A translucent copy of the player's core: the same six-shard shell, tinted toward mint. */
function ghost(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number, spin: number) {
  if (a <= 0.01) return;
  drawGlow(ctx, x, y, r * 1.9, MINT, 0.4 * a);
  drawGlow(ctx, x, y, r * 1.1, col, 0.5 * a, 0.3);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineJoin = "round";
  const ri = r * 0.78;
  const ro = r * 1.05;
  for (let i = 0; i < 6; i++) {
    const a0 = spin + (i / 6) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / 6 - 0.16;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a0) * ri, y + Math.sin(a0) * ri);
    ctx.lineTo(x + Math.cos(a0 + 0.08) * ro, y + Math.sin(a0 + 0.08) * ro);
    ctx.lineTo(x + Math.cos(a1 - 0.08) * ro, y + Math.sin(a1 - 0.08) * ro);
    ctx.lineTo(x + Math.cos(a1) * ri, y + Math.sin(a1) * ri);
    ctx.closePath();
    ctx.fillStyle = withAlpha(col, 0.18);
    ctx.fill();
    ctx.strokeStyle = withAlpha(MINT, 0.8);
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.restore();
}

function clockFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, time: number) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = MINT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const r0 = r * (i % 3 === 0 ? 0.74 : 0.84);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(t) * r0, y + Math.sin(t) * r0);
    ctx.lineTo(x + Math.cos(t) * r * 0.96, y + Math.sin(t) * r * 0.96);
    ctx.stroke();
  }
  // Hands spinning backwards.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  const h = -time * 9;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(h) * r * 0.7, y + Math.sin(h) * r * 0.7);
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(h / 12) * r * 0.45, y + Math.sin(h / 12) * r * 0.45);
  ctx.stroke();
  ctx.restore();
}

export function drawRewindTrail(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const count = Math.max(1, Math.round(e.v));
  const col = rc.color(e.owner);
  const appear = (e.n / count) * SWEEP;
  const shown = Math.min(1, Math.max(0, (e.age - appear) / 0.08));
  const fade = Math.max(0, Math.min(1, (e.life - e.age) / (e.life - SWEEP)));
  const a = shown * fade;
  const r = Math.max(12, e.r);

  if (e.n === 0 && changed(rc, "rewindFrom", e.id, 0, e.age)) {
    rc.fx.particles.burst(e.x, e.y, 22, MINT, 320, 0.5, 8, PSHAPE.spark);
    rc.fx.ring(e.x, e.y, r * 3, 6, 0.35, MINT, 4);
  }
  if (e.n === count - 1 && shown > 0 && changed(rc, "rewindTo", e.id, 0, e.age, 1)) {
    rc.fx.particles.burst(e.x2, e.y2, 30, MINT, 380, 0.6, 9);
    rc.fx.particles.burst(e.x2, e.y2, 14, "#ffffff", 260, 0.45, 6, PSHAPE.spark);
    rc.fx.ring(e.x2, e.y2, 8, r * 4, 0.45, MINT, 5);
  }
  if (a <= 0.01) return;

  // The path itself: a soft ribbon that "unspools" from present to past, with a bright core.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.strokeStyle = withAlpha(MINT, 0.16 * a);
  ctx.lineWidth = r * 1.4;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x2, e.y2);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(MINT, 0.6 * a);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x2, e.y2);
  ctx.stroke();
  // Reverse chevrons sliding back along the path: "rewinding".
  const len = Math.hypot(e.x2 - e.x, e.y2 - e.y);
  if (len > 30) {
    const ux = (e.x2 - e.x) / len;
    const uy = (e.y2 - e.y) / len;
    ctx.strokeStyle = withAlpha("#ffffff", 0.7 * a);
    ctx.lineWidth = 2;
    for (let d = (time * 140) % 40; d < len; d += 40) {
      const cx = e.x + ux * d;
      const cy = e.y + uy * d;
      ctx.beginPath();
      ctx.moveTo(cx - ux * 6 - uy * 7, cy - uy * 6 + ux * 7);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - ux * 6 + uy * 7, cy - uy * 6 - ux * 7);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Afterimages along each segment, older ones fainter.
  const age = 1 - (e.n / count) * 0.5;
  ghost(ctx, (e.x + e.x2) / 2, (e.y + e.y2) / 2, r, col, a * age * 0.45, -time * 4 + e.n + 0.5);
  ghost(ctx, e.x2, e.y2, r, col, a * age * 0.8, -time * 4 + e.n);
  if (e.n === 0) ghost(ctx, e.x, e.y, r, col, a * 0.5, -time * 4);
  if (e.n === count - 1) clockFace(ctx, e.x2, e.y2, r * 2.1, a, time);

  // Motes drifting backwards along the path.
  if (Math.random() < 0.5 * a) {
    const t = Math.random();
    const x = e.x + (e.x2 - e.x) * t;
    const y = e.y + (e.y2 - e.y) * t;
    const len = Math.hypot(e.x2 - e.x, e.y2 - e.y) || 1;
    rc.fx.particles.spawn(x, y, ((e.x2 - e.x) / len) * 160, ((e.y2 - e.y) / len) * 160, 0.4, 6, MINT);
  }
}
