// Test-room helpers (F1 debug panel): hand a player a full kit to try every system quickly.

import { circleBlocked, ITEMS, newWeapon, PLAYER, type Player, type WeaponId, type World } from "@prism/shared";

const KIT: WeaponId[] = ["rifle", "shotgun", "sniper", "rocket", "lance", "blade", "smg"];

/** Gives a legendary gun (cycling through the arsenal), heals, a shield and grenades. */
export function debugLoadout(p: Player) {
  const cur = p.inv.weapons[1]?.id;
  const next = KIT[(KIT.indexOf(cur ?? "smg") + 1) % KIT.length] ?? "rifle";
  p.inv.weapons[1] = newWeapon(next, 3);
  p.inv.active = 1;
  p.inv.bandages = ITEMS.bandage.max;
  p.inv.medkits = ITEMS.medkit.max;
  p.inv.throwable = p.inv.throwable === "frag" ? "smoke" : p.inv.throwable === "smoke" ? "mine" : "frag";
  p.inv.throws = ITEMS.throwMax;
  p.armor = ITEMS.shield.max;
  p.reloadT = 0;
}

/** A free spot near (x, y): tries a widening spiral until the hitbox fits. */
function freeSpot(w: World, x: number, y: number, maxR = 400): { x: number; y: number } | null {
  for (let r = 0; r <= maxR; r += 24) {
    const n = r === 0 ? 1 : Math.ceil((Math.PI * 2 * r) / 30);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (!circleBlocked(w.map, px, py, PLAYER.radius + 2)) return { x: px, y: py };
    }
  }
  return null;
}

/** Inside the nearest roofed building (for testing roofs fading, interiors and LOS). */
export function debugBuildingSpot(w: World, p: Player): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const r of w.map.roofs) {
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const d = (cx - p.x) ** 2 + (cy - p.y) ** 2;
    if (d < bd) {
      const spot = freeSpot(w, cx, cy, Math.min(r.x1 - r.x0, r.y1 - r.y0) / 2 - PLAYER.radius);
      if (spot) {
        bd = d;
        best = spot;
      }
    }
  }
  return best;
}

/** A few steps from the nearest living enemy (for testing firefights). */
export function debugFightSpot(w: World, p: Player): { x: number; y: number } | null {
  let foe: Player | null = null;
  let bd = Infinity;
  for (const o of w.players.values()) {
    if (o === p || !o.alive) continue;
    const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      foe = o;
    }
  }
  if (!foe) return null;
  const a = Math.atan2(p.y - foe.y, p.x - foe.x);
  return freeSpot(w, foe.x + Math.cos(a) * 320, foe.y + Math.sin(a) * 320);
}
