// Hover cars, crates and explosive barrels. Their bodies are cached sprites (a handful of
// shapes shared by every instance); the live part is cheap: underglow, headlight and hazard
// glows, damage cracks and the flashing barrel lamp. Also the shard colors used when a
// destructible breaks (for the particle bursts in fx/events.ts).

import { RARITY, type Solid } from "@prism/shared";
import { drawGlow, mix, withAlpha } from "../glow";
import { canvas } from "./rand";

const CAR_COLORS = ["#FF2E88", "#00F0FF", "#FFC83D", "#A970FF", "#9DFF3A"];
const SPRITE_RES = 2;
const sprites = new Map<string, HTMLCanvasElement>();

function sprite(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const hit = sprites.get(key);
  if (hit) return hit;
  const [c, g] = canvas(w * SPRITE_RES, h * SPRITE_RES);
  g.scale(SPRITE_RES, SPRITE_RES);
  paint(g);
  sprites.set(key, c);
  return c;
}

/** Crate tier from its variant: 0 wooden, 1 rare metal, 2 epic metal. */
export const crateTier = (s: Solid) => (s.variant > 0.92 ? 2 : s.variant > 0.6 ? 1 : 0);

// ---- cars -------------------------------------------------------------------------------

function paintCar(g: CanvasRenderingContext2D, L: number, W: number, col: string) {
  const body = mix(col, "#10122e", 0.72);
  const pad = 6;
  g.translate(L / 2 + pad, W / 2 + pad);
  // Hull: tapered nose (+x) and a squarer tail.
  g.beginPath();
  g.moveTo(-L / 2 + 10, -W / 2 + 4);
  g.lineTo(L / 2 - 26, -W / 2 + 2);
  g.quadraticCurveTo(L / 2, -W / 2 + 8, L / 2, 0);
  g.quadraticCurveTo(L / 2, W / 2 - 8, L / 2 - 26, W / 2 - 2);
  g.lineTo(-L / 2 + 10, W / 2 - 4);
  g.quadraticCurveTo(-L / 2, W / 2 - 4, -L / 2, W / 2 - 14);
  g.lineTo(-L / 2, -W / 2 + 14);
  g.quadraticCurveTo(-L / 2, -W / 2 + 4, -L / 2 + 10, -W / 2 + 4);
  g.closePath();
  const grad = g.createLinearGradient(0, -W / 2, 0, W / 2);
  grad.addColorStop(0, mix(body, "#ffffff", 0.18));
  grad.addColorStop(0.5, body);
  grad.addColorStop(1, mix(body, "#000000", 0.35));
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = col;
  g.stroke();
  // Side neon skirts.
  g.fillStyle = withAlpha(col, 0.9);
  g.fillRect(-L / 2 + 14, -W / 2 + 5, L - 46, 2.5);
  g.fillRect(-L / 2 + 14, W / 2 - 7.5, L - 46, 2.5);
  // Hood lines.
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(L * 0.2, -W * 0.22);
  g.lineTo(L / 2 - 12, -W * 0.14);
  g.moveTo(L * 0.2, W * 0.22);
  g.lineTo(L / 2 - 12, W * 0.14);
  g.stroke();
  // Cabin glass: windshield, roof, rear window.
  const cg = g.createLinearGradient(-L * 0.2, 0, L * 0.25, 0);
  cg.addColorStop(0, "#0b1030");
  cg.addColorStop(1, "#24346e");
  g.fillStyle = cg;
  g.beginPath();
  g.moveTo(L * 0.2, -W / 2 + 11);
  g.quadraticCurveTo(L * 0.28, 0, L * 0.2, W / 2 - 11);
  g.lineTo(-L * 0.26, W / 2 - 12);
  g.quadraticCurveTo(-L * 0.31, 0, -L * 0.26, -W / 2 + 12);
  g.closePath();
  g.fill();
  g.fillStyle = mix(body, "#ffffff", 0.08);
  g.beginPath();
  g.roundRect(-L * 0.14, -W / 2 + 15, L * 0.22, W - 30, 6);
  g.fill();
  g.fillStyle = "rgba(200,240,255,0.35)";
  g.beginPath();
  g.moveTo(L * 0.12, -W / 2 + 14);
  g.lineTo(L * 0.18, -W / 2 + 14);
  g.lineTo(L * 0.1, W / 2 - 18);
  g.lineTo(L * 0.06, W / 2 - 18);
  g.closePath();
  g.fill();
  // Lights: headlights at the nose, a tail light bar, a little spoiler.
  g.fillStyle = "#eaffff";
  g.beginPath();
  g.roundRect(L / 2 - 12, -W / 2 + 9, 7, 11, 3);
  g.roundRect(L / 2 - 12, W / 2 - 20, 7, 11, 3);
  g.fill();
  g.fillStyle = "#ff3354";
  g.fillRect(-L / 2 + 2, -W / 2 + 12, 4, W - 24);
  g.fillStyle = mix(body, "#000000", 0.4);
  g.fillRect(-L / 2 + 8, -W / 2 + 8, 6, W - 16);
}

