// Hex Swap visuals: hexagons flash and spin open at both landing points, joined by a pair
// of crossing beams so everyone can see who traded places with whom.

import type { NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { changed } from "./util";

const ACID = "#E2FF4F";

function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * Math.PI * 2;
    if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

export function drawHexFlash(rc: RenderCtx, e: NetEffect) {
  const { ctx } = rc;
  const k = Math.min(1, e.age / Math.max(0.01, e.life));
  const fade = 1 - k;
  const pts: [number, number, string][] = [[e.x, e.y, rc.color(e.owner)], [e.x2, e.y2, rc.color(e.link)]];
  if (changed(rc, "hexOn", e.id, 0, e.age)) {
    for (const [x, y, col] of pts) {
      rc.fx.particles.burst(x, y, 22, ACID, 380, 0.45, 8, PSHAPE.shard);
      rc.fx.particles.burst(x, y, 10, col, 260, 0.4, 7);
      rc.fx.ring(x, y, 10, 110, 0.35, ACID, 5);
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  // Crossing beams: the swap path, bowed apart so both directions read.
  const mx = (e.x + e.x2) / 2;
  const my = (e.y + e.y2) / 2;
  const len = Math.hypot(e.x2 - e.x, e.y2 - e.y) || 1;
  const nx = (-(e.y2 - e.y) / len) * Math.min(60, len * 0.15);
  const ny = ((e.x2 - e.x) / len) * Math.min(60, len * 0.15);
  ctx.lineWidth = 3;
  for (const s of [1, -1]) {
    ctx.strokeStyle = withAlpha(ACID, 0.7 * fade);
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -rc.time * 160 * s;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.quadraticCurveTo(mx + nx * s, my + ny * s, e.x2, e.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const [x, y, col] of pts) {
    drawGlow(ctx, x, y, e.r * 2.2 * (0.6 + k), ACID, 0.8 * fade);
    ctx.strokeStyle = withAlpha(ACID, fade);
    ctx.lineWidth = 4;
    hexagon(ctx, x, y, e.r * (0.6 + k * 1.4), k * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(col, 0.8 * fade);
    ctx.lineWidth = 2;
    hexagon(ctx, x, y, e.r * (0.4 + k * 0.8), -k * 3);
    ctx.stroke();
    if (k < 0.25) {
      ctx.fillStyle = withAlpha("#ffffff", 0.5 * (1 - k * 4));
      hexagon(ctx, x, y, e.r * 0.7, 0);
      ctx.fill();
    }
  }
  ctx.restore();
}
