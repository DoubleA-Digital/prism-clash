// Rift Collapse visuals. While pulling: a jagged magenta tear along the segment, a danger
// band showing exactly how close is too close (pulsing faster as the slam nears), chevrons
// and debris streaming inward. On the slam: a blinding white seam that fades, plus a screen
// flash scaled by how close you are. The string of "explode" events adds bursts and shake.

import type { NetEffect } from "@prism/shared";
import { ULTIMATES } from "@prism/shared";
import { withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { neonStroke, once, perFrame, wobble } from "./ult-fx";

const C = ULTIMATES.riftCollapse;
const MAGENTA = "#FF3DF0";
const VIOLET = "#9B5CFF";

export function drawRift(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const dx = e.x2 - e.x;
  const dy = e.y2 - e.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const closed = e.n === 1;

  if (closed) {
    drawSlam(rc, e, ux, uy, nx, ny, len);
    return;
  }

  const p = Math.min(1, e.age / C.pullTime);
  const left = C.pullTime - e.age;
  const open = Math.min(1, e.age / 0.25);
  // Pulse quickens from ~2 Hz to ~10 Hz as the slam approaches.
  const freq = 2 + 8 * p * p;
  const pulse = 0.5 + 0.5 * Math.sin(time * freq * Math.PI * 2);
  const band = C.closeRadius;

  ctx.save();
  // Danger band: where the slam will hit.
  ctx.translate(e.x, e.y);
  ctx.rotate(Math.atan2(dy, dx));
  const grad = ctx.createLinearGradient(0, -band, 0, band);
  const bandA = (0.08 + 0.14 * p + (left < 1 ? 0.12 * pulse : 0)) * open;
  grad.addColorStop(0, withAlpha(MAGENTA, 0));
  grad.addColorStop(0.35, withAlpha(MAGENTA, bandA));
  grad.addColorStop(0.5, withAlpha("#ffffff", bandA * 0.8));
  grad.addColorStop(0.65, withAlpha(MAGENTA, bandA));
  grad.addColorStop(1, withAlpha(MAGENTA, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, -band, len, band * 2);
  // Band edges: dashed, marching along.
  ctx.setLineDash([18, 14]);
  ctx.lineDashOffset = -time * 80;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, s * band);
    ctx.lineTo(len, s * band);
    neonStroke(ctx, MAGENTA, 2.5, (0.45 + 0.4 * pulse * p) * open, "#ffd6fb");
  }
  ctx.setLineDash([]);
  // Chevrons sliding toward the seam on both sides.
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = withAlpha(MAGENTA, 0.5 * open);
  ctx.lineWidth = 4;
  const step = 150;
  for (let x = step / 2; x < len; x += step) {
    for (const s of [-1, 1]) {
      const ph = (time * 0.9 + x * 0.002) % 1;
      const off = s * (band + 240 * (1 - ph));
      ctx.globalAlpha = Math.sin(ph * Math.PI);
      ctx.beginPath();
      ctx.moveTo(x - 18, off + s * 14);
      ctx.lineTo(x, off);
      ctx.lineTo(x + 18, off + s * 14);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // The tear: a jagged line that shivers, widening as it builds.
  const segs = Math.max(8, Math.round(len / 40));
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const taper = Math.sin(t * Math.PI);
    const j = wobble(i + e.id, time) * (10 + 16 * p) * taper * open;
    const x = e.x + dx * t + nx * j;
    const y = e.y + dy * t + ny * j;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  neonStroke(ctx, MAGENTA, (6 + 8 * p) * open, 0.9, "#ffffff");
  ctx.restore();

  // Debris sucked toward the seam.
  for (let i = perFrame(90, rc.dt); i > 0; i--) {
    const t = Math.random();
    const s = Math.random() < 0.5 ? -1 : 1;
    const d = 140 + Math.random() * 420;
    const x = e.x + dx * t + nx * d * s;
    const y = e.y + dy * t + ny * d * s;
    const sp = 260 + 200 * p;
    rc.fx.particles.spawn(x, y, -nx * s * sp, -ny * s * sp, 0.6, 4 + Math.random() * 5, Math.random() < 0.6 ? MAGENTA : VIOLET, 0, 0.6);
  }
}

function drawSlam(rc: RenderCtx, e: NetEffect, ux: number, uy: number, nx: number, ny: number, len: number) {
  const { ctx } = rc;
  const k = Math.max(0, 1 - (e.age - C.pullTime) / C.afterglow);
  if (once(e, "slam")) {
    const me = rc.pos?.(rc.myId) ?? rc.player(rc.myId);
    let near = 0.35;
    if (me) {
      const t = Math.max(0, Math.min(len, (me.x - e.x) * ux + (me.y - e.y) * uy));
      const d = Math.hypot(me.x - (e.x + ux * t), me.y - (e.y + uy * t));
      near = Math.max(near, 1 - d / 900);
    }
    rc.fx.screenFlash("#ffd6fb", 0.75 * near);
    rc.fx.aberrate(near);
    for (let i = 0; i < 70; i++) {
      const t = Math.random();
      const s = Math.random() < 0.5 ? -1 : 1;
      const sp = 400 + Math.random() * 700;
      rc.fx.particles.spawn(e.x + ux * len * t, e.y + uy * len * t, nx * s * sp, ny * s * sp, 0.7, 6 + Math.random() * 8, Math.random() < 0.5 ? "#ffffff" : MAGENTA, 1, 3);
    }
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x2, e.y2);
  neonStroke(ctx, MAGENTA, 10 + 50 * k, k, "#ffffff");
  ctx.restore();
}