export function drawCar(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const horiz = w >= h;
  const L = Math.max(w, h);
  const W = Math.min(w, h);
  const ci = Math.floor(s.variant * CAR_COLORS.length);
  const col = CAR_COLORS[ci] ?? "#00F0FF";
  const flip = (s.variant * 37) % 1 > 0.5;
  const ang = (horiz ? 0 : Math.PI / 2) + (flip ? Math.PI : 0);
  const cx = s.x0 + w / 2;
  const cy = s.y0 + h / 2;
  const bob = Math.sin(time * 2.2 + s.variant * 30) * 1.4;
  // Hover shadow and underglow.
  ctx.fillStyle = "rgba(0,0,10,0.45)";
  ctx.beginPath();
  ctx.ellipse(cx + 8, cy + 12, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  drawGlow(ctx, cx, cy + 4, L * 0.62, col, 0.32 + 0.1 * Math.sin(time * 3 + ci), 0.05);
  const img = sprite(`car|${ci}|${L}|${W}`, L + 12, W + 12, (g) => paintCar(g, L, W, col));
  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.rotate(ang);
  ctx.drawImage(img, -L / 2 - 6, -W / 2 - 6, L + 12, W + 12);
  ctx.restore();
  // Headlight beams out of the nose.
  const nx = cx + Math.cos(ang) * (L / 2 + 10);
  const ny = cy + Math.sin(ang) * (L / 2 + 10) + bob;
  drawGlow(ctx, nx, ny, 34, "#bff6ff", 0.35, 0.1);
}

// ---- crates -----------------------------------------------------------------------------

function paintWoodCrate(g: CanvasRenderingContext2D, w: number, h: number, trim: string) {
  g.fillStyle = "#3a2418";
  g.fillRect(0, 0, w, h);
  const boards = 4;
  for (let i = 0; i < boards; i++) {
    const y = 5 + (i * (h - 10)) / boards;
    g.fillStyle = i % 2 ? "#7a5034" : "#6c4630";
    g.fillRect(5, y + 1, w - 10, (h - 10) / boards - 2);
    g.fillStyle = "rgba(255,220,170,0.1)";
    g.fillRect(5, y + 1, w - 10, 1.5);
  }
  // Diagonal brace and frame.
  g.strokeStyle = "#4a2e1e";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(7, h - 7);
  g.lineTo(w - 7, 7);
  g.stroke();
  g.strokeStyle = "rgba(255,210,160,0.15)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(7, h - 10);
  g.lineTo(w - 10, 7);
  g.stroke();
  g.strokeStyle = "#2a170e";
  g.lineWidth = 5;
  g.strokeRect(2.5, 2.5, w - 5, h - 5);
  // Metal corner brackets in the rarity color.
  g.fillStyle = trim;
  for (const [x, y] of [[0, 0], [w - 10, 0], [0, h - 10], [w - 10, h - 10]] as const) {
    g.fillRect(x, y, 10, 3);
    g.fillRect(x + (x ? 7 : 0), y, 3, 10);
  }
  g.fillStyle = "rgba(0,0,0,0.4)";
  for (const [x, y] of [[8, 8], [w - 9, 8], [8, h - 9], [w - 9, h - 9]] as const) g.fillRect(x, y, 2, 2);
}

function paintMetalCrate(g: CanvasRenderingContext2D, w: number, h: number, trim: string) {
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#3c4466");
  grad.addColorStop(1, "#1e2340");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let x = 9; x < w - 6; x += 9) g.fillRect(x, 6, 2, h - 12);
  g.strokeStyle = "#141830";
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  g.strokeStyle = trim;
  g.lineWidth = 2.5;
  g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = trim;
  g.fillRect(0, h / 2 - 3, w, 6);
  // Emblem: a prism diamond.
  g.fillStyle = "#141830";
  g.beginPath();
  g.moveTo(w / 2, h / 2 - 11);
  g.lineTo(w / 2 + 11, h / 2);
  g.lineTo(w / 2, h / 2 + 11);
  g.lineTo(w / 2 - 11, h / 2);
  g.closePath();
  g.fill();
  g.fillStyle = trim;
  g.beginPath();
  g.moveTo(w / 2, h / 2 - 7);
  g.lineTo(w / 2 + 7, h / 2);
  g.lineTo(w / 2, h / 2 + 7);
  g.lineTo(w / 2 - 7, h / 2);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.fillRect(w / 2 - 2, h / 2 - 4, 2, 3);
}

