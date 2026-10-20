// Item art, all drawn in code: weapon silhouettes (held in hand, lying on the floor, and as
// HUD / kill-feed icons), heal / shield / ammo / grenade / shard icons, and floor loot with a
// rarity glow and a name label when you're close.

import { ITEMS, RARITY, WEAPONS, type LootKind, type NetLoot, type ThrowableId, type WeaponId } from "@prism/shared";
import { drawGlow, rainbow, withAlpha } from "./glow";

export const rarityColor = (r: number): string => RARITY[r]?.color ?? RARITY[0].color;

type Shape = [number, number, number, number][];

/** Weapon silhouettes in "hand units": the grip sits at the origin and the barrel points along +x. */
const SHAPES: Record<WeaponId, { body: Shape; accent: Shape; muzzle: number }> = {
  pistol: { body: [[-4, -4, 22, 8], [-2, 2, 7, 9]], accent: [[14, -2, 6, 4]], muzzle: 20 },
  smg: { body: [[-8, -5, 32, 10], [0, 4, 6, 10], [12, 4, 5, 8]], accent: [[22, -2, 8, 4], [-12, -3, 5, 6]], muzzle: 30 },
  rifle: { body: [[-14, -4, 46, 8], [-2, 3, 6, 10], [12, 3, 5, 9]], accent: [[30, -2, 10, 4], [4, -7, 14, 3]], muzzle: 40 },
  shotgun: { body: [[-14, -5, 44, 10], [-2, 4, 7, 9]], accent: [[16, 4, 12, 4], [30, -4, 6, 8]], muzzle: 36 },
  sniper: { body: [[-16, -3, 58, 6], [-4, 2, 6, 10]], accent: [[2, -9, 18, 5], [40, -2, 12, 4]], muzzle: 52 },
  rocket: { body: [[-18, -7, 52, 14], [-2, 6, 7, 9]], accent: [[30, -9, 8, 18], [-22, -6, 6, 12]], muzzle: 38 },
  lance: { body: [[-10, -4, 50, 8], [-2, 3, 6, 9]], accent: [[20, -7, 4, 14], [34, -6, 6, 12], [6, -6, 4, 12]], muzzle: 44 },
  blade: { body: [[-6, -3, 12, 6]], accent: [[6, -5, 3, 10], [9, -2, 50, 4]], muzzle: 58 },
};

export const muzzleLength = (id: WeaponId) => SHAPES[id].muzzle;

/** Draws a weapon (origin at the grip, barrel along +x). `glow` is the accent color. */
export function drawWeapon(ctx: CanvasRenderingContext2D, id: WeaponId, rarity: number, scale = 1, time = 0) {
  const s = SHAPES[id];
  const col = rarityColor(rarity);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";
  ctx.fillStyle = "#353c70";
  ctx.strokeStyle = "rgba(5,4,13,0.95)";
  ctx.lineWidth = 3;
  for (const [x, y, w, h] of s.body) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 2.5);
    ctx.stroke();
    ctx.fill();
  }
  ctx.fillStyle = "#5a64a8";
  for (const [x, y, w] of s.body) ctx.fillRect(x + 1.5, y + 1.2, Math.max(0, w - 3), 1.6);
  if (id === "blade") {
    // An energy edge that hums.
    const k = 0.75 + 0.25 * Math.sin(time * 18);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = withAlpha(col, 0.35 * k);
    ctx.fillRect(8, -6, 54, 12);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.fillStyle = id === "lance" ? (rarity >= 3 ? rainbow(time * 0.5) : col) : col;
  for (const [x, y, w, h] of s.accent) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 1.5);
    ctx.fill();
  }
  if (id === "blade") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(10, -1, 48, 2);
  }
  ctx.restore();
}

// ---- icons -----------------------------------------------------------------------------------

const iconCache = new Map<string, HTMLCanvasElement>();

function cached(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const k = `${key}|${w}|${h}|${dpr}`;
  let c = iconCache.get(k);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext("2d");
  if (g) {
    g.scale(dpr, dpr);
    draw(g);
  }
  iconCache.set(k, c);
  return c;
}

/** A weapon icon sized w×h (for the HUD slots and kill feed). */
export function weaponIcon(id: WeaponId, rarity: number, w: number, h: number): HTMLCanvasElement {
  return cached(`w:${id}:${rarity}`, w, h, (g) => {
    const s = SHAPES[id];
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const [x, , ww] of [...s.body, ...s.accent]) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + ww);
    }
    const sc = Math.min((w * 0.86) / (x1 - x0), h / 26);
    g.translate(w / 2 - ((x0 + x1) / 2) * sc, h / 2);
    drawWeapon(g, id, rarity, sc);
  });
}

export function itemColor(kind: LootKind, throwable: ThrowableId = "frag"): string {
  switch (kind) {
    case "bandage":
      return "#7dffb0";
    case "medkit":
      return "#5dff9d";
    case "shield":
      return "#5fd0ff";
    case "ammo":
      return "#ffd34d";
    case "throwable":
      return ITEMS.throwables[throwable].color;
    case "shard":
      return "#ff7bf2";
    default:
      return "#ffffff";
  }
}

