// What bots want from the floor and their bags: which loot is worth walking to, when to
// press F on a weapon, which gun suits the current range, and when to heal.

import { BOTS, interactTarget, ITEMS, LOOT, magSize, pickHeal, weaponRange, WEAPONS, type Loot, type Player, type WeaponId, type WeaponItem, type World } from "@prism/shared";

const TIER: Record<WeaponId, number> = { pistol: 0, smg: 2.2, rifle: 3, shotgun: 2.6, sniper: 2.5, rocket: 2.4, lance: 2.7, blade: 1.6 };

export const gunScore = (id: WeaponId, rarity: number) => TIER[id] + rarity * 1.1;

export { weaponRange };

/** How much a bot wants a loot item right now (0 = ignore). */
export function lootValue(me: Player, l: Loot): number {
  const inv = me.inv;
  switch (l.kind) {
    case "weapon": {
      const worst = inv.weapons.reduce((m, g) => Math.min(m, g ? gunScore(g.id, g.rarity) : -1), 99);
      const v = gunScore(l.weapon, l.rarity);
      if (inv.weapons.some((g) => g && g.id === l.weapon && g.rarity >= l.rarity)) return 0;
      return v > worst + 0.3 ? 2 + v : 0;
    }
    case "ammo":
      return inv.weapons.some((g) => g && !WEAPONS[g.id].infinite && g.reserve < magSize(g) * 2) ? 2.5 : 0;
    case "bandage":
      return inv.bandages < ITEMS.bandage.max ? 1.2 + (me.hp < 70 ? 1 : 0) : 0;
    case "medkit":
      return inv.medkits < ITEMS.medkit.max ? 1.8 + (me.hp < 50 ? 1.5 : 0) : 0;
    case "shield":
      return me.armor < ITEMS.shield.max ? 2.4 : 0;
    case "throwable":
      return (!inv.throwable || inv.throwable === l.throwable) && inv.throws < ITEMS.throwMax ? 1.2 : 0;
    case "shard":
      return 4;
    default:
      return 0;
  }
}

/** The best loot within reach (value discounted by distance). */
export function pickLoot(w: World, me: Player, range: number = BOTS.lootRange): Loot | null {
  let best: Loot | null = null;
  let bs = 0;
  w.lootIndex.near(me.x, me.y, range, (l) => {
    const v = lootValue(me, l);
    if (v <= 0) return;
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
    const fit = d <= weaponRange(g.id) ? 2 : -Math.min(3, (d - weaponRange(g.id)) / 200);
    const s = empty ? -10 : gunScore(g.id, g.rarity) + fit;
    if (s > bs) {
      bs = s;
      best = i;
    }
  }
  return best === me.inv.active ? null : best;
}

export function shouldHeal(me: Player, threatened: boolean): boolean {
  if (threatened || me.healKind) return !!me.healKind && !threatened;
  return me.hp < BOTS.healBelow && pickHeal(me) !== null;
}