export function drawCrate(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const tier = crateTier(s);
  const trim = RARITY[tier]?.color ?? "#B8C0D8";
  ctx.fillStyle = "rgba(0,0,10,0.4)";
  ctx.fillRect(s.x0 + 5, s.y0 + 8, w, h);
  if (tier > 0) drawGlow(ctx, s.x0 + w / 2, s.y0 + h / 2, w * (tier > 1 ? 1.5 : 1.1), trim, (tier > 1 ? 0.35 : 0.2) + 0.08 * Math.sin(time * 3 + s.variant * 50), 0.05);
  const img = sprite(`crate|${tier}|${w}|${h}`, w, h, (g) => (tier ? paintMetalCrate(g, w, h, trim) : paintWoodCrate(g, w, h, trim)));
  ctx.drawImage(img, s.x0, s.y0, w, h);
}

// ---- barrels ----------------------------------------------------------------------------

function paintBarrel(g: CanvasRenderingContext2D, d: number) {
  const r = d / 2;
  g.translate(r, r);
  const body = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  body.addColorStop(0, "#d8452a");
  body.addColorStop(0.7, "#8e1f14");
  body.addColorStop(1, "#4a0d08");
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  // Hazard ring: yellow and black segments.
  const segs = 12;
  g.lineWidth = r * 0.2;
  for (let i = 0; i < segs; i++) {
    g.strokeStyle = i % 2 ? "#15121c" : "#ffd34d";
    g.beginPath();
    g.arc(0, 0, r * 0.74, (i / segs) * Math.PI * 2, ((i + 1) / segs) * Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = "#2a0806";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, r - 1, 0, Math.PI * 2);
  g.stroke();
  // Lid with a flame warning mark and a cap.
  g.fillStyle = "#6e1810";
  g.beginPath();
  g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffd34d";
  g.beginPath();
  g.moveTo(0, -r * 0.36);
  g.quadraticCurveTo(r * 0.3, -r * 0.05, r * 0.16, r * 0.26);
  g.quadraticCurveTo(0, r * 0.36, -r * 0.16, r * 0.26);
  g.quadraticCurveTo(-r * 0.3, -r * 0.05, 0, -r * 0.36);
  g.fill();
  g.fillStyle = "#6e1810";
  g.beginPath();
  g.arc(0, r * 0.1, r * 0.1, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.beginPath();
  g.ellipse(-r * 0.45, -r * 0.45, r * 0.25, r * 0.12, -0.8, 0, Math.PI * 2);
  g.fill();
}

export function drawBarrel(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  const d = Math.min(w, h);
  const cx = s.x0 + w / 2;
  const cy = s.y0 + h / 2;
  const dmg = s.maxHp > 0 ? 1 - s.hp / s.maxHp : 0;
  const rate = 4 + dmg * 14;
  drawGlow(ctx, cx, cy, d * 1.4, "#ff6a2b", 0.3 + 0.15 * Math.sin(time * rate + s.variant * 9) + dmg * 0.25, 0.05);
  ctx.fillStyle = "rgba(0,0,10,0.45)";
  ctx.beginPath();
  ctx.ellipse(cx + 5, cy + 8, d * 0.52, d * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(sprite(`barrel|${d}`, d, d, (g) => paintBarrel(g, d)), s.x0 + (w - d) / 2, s.y0 + (h - d) / 2, d, d);
  if (dmg > 0.05 && Math.sin(time * rate) > 0.2) drawGlow(ctx, cx, cy + d * 0.05, d * 0.35, "#ffe08a", 0.6, 0.3);
}

// ---- damage and breaking ----------------------------------------------------------------

export function drawCracks(ctx: CanvasRenderingContext2D, s: Solid, dmg: number) {
  const w = s.x1 - s.x0;
  const h = s.y1 - s.y0;
  ctx.strokeStyle = `rgba(255,255,255,${0.3 + dmg * 0.5})`;
  ctx.lineWidth = 1.4;
  const n = Math.ceil(dmg * 5);
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = s.variant * 13 + k * 2.4;
    const x = s.x0 + w * (0.5 + 0.38 * Math.cos(a));
    const y = s.y0 + h * (0.5 + 0.38 * Math.sin(a * 1.3));
    ctx.moveTo(s.x0 + w / 2, s.y0 + h / 2);
    ctx.lineTo((x + s.x0 + w / 2) / 2 + 4, (y + s.y0 + h / 2) / 2 - 3);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Shard colors for a destructible's break burst (first color is the main one). */
export function breakColors(s: Solid): string[] {
  switch (s.kind) {
    case "crate": {
      const tier = crateTier(s);
      const trim = RARITY[tier]?.color ?? "#B8C0D8";
      return tier ? ["#4a5378", trim, "#2a2f4a", "#ffffff"] : ["#8a5a34", "#c48a52", "#5a3a26", trim];
    }
    case "glass":
      return ["#bff4ff", "#8fe7ff", "#ffffff"];
    case "barrel":
      return ["#ff8a2b", "#ffd34d", "#3a0e0a"];
    case "fence":
      return ["#ff2e88", "#8a90c0", "#2c3068"];
    case "car":
      return [CAR_COLORS[Math.floor(s.variant * CAR_COLORS.length)] ?? "#00F0FF", "#1c1f44"];
    default:
      return ["#8fe7ff"];
  }
}
