// The loadout HUD: the two weapon slots (gun, rarity, magazine / reserve, reload progress)
// next to the minimap, and the "F — pick up …" prompt above the power bar.

import { magSize, RARITY, WEAPONS } from "@prism/shared";
import { capLabel } from "../input/input";
import { withAlpha } from "../render/glow";
import { lootName, rarityColor, weaponIcon } from "../render/items";
import { PAL } from "../render/palette";
import { clamp01, DISPLAY, font, keycap, MONO, outlined, panel, UIFONT } from "./hudKit";
import type { HudInput } from "./hudTypes";

export function drawWeapons(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
  const me = h.me;
  if (!me) return;
  const cw = 250 * u;
  const ch = 60 * u;
  const gap = 10 * u;
  const right = h.w - (196 + 24 + 20) * u;
  const x = right - cw;
  let y = h.h - 24 * u - ch * 2 - gap;
  const keys = [h.input.binds.slot1, h.input.binds.slot2];
  for (let i = 0; i < 2; i++) {
    const wpn = me.inv.weapons[i];
    const active = i === me.inv.active;
    const col = wpn ? rarityColor(wpn.rarity) : "#8a90c0";
    panel(ctx, x, y, cw, ch, 14 * u, {
      border: active ? withAlpha(col, 0.95) : "rgba(255,255,255,0.12)",
      borderWidth: active ? 2.5 : 1.5,
      glow: active && wpn ? withAlpha(col, 0.45) : undefined,
      fill: active ? "rgba(26,24,70,0.9)" : undefined,
    });
    keycap(ctx, capLabel(keys[i] ?? ""), x + 18 * u, y + ch / 2, u, active ? col : "#8a90c0");
    ctx.textBaseline = "middle";
    if (!wpn) {
      ctx.font = font(700, 13 * u, UIFONT);
      ctx.fillStyle = PAL.dim;
      ctx.textAlign = "left";
      ctx.fillText("EMPTY · find a weapon", x + 40 * u, y + ch / 2);
      y += ch + gap;
      continue;
    }
    const def = WEAPONS[wpn.id];
    ctx.globalAlpha = active ? 1 : 0.6;
    ctx.drawImage(weaponIcon(wpn.id, wpn.rarity, Math.round(78 * u), Math.round(34 * u)), x + 34 * u, y + 6 * u, 78 * u, 34 * u);
    ctx.textAlign = "left";
    ctx.font = font(800, 11 * u, DISPLAY);
    ctx.fillStyle = col;
    const reloading = active && me.reloadT > 0;
    if (!reloading) ctx.fillText(`${(RARITY[wpn.rarity]?.name ?? "").toUpperCase()} ${def.name.toUpperCase()}`.slice(0, 26), x + 38 * u, y + ch - 12 * u);
    // Magazine / reserve
    ctx.textAlign = "right";
    if (def.kind === "blade") {
      ctx.font = font(800, 20 * u, MONO);
      outlined(ctx, "∞", x + cw - 14 * u, y + 24 * u, "#ffffff", "rgba(5,4,13,0.8)", 4 * u);
    } else {
      const size = magSize(wpn);
      const lowAmmo = wpn.mag <= Math.max(1, size * 0.25);
      ctx.font = font(800, 24 * u, MONO);
      outlined(ctx, `${wpn.mag}`, x + cw - 64 * u, y + 24 * u, lowAmmo ? PAL.danger : "#ffffff", "rgba(5,4,13,0.8)", 4 * u);
      ctx.font = font(700, 13 * u, MONO);
      ctx.fillStyle = PAL.dim;
      ctx.textAlign = "left";
      ctx.fillText(`/ ${def.infinite ? "∞" : wpn.reserve}`, x + cw - 60 * u, y + 26 * u);
    }
    ctx.globalAlpha = 1;
    // Reload progress on the active card.
    if (active && me.reloadT > 0) {
      const p = clamp01(1 - me.reloadT / def.reload);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x + 14 * u, y + ch - 5 * u, cw - 28 * u, 3 * u);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 14 * u, y + ch - 5 * u, (cw - 28 * u) * p, 3 * u);
      ctx.font = font(800, 11 * u, DISPLAY);
      ctx.textAlign = "left";
      outlined(ctx, "RELOADING…", x + 38 * u, y + ch - 13 * u, "#ffffff", "rgba(5,4,13,0.85)", 3 * u);
    } else if (active && def.kind !== "blade" && wpn.mag === 0 && !def.infinite && wpn.reserve === 0) {
      ctx.font = font(800, 11 * u, DISPLAY);
      ctx.textAlign = "right";
      outlined(ctx, "NO AMMO", x + cw - 14 * u, y + ch - 14 * u, PAL.danger, "rgba(5,4,13,0.85)", 3 * u);
    }
    y += ch + gap;
  }
  // Swap hint under the cards.
  ctx.font = font(700, 11 * u, UIFONT);
  ctx.textAlign = "right";
  ctx.fillStyle = PAL.dim;
  ctx.fillText(`${capLabel(h.input.binds.reload)} RELOAD · ${capLabel(h.input.binds.swap)} SWITCH`, right, h.h - 12 * u);
}

/** "F — pick up Epic Shotgun" when standing next to a weapon (or another grenade type). */
export function drawPickupPrompt(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
  const l = h.interact;
  const me = h.me;
  if (!l || !me) return;
  const full = me.inv.weapons.every((w) => w);
  const verb = l.kind === "weapon" && full ? "Swap for" : "Pick up";
  const col = l.kind === "weapon" ? rarityColor(l.rarity) : "#ffffff";
  const text = `${verb} ${lootName(l)}`;
  ctx.font = font(800, 16 * u, UIFONT);
  const tw = ctx.measureText(text).width;
  const w = tw + 70 * u;
  const cx = h.w / 2;
  const y = h.h - 30 * u - 84 * u - 54 * u;
  const pulse = 0.5 + 0.5 * Math.sin(h.time * 5);
  panel(ctx, cx - w / 2, y - 18 * u, w, 36 * u, 18 * u, { border: withAlpha(col, 0.6 + 0.3 * pulse), glow: withAlpha(col, 0.3) });
  keycap(ctx, capLabel(h.input.binds.interact), cx - w / 2 + 22 * u, y, u, col);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = col;
  ctx.fillText(text, cx - w / 2 + 44 * u, y + 1);
}