/** Small item glyph centered at (0, 0) with radius r. */
export function drawItemGlyph(ctx: CanvasRenderingContext2D, kind: LootKind, r: number, throwable: ThrowableId = "frag", time = 0) {
  const col = itemColor(kind, throwable);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(5,4,13,0.95)";
  ctx.lineWidth = r * 0.28;
  ctx.fillStyle = col;
  ctx.beginPath();
  if (kind === "bandage") {
    ctx.roundRect(-r, -r * 0.42, r * 2, r * 0.84, r * 0.4);
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-r * 0.3, -r * 0.3, r * 0.6, r * 0.6);
  } else if (kind === "medkit") {
    ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, r * 0.3);
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-r * 0.15, -r * 0.55, r * 0.3, r * 1.1);
    ctx.fillRect(-r * 0.55, -r * 0.15, r * 1.1, r * 0.3);
  } else if (kind === "shield") {
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.85, -r * 0.55);
    ctx.lineTo(r * 0.7, r * 0.4);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.7, r * 0.4);
    ctx.lineTo(-r * 0.85, -r * 0.55);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(-r * 0.1, -r * 0.6, r * 0.2, r * 1.1);
  } else if (kind === "ammo") {
    ctx.roundRect(-r, -r * 0.7, r * 2, r * 1.4, r * 0.2);
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = "#3a2a00";
    for (let i = 0; i < 3; i++) ctx.fillRect(-r * 0.65 + i * r * 0.5, -r * 0.45, r * 0.3, r * 0.9);
  } else if (kind === "throwable") {
    ctx.arc(0, r * 0.15, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = "#151830";
    ctx.fillRect(-r * 0.25, -r * 0.95, r * 0.5, r * 0.4);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-r * 0.25, -r * 0.05, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "shard") {
    ctx.fillStyle = rainbow(time * 0.6);
    ctx.moveTo(0, -r * 1.1);
    ctx.lineTo(r * 0.7, 0);
    ctx.lineTo(0, r * 1.1);
    ctx.lineTo(-r * 0.7, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.8);
    ctx.lineTo(r * 0.25, 0);
    ctx.lineTo(0, r * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** An item glyph as a cached canvas (HUD counters). */
export function itemIcon(kind: LootKind, size: number, throwable: ThrowableId = "frag"): HTMLCanvasElement {
  return cached(`i:${kind}:${throwable}`, size, size, (g) => {
    g.translate(size / 2, size / 2);
    drawItemGlyph(g, kind, size * 0.36, throwable);
  });
}

export function lootName(l: Pick<NetLoot, "kind" | "weapon" | "rarity" | "throwable" | "count">): string {
  switch (l.kind) {
    case "weapon":
      return `${RARITY[l.rarity]?.name ?? ""} ${WEAPONS[l.weapon].name}`;
    case "throwable":
      return `${ITEMS.throwables[l.throwable].name}${l.count > 1 ? ` ×${l.count}` : ""}`;
    case "bandage":
      return `Bandage${l.count > 1 ? ` ×${l.count}` : ""}`;
    case "medkit":
      return "Medkit";
    case "shield":
      return "Shield Cell";
    case "ammo":
      return "Ammo";
    case "shard":
      return "Prism Shard";
    default:
      return "";
  }
}

/** Floor loot: a soft glow in the item's rarity/kind color, a bobbing item, a ring when targeted. */
export function drawLoot(ctx: CanvasRenderingContext2D, l: NetLoot, time: number, targeted: boolean) {
  const col = l.kind === "weapon" ? rarityColor(l.rarity) : itemColor(l.kind, l.throwable);
  const bob = Math.sin(time * 2.6 + l.id) * 2.5;
  const big = l.kind === "weapon" ? 1 + l.rarity * 0.18 : 0.8;
  drawGlow(ctx, l.x, l.y, 42 * big, col, l.kind === "weapon" && l.rarity >= 2 ? 0.85 : 0.55);
  if (l.kind === "weapon" && l.rarity >= 3) drawGlow(ctx, l.x, l.y, 70, col, 0.25 + 0.15 * Math.sin(time * 3));
  // Ground ring
  ctx.save();
  ctx.strokeStyle = withAlpha(col, targeted ? 0.95 : 0.45);
  ctx.lineWidth = targeted ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.ellipse(l.x, l.y + 8, 24, 10, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.translate(l.x, l.y - 4 + bob);
  if (l.kind === "weapon") {
    ctx.rotate(-0.35);
    const def = SHAPES[l.weapon];
    ctx.translate(-def.muzzle * 0.45, 0);
    drawWeapon(ctx, l.weapon, l.rarity, 0.95, time);
  } else drawItemGlyph(ctx, l.kind, 11, l.throwable, time);
  ctx.restore();
}

/** Floating name tag for the loot you're standing next to. */
export function drawLootLabel(ctx: CanvasRenderingContext2D, l: NetLoot, invScale: number, prompt: string | null) {
  const col = l.kind === "weapon" ? rarityColor(l.rarity) : itemColor(l.kind, l.throwable);
  const s = invScale;
  const text = lootName(l);
  ctx.save();
  ctx.font = `700 ${14 * s}px Rajdhani, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 20 * s;
  const y = l.y - 40;
  ctx.fillStyle = "rgba(8,7,26,0.85)";
  ctx.strokeStyle = withAlpha(col, 0.8);
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.roundRect(l.x - w / 2, y - 11 * s, w, 22 * s, 8 * s);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.fillText(text, l.x, y + 1 * s);
  if (prompt) {
    ctx.font = `800 ${11 * s}px "JetBrains Mono", monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(prompt, l.x, y - 20 * s);
  }
  ctx.restore();
}
