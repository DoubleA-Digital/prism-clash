// Test-room helpers (F1 debug panel): hand a player a full kit to try every system quickly.

import { ITEMS, newWeapon, type Player, type WeaponId } from "@prism/shared";

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
