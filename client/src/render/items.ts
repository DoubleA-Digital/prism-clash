// Item art, all drawn in code. Weapons use the same art the chibi heroes hold (render/chibi):
// lying on the floor with a rarity glow, and as HUD / kill-feed / how-to-play icons. Plus heal,
// shield, ammo, grenade and shard glyphs, and the name label when you're close.

import { ITEMS, RARITY, WEAPONS, type LootKind, type NetLoot, type ThrowableId, type WeaponId } from "@prism/shared";
import { drawWeaponIcon, drawWeaponItem } from "./chibi";
import { drawGlow, rainbow, withAlpha } from "./glow";

export const rarityColor = (r: number): string => RARITY[r]?.color ?? RARITY[0].color;

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

/** A weapon icon sized w×h (for the HUD slots and kill feed), cached per size and rarity. */
export function weaponIcon(id: WeaponId, rarity: number, w: number, h: number): HTMLCanvasElement {
  return cached(`w:${id}:${rarity}`, w, h, (g) => drawWeaponIcon(g, id, rarity, w / 2, h / 2, w, h));
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
  if (l.kind === "weapon") {
    drawWeaponItem(ctx, l.weapon, l.rarity, l.x, l.y, time);
    if (targeted) {
      ctx.save();
      ctx.strokeStyle = withAlpha(rarityColor(l.rarity), 0.95);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(l.x, l.y + 8, 30, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  const col = itemColor(l.kind, l.throwable);
  const bob = Math.sin(time * 2.6 + l.id) * 2.5;
  drawGlow(ctx, l.x, l.y, 34, col, 0.55);
  // Ground ring
  ctx.save();
  ctx.strokeStyle = withAlpha(col, targeted ? 0.95 : 0.45);
  ctx.lineWidth = targeted ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.ellipse(l.x, l.y + 8, 24, 10, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.translate(l.x, l.y - 4 + bob);
  drawItemGlyph(ctx, l.kind, 11, l.throwable, time);
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
  // Below the item, so it never covers the name tag of the fighter standing on it.
  const y = l.y + 30 + 11 * s;
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
    ctx.fillText(prompt, l.x, y + 21 * s);
  }
  ctx.restore();
}
