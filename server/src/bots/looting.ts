// What bots want from the floor and their bags: which loot is worth walking to (better guns
// by tier and rarity, ammo for the guns they carry, heals when hurt, armor, throwables,
// shards), when to press F on a weapon, which gun suits the current range, and when to heal.

import {
  BOTS, interactTarget, ITEMS, LOOT, magSize, pickHeal, PLAYER, weaponRange, WEAPONS,
  type Loot, type Player, type WeaponId, type WeaponItem, type World,
} from "@prism/shared";

export const gunScore = (id: WeaponId, rarity: number) => BOTS.weaponTier[id] + rarity * BOTS.rarityValue;

export { weaponRange };

/** Score of the weakest gun held (−1 for an empty slot). */
export function worstGunScore(me: Player): number {
  return me.inv.weapons.reduce((m, g) => Math.min(m, g ? gunScore(g.id, g.rarity) : -1), 99);
}

/** How well armed a bot is, 0 (spawn pistol only) .. ~1 (two good guns). */
export function armedLevel(me: Player): number {
  let best = 0;
  for (const g of me.inv.weapons) if (g) best = Math.max(best, gunScore(g.id, g.rarity));
  return Math.min(1, best / 4.5);
}

/** How much a bot wants a loot item right now (0 = ignore). */
export function lootValue(me: Player, l: Loot): number {
  const inv = me.inv;
  switch (l.kind) {
    case "weapon": {
      const v = gunScore(l.weapon, l.rarity);
      if (inv.weapons.some((g) => g && g.id === l.weapon && g.rarity >= l.rarity)) return 0;
      return v > worstGunScore(me) + 0.3 ? 2 + v : 0;
    }
    case "ammo": {
      // Ammo matters for the guns we carry, most when they're running dry.
      let need = 0;
      for (const g of inv.weapons) {
        if (!g || WEAPONS[g.id].infinite) continue;
        const mags = (g.reserve + g.mag) / Math.max(1, magSize(g));
        if (mags < 3) need = Math.max(need, 3 - mags);
      }
      return need > 0 ? 1 + need : 0;
    }
    case "bandage":
      return inv.bandages < ITEMS.bandage.max ? 1.1 + (me.hp < PLAYER.maxHp * 0.7 ? 1 : 0) - inv.bandages * 0.06 : 0;
    case "medkit":
      return inv.medkits < ITEMS.medkit.max ? 1.8 + (me.hp < PLAYER.maxHp * 0.5 ? 1.5 : 0) - inv.medkits * 0.3 : 0;
    case "shield":
      return me.armor < ITEMS.shield.max ? 2.4 + (me.armor <= 0 ? 0.6 : 0) : 0;
    case "throwable":
      return (!inv.throwable || inv.throwable === l.throwable) && inv.throws < ITEMS.throwMax ? 1.2 : 0;
    case "shard":
      return 4;
    default:
      return 0;
  }
}

/**
 * The best loot within reach (value discounted by distance). `smarts` < 1 adds noise to the
 * judgement (easy bots grab whatever); `noise` is a per-bot stable random in [0, 1).
 */
export function pickLoot(
  w: World, me: Player, range: number = BOTS.lootRange, smarts = 1, noise: (id: number) => number = () => 0.5, skip: (id: number) => boolean = () => false,
): Loot | null {
  let best: Loot | null = null;
  let bs = 0;
  w.lootIndex.near(me.x, me.y, range, (l) => {
    if (skip(l.id)) return;
    let v = lootValue(me, l);
    if (v <= 0) return;
    v *= smarts + (1 - smarts) * 2 * noise(l.id);
    const d = Math.hypot(l.x - me.x, l.y - me.y);
    if (d > range) return;
    const s = v / (1 + d / 250);
    if (s > bs) {
      bs = s;
      best = l;
    }
  });
  return best;
}

/** Should the bot press F this tick? (A better weapon is in interact reach.) */
export function wantsInteract(w: World, me: Player): boolean {
  const t = interactTarget(w, me);
  if (!t || t.kind !== "weapon") return false;
  return Math.hypot(t.x - me.x, t.y - me.y) < LOOT.interactRange && lootValue(me, t) > 0;
}

/** The slot holding the weakest gun (what F should replace). */
export function worstSlot(me: Player): number {
  const [a, b] = me.inv.weapons;
  if (!a || !b) return me.inv.active;
  return gunScore(a.id, a.rarity) <= gunScore(b.id, b.rarity) ? 0 : 1;
}

/** Which slot holds the better gun for fighting at distance d (null = keep the current one). */
export function bestSlotFor(me: Player, d: number): number | null {
  let best = me.inv.active;
  let bs = -Infinity;
  for (let i = 0; i < me.inv.weapons.length; i++) {
    const g: WeaponItem | null | undefined = me.inv.weapons[i];
    if (!g) continue;
    const empty = !WEAPONS[g.id].infinite && g.mag <= 0 && g.reserve <= 0;
    const r = weaponRange(g.id);
    const fit = d <= r ? 2 : -Math.min(3, (d - r) / 200);
    // A shotgun or blade is wasted at range; a sniper is clumsy point-blank.
    const close = g.id === "sniper" && d < 220 ? -1.5 : g.id === "rocket" && d < 200 ? -2 : 0;
    // Prefer the gun that's loaded over one that would need a reload mid-fight.
    const loaded = g.mag > 0 || WEAPONS[g.id].mag === 0 ? 0.6 : 0;
    const s = empty ? -10 : gunScore(g.id, g.rarity) + fit + close + loaded + (i === me.inv.active ? 0.4 : 0);
    if (s > bs) {
      bs = s;
      best = i;
    }
  }
  return best === me.inv.active ? null : best;
}

/** Heal now? Only with something to heal with, below the threshold. */
export function wantsHeal(me: Player, below: number): boolean {
  return me.hp < below && pickHeal(me) !== null;
}
