// Chunky chibi-scale weapons, all drawn in code. Each weapon has art (grip at the origin,
// barrel along +x), where the support hand goes, and a recoil profile. Art is cached per
// weapon x rarity; the rarity color lights the accent parts (gray, blue, purple, gold).

import { RARITY, WEAPON_IDS, type WeaponId } from "@prism/shared";
import { drawGlow, rainbow, withAlpha } from "../glow";
import { INK, cel, circle, light, poly, rrect, shade } from "./paint";

type Pt = readonly [number, number];

export interface WeaponArt {
  /** Muzzle distance from the grip along +x. */
  muzzle: number;
  /** Support-hand spot (weapon-local), or null for one-handed (blade). */
  off: Pt | null;
  /** Where the magazine sits (reload animation). */
  mag: Pt;
  /** Grip distance out from the chest pivot. */
  reach: number;
  /** Kick back (units), muzzle climb (rad), random jitter, body shove (units). */
  recoil: { kick: number; rot: number; jitter: number; body: number };
  /** Art bounds along x for caching and icons. */
  x0: number;
  x1: number;
}

export const WEAPON_ART: Record<WeaponId, WeaponArt> = {
  pistol: { muzzle: 14, off: [1.2, 3.4], mag: [1.2, 6], reach: 12, recoil: { kick: 3, rot: 0.32, jitter: 0, body: 0.4 }, x0: -4, x1: 15 },
  smg: { muzzle: 20, off: [10.5, 2.2], mag: [5.5, 7], reach: 8.5, recoil: { kick: 1.6, rot: 0.05, jitter: 1.4, body: 0.3 }, x0: -10, x1: 21 },
  rifle: { muzzle: 27, off: [13.5, 2], mag: [5.5, 7], reach: 6.5, recoil: { kick: 3.2, rot: 0.1, jitter: 0.3, body: 0.6 }, x0: -15, x1: 28 },
  shotgun: { muzzle: 25, off: [16, 3.4], mag: [6, 5], reach: 6, recoil: { kick: 6, rot: 0.34, jitter: 0, body: 1.6 }, x0: -16, x1: 26 },
  sniper: { muzzle: 37, off: [12, 1.8], mag: [3, 6], reach: 4, recoil: { kick: 9, rot: 0.42, jitter: 0, body: 2.6 }, x0: -18, x1: 38 },
  rocket: { muzzle: 26, off: [9, 6.5], mag: [-15, 0], reach: 2.5, recoil: { kick: 7, rot: 0.22, jitter: 0, body: 2.2 }, x0: -20, x1: 27 },
  lance: { muzzle: 27, off: [7.5, 2.4], mag: [2, 5], reach: 7, recoil: { kick: 4, rot: 0.12, jitter: 0, body: 0.8 }, x0: -10, x1: 28 },
  blade: { muzzle: 34, off: null, mag: [0, 0], reach: 10, recoil: { kick: 0, rot: 0, jitter: 0, body: 0 }, x0: -5, x1: 35 },
};

const METAL = "#2c3150";
const METAL_HI = "#4a5385";
const GRIP = "#1c1f36";

export const rarityHex = (r: number): string => RARITY[r]?.color ?? RARITY[0].color;

function part(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, r = 1.6) {
  cel(g, rrect(x, y, w, h, Math.min(r, h / 2, w / 2)), color, { dx: 0, dy: Math.min(1.4, h * 0.25), dark: shade(color, 0.3), line: 1.4 });
}

/** Lit accent strip in the rarity color (glows from Epic up). */
function accent(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, rarity: number) {
  g.save();
  if (rarity >= 2) {
    g.shadowColor = col;
    g.shadowBlur = rarity >= 3 ? 5 : 3;
  }
  g.fillStyle = col;
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(w, h) / 2);
  g.fill();
  g.restore();
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillRect(x + 0.6, y + 0.3, Math.max(0, w - 1.2), Math.min(0.8, h * 0.3));
}

