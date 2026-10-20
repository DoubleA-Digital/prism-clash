// One-shot effect art around a chibi hero: floor shadow, footstep dust, muzzle flash, blade
// trail, held props, heal sparkles, the drop-in landing and the death pop. All stateless:
// each is a pure function of the progress value, so no particle bookkeeping is needed.

import { HEROES, type HeroId } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import { INK, light, shade } from "./paint";
import type { HeldProp } from "./pose";
import { BODY_Y, HEAD_Y, blit, bodySprite, headSprite, rimSprite } from "./sprites";
import { rarityHex } from "./weapons";

const hash = (n: number) => {
  const s = Math.sin(n * 91.3458 + 47.853) * 24634.6345;
  return s - Math.floor(s);
};

export function drawShadow(ctx: CanvasRenderingContext2D, color: string, k: number, glow: boolean) {
  if (glow) drawGlow(ctx, 0, 14, 36 * k, color, 0.22);
  ctx.fillStyle = `rgba(3,2,12,${0.5 * Math.min(1, k)})`;
  ctx.beginPath();
  ctx.ellipse(0, 19.5, 15 * k, 5.6 * k, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Two little puffs where a foot just planted. `age` 0..1 over the puff's life. */
export function drawDust(ctx: CanvasRenderingContext2D, x: number, y: number, age: number) {
  const a = 0.32 * (1 - age);
  ctx.fillStyle = `rgba(200,210,255,${a})`;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + s * (2 + age * 6), y + 1 - age * 2, 1.6 + age * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawMuzzleFlash(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, size: number, color: string) {
  drawGlow(ctx, x, y, 16 * size * (0.6 + k * 0.6), color, 0.9 * k);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha *= k;
  ctx.fillStyle = "#fff6d8";
  const L = 9 * size * (0.5 + k * 0.5);
  const W = 3.4 * size;
  ctx.beginPath();
  ctx.moveTo(-1, -W);
  ctx.lineTo(L, 0);
  ctx.lineTo(-1, W);
  ctx.lineTo(L * 0.35, 0);
  ctx.closePath();
  ctx.moveTo(0, 0);
  ctx.lineTo(L * 0.3, -W * 1.5);
  ctx.lineTo(L * 0.5, 0);
  ctx.lineTo(L * 0.3, W * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Blade trail: a bright crescent swept between a0 and a1. */
export function drawSlashArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, a0: number, a1: number, r0: number, r1: number, color: string, k: number) {
  if (k <= 0.01) return;
  const ccw = a1 < a0;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha *= k;
  const p = new Path2D();
  p.arc(cx, cy, r1, a0, a1, ccw);
  p.arc(cx, cy, r0 + (r1 - r0) * 0.55, a1, a0, !ccw);
  p.closePath();
  ctx.fillStyle = withAlpha(color, 0.55);
  ctx.fill(p);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r1 - 1, a0 + (a1 - a0) * 0.35, a1, ccw);
  ctx.stroke();
  ctx.restore();
  drawGlow(ctx, cx + Math.cos(a1) * r1 * 0.8, cy + Math.sin(a1) * r1 * 0.8, 26, color, 0.5 * k);
}

export function drawHeld(ctx: CanvasRenderingContext2D, h: HeldProp, color: string, rarity: number) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  switch (h.kind) {
    case "mag":
    case "oldmag": {
      ctx.globalAlpha *= h.k;
      ctx.translate(h.x, h.y);
      ctx.rotate(h.a + Math.PI / 2);
      ctx.fillStyle = "#2c3150";
      ctx.beginPath();
      ctx.roundRect(-2.6, -4, 5.2, 8, 1.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = h.kind === "mag" ? rarityHex(rarity) : "#4a5385";
      ctx.fillRect(-1.6, -3, 3.2, 1.6);
      break;
    }
    case "grenade": {
      ctx.translate(h.x, h.y);
      ctx.fillStyle = "#30364f";
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(-3.4, -0.8, 6.8, 1.6);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(-1.2, -1.4, 0.9, 0, Math.PI * 2);
      ctx.fill();
      drawGlow(ctx, 2, -3.6, 6, "#ffd34d", 0.7 + 0.3 * Math.sin(h.a * 3));
      break;
    }
    case "bandage": {
      ctx.translate(h.x, h.y);
      ctx.fillStyle = "#f4f2ff";
      ctx.beginPath();
      ctx.arc(0, -1, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#c9c6e6";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, -1, 1.6, h.a, h.a + 4.5);
      ctx.stroke();
      break;
    }
    case "medkit": {
      ctx.translate(h.x, h.y);
      const open = Math.min(1, Math.max(0, (h.k - 0.15) / 0.2));
      ctx.fillStyle = "#f4f2ff";
      ctx.beginPath();
      ctx.roundRect(-6, -4, 12, 9, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#3ee07f";
      ctx.fillRect(-1.1, -2.4, 2.2, 6);
      ctx.fillRect(-3, -0.5, 6, 2.2);
      ctx.save();
      ctx.translate(0, -4);
      ctx.scale(1, 1 - open * 1.6);
      ctx.fillStyle = "#dcd8f2";
      ctx.beginPath();
      ctx.roundRect(-6, -2.2, 12, 2.6, 1.2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (open > 0) drawGlow(ctx, 0, -4, 14, "#5dff9d", 0.6 * open);
      break;
    }
  }
  ctx.restore();
}

/** The bandage strip from the roll (off hand) to the main hand. */
export function drawBandageStrip(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number]) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.quadraticCurveTo((from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 3, to[0], to[1]);
  ctx.stroke();
  ctx.strokeStyle = "#f4f2ff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Rising green plus signs and a soft pulse while healing. */
export function drawHealFx(ctx: CanvasRenderingContext2D, u: number, time: number, seed: number) {
  drawGlow(ctx, 0, 4, 34, "#5dff9d", 0.18 + 0.1 * Math.sin(time * 8));
  for (let i = 0; i < 4; i++) {
    const p = (time * 0.9 + i / 4 + seed * 0.13) % 1;
    const x = (hash(i + seed) - 0.5) * 34;
    const y = 6 - p * 34;
    const a = Math.sin(p * Math.PI) * Math.min(1, u * 8);
    const s = 2.2 + hash(i * 3 + 1) * 1.2;
    drawGlow(ctx, x, y, 7, "#5dff9d", 0.5 * a);
    ctx.fillStyle = `rgba(190,255,215,${a})`;
    ctx.fillRect(x - s * 0.3, y - s, s * 0.6, s * 2);
    ctx.fillRect(x - s, y - s * 0.3, s * 2, s * 0.6);
  }
}

/** Landing: the ring shockwave in the player color plus two dust puffs. */
export function drawLandRing(ctx: CanvasRenderingContext2D, l: number, color: string) {
  const r = 14 + 46 * (1 - (1 - l) ** 2);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = withAlpha(color, 0.9 * (1 - l));
  ctx.lineWidth = 3 * (1 - l) + 0.5;
  ctx.beginPath();
  ctx.ellipse(0, 19, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawGlow(ctx, 0, 19, r * 0.9, color, 0.35 * (1 - l));
  for (const s of [-1, 1]) drawDust(ctx, s * (8 + l * 14), 19, l);
}

/** Falling streak above a dropping-in hero. */
export function drawDropStreak(ctx: CanvasRenderingContext2D, y: number, len: number, color: string, k: number) {
  const g = ctx.createLinearGradient(0, y - len, 0, y);
  g.addColorStop(0, withAlpha(color, 0));
  g.addColorStop(1, withAlpha(color, 0.6 * k));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.fillRect(-9, y - len, 18, len);
  ctx.restore();
}

/**
 * Death: a brief white pop, then neon shards flying out (player color, outfit, hair, white)
 * and a translucent ghost of the hero floating up and fading. `u` is deathT (>= 0.1 here).
 */
export function drawDeath(ctx: CanvasRenderingContext2D, id: HeroId, color: string, b: number, mirror: boolean, u: number, seed: number) {
  const def = HEROES[id];
  const cols = [color, def.palette.outfit, def.palette.hair, "#ffffff", color, def.palette.accent];
  const e = 1 - (1 - Math.min(1, u * 1.4)) ** 3;
  const fade = 1 - Math.max(0, (u - 0.45) / 0.55);
  if (u < 0.4) {
    const l = u / 0.4;
    drawGlow(ctx, 0, -2, 30 + l * 40, color, 0.5 * (1 - l));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(color, 1 - l);
    ctx.lineWidth = 3 * (1 - l) + 0.5;
    ctx.beginPath();
    ctx.arc(0, -2, 14 + l * 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + hash(i + seed * 7) * 0.5;
    const d = (22 + hash(i * 5 + seed) * 46) * e;
    const x = Math.cos(a) * d;
    const y = -2 + Math.sin(a) * d * 0.8 + u * u * 18;
    const s = 2.4 + hash(i * 11 + seed) * 3.2;
    const c = cols[i % cols.length] ?? color;
    if (i % 2 === 0) drawGlow(ctx, x, y, s * 3.2, color, 0.55 * fade);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + u * (6 + hash(i) * 6) * (i % 2 ? 1 : -1));
    ctx.globalAlpha *= fade;
    ctx.fillStyle = c;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.5);
    ctx.lineTo(s * 1.2, 0);
    ctx.lineTo(-s * 0.6, s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = light(c, 0.5);
    ctx.fillRect(-s * 0.5, -s * 0.25, s * 0.6, s * 0.25);
    ctx.restore();
  }
  // The ghost.
  const g = Math.max(0, (u - 0.08) / 0.92);
  if (g > 0 && g < 1) {
    const rise = -38 * (1 - (1 - g) ** 2);
    const wob = Math.sin(g * 9) * 2.5;
    ctx.save();
    ctx.translate(wob, rise);
    if (mirror) ctx.scale(-1, 1);
    const ga = (1 - g) * 0.85;
    ctx.globalAlpha *= ga * 0.45;
    blit(ctx, bodySprite(id, b), 0, BODY_Y);
    blit(ctx, headSprite(id, b), 0, HEAD_Y);
    ctx.globalAlpha /= 0.45;
    ctx.globalAlpha *= 0.55;
    ctx.globalCompositeOperation = "lighter";
    blit(ctx, rimSprite(id, color, b), 0, 0);
    ctx.restore();
    drawGlow(ctx, wob, rise - 6, 40, shade(color, 0.1), 0.3 * (1 - g));
  }
}