/** Paints a weapon at the origin (grip), barrel along +x. */
export function paintWeapon(g: CanvasRenderingContext2D, id: WeaponId, rarity: number) {
  const col = rarityHex(rarity);
  g.lineJoin = "round";
  switch (id) {
    case "pistol":
      part(g, -1.8, -0.5, 4.6, 7.4, GRIP, 1.4);
      part(g, -3, -3.6, 16.5, 5.6, METAL, 1.8);
      accent(g, 3, -2.9, 8, 1.6, col, rarity);
      part(g, 12.2, -2.6, 2.2, 3.2, METAL_HI, 0.8);
      break;
    case "smg":
      part(g, -9.5, -2.2, 5, 4.4, GRIP, 1.2);
      part(g, 4.2, 1, 3.8, 8, METAL_HI, 1);
      part(g, -1, 0.5, 3.6, 6.6, GRIP, 1.2);
      part(g, -5, -3.8, 19, 6.6, METAL, 2);
      part(g, 13.5, -1.8, 6.5, 3.2, METAL_HI, 1);
      accent(g, -1, -3.1, 11, 1.7, col, rarity);
      break;
    case "rifle":
      part(g, -15, -3.4, 7, 7, GRIP, 2);
      part(g, 4, 1, 4, 7.6, METAL_HI, 1.2);
      part(g, -1.2, 0.6, 3.6, 6.4, GRIP, 1.2);
      part(g, -9, -3.2, 25, 6.2, METAL, 1.8);
      part(g, 15.5, -1.6, 12, 3, METAL_HI, 1);
      part(g, 10, 1.4, 7, 2.4, GRIP, 1);
      part(g, 1, -6.4, 9, 3, GRIP, 1.2);
      accent(g, 2, -5.8, 7, 1.6, col, rarity);
      accent(g, -6, -1.2, 9, 1.6, col, rarity);
      break;
    case "shotgun":
      part(g, -16, -3, 7, 6.6, "#5a3b2a", 2.2);
      part(g, -1.4, 0.8, 3.8, 6, GRIP, 1.2);
      part(g, -9.5, -3.6, 18, 6.6, METAL, 1.6);
      part(g, 8, -3.4, 17.5, 4, METAL_HI, 1.4);
      part(g, 12, 1, 9, 4, col, 1.6);
      part(g, 23.5, -4, 2.6, 5, METAL, 0.8);
      accent(g, -6, -2.6, 10, 1.6, col, rarity);
      break;
    case "sniper":
      part(g, -18, -3.2, 8, 6.8, GRIP, 2.2);
      part(g, -1.4, 0.6, 3.6, 6.6, GRIP, 1.2);
      part(g, 2, 1, 3, 5, METAL_HI, 1);
      part(g, -11, -2.8, 25, 5.4, METAL, 1.6);
      part(g, 13.5, -1.3, 21, 2.6, METAL_HI, 1);
      part(g, 33, -2.2, 4.6, 4.4, METAL, 1);
      part(g, -1, -8.2, 13, 4, GRIP, 1.8);
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 4;
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(12.2, -6.2, 1.2, 1.9, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      accent(g, -8, -1.4, 9, 1.6, col, rarity);
      break;
    case "rocket":
      part(g, -1.6, 4, 3.8, 6.2, GRIP, 1.2);
      part(g, 8, 4.4, 3.2, 4.4, GRIP, 1);
      part(g, -19.5, -4.8, 6, 9.6, METAL, 1.6);
      cel(g, rrect(-15, -5.6, 36, 11.2, 5.4), "#3f6b4a", { dx: 0, dy: 2.2, dark: shade("#3f6b4a", 0.35), line: 1.5 });
      part(g, 19.5, -6.6, 6.6, 13.2, METAL, 2.2);
      accent(g, 20.6, -5.4, 1.8, 10.8, col, rarity);
      accent(g, -9, -3.6, 18, 1.8, col, rarity);
      part(g, 0, -9.4, 5, 3.4, GRIP, 1);
      g.fillStyle = INK;
      g.beginPath();
      g.ellipse(26, 0, 1.2, 4.2, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case "lance": {
      part(g, -1.6, 0.6, 3.6, 6.4, GRIP, 1.2);
      part(g, -10, -3, 21, 6, "#d8dcf2", 2.6);
      accent(g, -6, -1.1, 12, 2, col, rarity);
      cel(g, poly([[10, -3], [17, -6.8], [18.4, -4.6], [13, -1.2]]), METAL, { dx: 0, dy: 0.6, line: 1.3 });
      cel(g, poly([[10, 3], [17, 6.8], [18.4, 4.6], [13, 1.2]]), METAL, { dx: 0, dy: 0.6, line: 1.3 });
      const crystal = poly([[14.5, 0], [20, -4.2], [28, 0], [20, 4.2]]);
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 6;
      g.fillStyle = col;
      g.fill(crystal);
      g.restore();
      g.fillStyle = light(col, 0.55);
      g.fill(poly([[16.5, -0.4], [20, -3], [24.5, -0.4]]));
      g.strokeStyle = INK;
      g.lineWidth = 1.3;
      g.stroke(crystal);
      break;
    }
    case "blade": {
      const edge = new Path2D();
      edge.moveTo(5.5, -2.6);
      edge.lineTo(30, -2.4);
      edge.quadraticCurveTo(35, 0, 30, 2.4);
      edge.lineTo(5.5, 2.6);
      edge.closePath();
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 7;
      g.fillStyle = withAlpha(col, 0.95);
      g.fill(edge);
      g.restore();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.roundRect(7, -0.9, 23, 1.8, 0.9);
      g.fill();
      g.strokeStyle = shade(col, 0.4);
      g.lineWidth = 0.9;
      g.stroke(edge);
      part(g, -4.6, -1.8, 8.4, 3.6, GRIP, 1.4);
      part(g, 3, -5, 3, 10, METAL_HI, 1.2);
      accent(g, 3.6, -3.4, 1.8, 6.8, col, rarity);
      cel(g, circle(-5, 0, 1.9), METAL_HI, { dx: 0.2, dy: 0.4, line: 1.2 });
      break;
    }
  }
}

// ---- cache --------------------------------------------------------------------------------

const RES = 3;
const wcache = new Map<string, HTMLCanvasElement>();
const BOX_Y = 11;

/** Cached weapon art; drawn at x = art.x0 - 3, y = -BOX_Y with width (x1 - x0 + 6), height 2 * BOX_Y. */
export function weaponCanvas(id: WeaponId, rarity: number): HTMLCanvasElement {
  const key = `${id}|${rarity}`;
  let c = wcache.get(key);
  if (c) return c;
  const a = WEAPON_ART[id];
  c = document.createElement("canvas");
  c.width = Math.ceil((a.x1 - a.x0 + 6) * RES);
  c.height = Math.ceil(BOX_Y * 2 * RES);
  const g = c.getContext("2d");
  if (g) {
    g.scale(RES, RES);
    g.translate(-(a.x0 - 3), BOX_Y);
    paintWeapon(g, id, rarity);
  }
  wcache.set(key, c);
  return c;
}

/** Draws cached weapon art at the current origin (grip), plus live energy glows. */
export function blitWeapon(ctx: CanvasRenderingContext2D, id: WeaponId, rarity: number, time: number, charge = 0) {
  const a = WEAPON_ART[id];
  ctx.drawImage(weaponCanvas(id, rarity), a.x0 - 3, -BOX_Y, a.x1 - a.x0 + 6, BOX_Y * 2);
  const col = id === "lance" && rarity >= 3 ? rainbow(time * 0.5) : rarityHex(rarity);
  if (id === "blade") drawGlow(ctx, 20, 0, 16, col, 0.16 + 0.06 * Math.sin(time * 18));
  else if (id === "lance") {
    drawGlow(ctx, 21, 0, 10 + charge * 22, col, 0.5 + charge * 0.5);
    if (charge > 0) drawGlow(ctx, 21, 0, 4 + charge * 8, "#ffffff", 0.9);
  } else if (rarity >= 3) drawGlow(ctx, a.muzzle * 0.4, 0, 18, col, 0.18 + 0.08 * Math.sin(time * 4));
}

/**
 * Floor loot: the weapon lying on the ground, bobbing, with a rarity glow pool, a ground ring
 * and sparkles for Legendary. (x, y) is the item's world position.
 */
export function drawWeaponItem(ctx: CanvasRenderingContext2D, id: WeaponId, rarity: number, x: number, y: number, t: number) {
  const col = rarityHex(rarity);
  const a = WEAPON_ART[id];
  const bob = Math.sin(t * 2.6 + x * 0.013) * 2;
  drawGlow(ctx, x, y, 30 + rarity * 7, col, 0.45 + rarity * 0.12);
  ctx.save();
  ctx.strokeStyle = withAlpha(col, 0.6);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 22 + rarity * 2, 8, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 16, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, y - 4 + bob);
  ctx.rotate(-0.32);
  const s = Math.min(1.35, 40 / (a.x1 - a.x0));
  ctx.scale(s, s);
  ctx.translate(-(a.x0 + a.x1) / 2, 0);
  blitWeapon(ctx, id, rarity, t);
  ctx.restore();
  if (rarity >= 3) {
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.7 + i / 3) % 1;
      const ang = i * 2.1 + t * 0.6;
      drawGlow(ctx, x + Math.cos(ang) * 18, y - 6 - p * 26, 6 * (1 - p), "#fff4c4", 0.9 * (1 - p));
    }
  }
}

/** HUD icon: the weapon fitted into a w x h box centered on (x, y), with a soft rarity glow. */
export function drawWeaponIcon(ctx: CanvasRenderingContext2D, id: WeaponId, rarity: number, x: number, y: number, w: number, h: number) {
  const a = WEAPON_ART[id];
  const s = Math.min((w * 0.9) / (a.x1 - a.x0 + 4), (h * 0.9) / 18);
  if (rarity > 0) drawGlow(ctx, x, y, Math.max(w, h) * 0.45, rarityHex(rarity), 0.25 + rarity * 0.08);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.translate(-(a.x0 + a.x1) / 2, 0);
  const c = weaponCanvas(id, rarity);
  ctx.drawImage(c, a.x0 - 3, -BOX_Y, a.x1 - a.x0 + 6, BOX_Y * 2);
  ctx.restore();
}

export const ALL_WEAPONS: readonly WeaponId[] = WEAPON_IDS;
