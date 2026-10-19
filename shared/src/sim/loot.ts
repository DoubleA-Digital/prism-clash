// Floor loot: seeded spawn tables per map region, crate drops, death piles and supply drops.
// Ammo, heals, shields, shards and stackable throwables are picked up by walking over them;
// weapons go into an empty slot automatically, otherwise F swaps with the gun in hand.

import { ITEMS, LOOT, SUPPLY, WEAPON_IDS, WEAPONS } from "../config";
import { magSize, newWeapon } from "./actions";
import { circleBlocked } from "./collision";
import { defineEffects } from "./hooks";
import type { LootTableId } from "./map/types";
import type { Loot, LootKind, Player, ThrowableId, WeaponId, WeaponItem } from "./types";
import { THROWABLE_IDS } from "./types";
import type { World } from "./world";

const CELL = 256;

/** Uniform spatial hash of loot items (they move only when created or picked up). */
export class LootIndex {
  private cells = new Map<number, Set<Loot>>();
  private key(x: number, y: number) {
    return (Math.floor(x / CELL) + 512) * 4096 + (Math.floor(y / CELL) + 512);
  }
  add(l: Loot) {
    const k = this.key(l.x, l.y);
    let s = this.cells.get(k);
    if (!s) this.cells.set(k, (s = new Set()));
    s.add(l);
  }
  remove(l: Loot) {
    this.cells.get(this.key(l.x, l.y))?.delete(l);
  }
  near(x: number, y: number, r: number, f: (l: Loot) => void) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
        const s = this.cells.get((cx + 512) * 4096 + (cy + 512));
        if (s) for (const l of s) if (!l.dead) f(l);
      }
    }
  }
}

export function createLoot(w: World, o: Partial<Loot> & { kind: LootKind; x: number; y: number }): Loot {
  const l: Loot = {
    id: w.id(), kind: o.kind, x: o.x, y: o.y, weapon: o.weapon ?? "pistol", rarity: o.rarity ?? 0, mag: o.mag ?? 0, reserve: o.reserve ?? 0,
    throwable: o.throwable ?? "frag", count: o.count ?? 1, dead: false,
  };
  w.loot.set(l.id, l);
  w.lootIndex.add(l);
  return l;
}

export function lootFromWeapon(w: World, item: WeaponItem, x: number, y: number): Loot {
  return createLoot(w, { kind: "weapon", x, y, weapon: item.id, rarity: item.rarity, mag: item.mag, reserve: item.reserve });
}

function pickRarity(w: World, weights: readonly number[]): number {
  const k = w.rng.weighted({ a: weights[0] ?? 0, b: weights[1] ?? 0, c: weights[2] ?? 0, d: weights[3] ?? 0 });
  return "abcd".indexOf(k);
}

/** Rolls one item from a loot table and drops it at (x, y). */
export function rollItem(w: World, table: LootTableId, x: number, y: number): Loot {
  const t = LOOT.tables[table];
  const kind = w.rng.weighted(t.items) as LootKind;
  if (kind === "weapon") {
    const id = w.rng.weighted(LOOT.weaponWeights) as WeaponId;
    const item = newWeapon(id, pickRarity(w, t.rarity));
    return lootFromWeapon(w, item, x, y);
  }
  if (kind === "throwable") return createLoot(w, { kind, x, y, throwable: w.rng.pick(THROWABLE_IDS), count: 1 + w.rng.int(2) });
  if (kind === "bandage") return createLoot(w, { kind, x, y, count: 2 + w.rng.int(2) });
  return createLoot(w, { kind, x, y, count: 1 });
}

/** A point near (x, y) that's clear of solids, spiraling outward for piles. */
function spot(w: World, x: number, y: number, i: number): { x: number; y: number } {
  if (i === 0 && !circleBlocked(w.map, x, y, LOOT.itemRadius)) return { x, y };
  for (let k = i; k < i + 24; k++) {
    const a = k * 2.399;
    const d = LOOT.scatter * Math.sqrt(k + 1) * 0.8;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (w.insideArena(px, py, LOOT.itemRadius)) return { x: px, y: py };
  }
  return { x, y };
}

export function spawnInitialLoot(w: World) {
  for (const s of w.map.lootSpots) if (w.rng.next() < LOOT.spotFill) rollItem(w, s.table, s.x, s.y);
}

export function dropFromCrate(w: World, x: number, y: number) {
  for (let i = 0; i < LOOT.crateRolls; i++) {
    const p = spot(w, x, y, i + 1);
    rollItem(w, "crate", p.x, p.y);
  }
}

/** The victim's whole loadout spills on the floor (the spawn pistol stays behind). */
export function dropLoadout(w: World, p: Player) {
  const items: ((x: number, y: number) => void)[] = [];
  for (const it of p.inv.weapons) {
    if (it && !(it.id === "pistol" && it.rarity === 0)) items.push((x, y) => lootFromWeapon(w, it, x, y));
  }
  const inv = p.inv;
  if (inv.throwable && inv.throws > 0) {
    const t = inv.throwable;
    const n = inv.throws;
    items.push((x, y) => createLoot(w, { kind: "throwable", x, y, throwable: t, count: n }));
  }
  if (inv.bandages > 0) {
    const n = inv.bandages;
    items.push((x, y) => createLoot(w, { kind: "bandage", x, y, count: n }));
  }
  for (let i = 0; i < inv.medkits; i++) items.push((x, y) => createLoot(w, { kind: "medkit", x, y }));
  if (p.armor >= ITEMS.shield.amount * 0.5) items.push((x, y) => createLoot(w, { kind: "shield", x, y }));
  items.push((x, y) => createLoot(w, { kind: "ammo", x, y }));
  items.forEach((make, i) => {
    const s = spot(w, p.x, p.y, i + 1);
    make(s.x, s.y);
  });
  inv.weapons = [null, null];
  inv.throwable = null;
  inv.throws = 0;
  inv.bandages = 0;
  inv.medkits = 0;
}

function took(w: World, p: Player, l: Loot) {
  l.dead = true;
  w.stat(p.id).looted++;
  w.emit({ t: "loot", by: p.id, kind: l.kind, weapon: l.weapon, rarity: l.rarity, x: l.x, y: l.y });
}

function weaponFromLoot(l: Loot): WeaponItem {
  return { id: l.weapon, rarity: l.rarity, mag: Math.min(l.mag, magSize({ id: l.weapon, rarity: l.rarity, mag: 0, reserve: 0 })), reserve: l.reserve };
}

/** Walk-over pickups. */
export function autoPickup(w: World, p: Player) {
  const reach = p.r + LOOT.itemRadius;
  w.lootIndex.near(p.x, p.y, reach, (l) => {
    if ((l.x - p.x) ** 2 + (l.y - p.y) ** 2 > reach * reach) return;
    const inv = p.inv;
    switch (l.kind) {
      case "ammo": {
        const guns = inv.weapons.filter((g): g is WeaponItem => !!g && !WEAPONS[g.id].infinite);
        if (!guns.length) return;
        for (const g of guns) g.reserve += Math.round(magSize(g) * ITEMS.ammoMags);
        took(w, p, l);
        return;
      }
      case "bandage": {
        if (inv.bandages >= ITEMS.bandage.max) return;
        const n = Math.min(l.count, ITEMS.bandage.max - inv.bandages);
        inv.bandages += n;
        l.count -= n;
        if (l.count <= 0) took(w, p, l);
        return;
      }
      case "medkit":
        if (inv.medkits >= ITEMS.medkit.max) return;
        inv.medkits++;
        took(w, p, l);
        return;
      case "shield":
        if (p.armor >= ITEMS.shield.max) return;
        p.armor = Math.min(ITEMS.shield.max, p.armor + ITEMS.shield.amount);
        took(w, p, l);
        w.emit({ t: "heal", by: p.id, item: "shield", done: true });
        return;
      case "throwable": {
        if (inv.throwable && inv.throwable !== l.throwable) return;
        if (inv.throws >= ITEMS.throwMax) return;
        const n = Math.min(l.count, ITEMS.throwMax - inv.throws);
        inv.throwable = l.throwable;
        inv.throws += n;
        l.count -= n;
        if (l.count <= 0) took(w, p, l);
        return;
      }
      case "shard":
        took(w, p, l);
        w.emit({ t: "shard", by: p.id });
        return;
      case "weapon": {
        const empty = inv.weapons.findIndex((g) => !g);
        if (empty < 0 || inv.weapons.some((g) => g && g.id === l.weapon && g.rarity >= l.rarity)) return;
        inv.weapons[empty] = weaponFromLoot(l);
        took(w, p, l);
        return;
      }
      default:
        return;
    }
  });
}

/** The item F would pick up: nearest weapon (or throwable of another kind) in reach. */
export function interactTarget(w: { lootIndex: LootIndex }, p: Player): Loot | null {
  let best: Loot | null = null;
  let bd = LOOT.interactRange ** 2;
  w.lootIndex.near(p.x, p.y, LOOT.interactRange, (l) => {
    if (l.kind !== "weapon" && !(l.kind === "throwable" && p.inv.throwable && p.inv.throwable !== l.throwable)) return;
    const d = (l.x - p.x) ** 2 + (l.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = l;
    }
  });
  return best;
}

/** F: take the targeted weapon (into an empty slot, else swapping out the gun in hand). */
export function interact(w: World, p: Player) {
  const l = interactTarget(w, p);
  if (!l) return;
  const inv = p.inv;
  if (l.kind === "throwable") {
    const old: ThrowableId | null = inv.throwable;
    const n = inv.throws;
    inv.throwable = l.throwable;
    inv.throws = Math.min(ITEMS.throwMax, l.count);
    took(w, p, l);
    if (old && n > 0) createLoot(w, { kind: "throwable", x: p.x, y: p.y, throwable: old, count: n });
    return;
  }
  const empty = inv.weapons.findIndex((g) => !g);
  const slot = empty >= 0 ? empty : inv.active;
  const old = inv.weapons[slot];
  inv.weapons[slot] = weaponFromLoot(l);
  inv.active = slot;
  p.reloadT = 0;
  p.charge = 0;
  p.fireCd = Math.max(p.fireCd, 0.2);
  took(w, p, l);
  if (old) lootFromWeapon(w, old, p.x, p.y);
}

// ---- supply drops ------------------------------------------------------------------------

/** Announces each supply drop on schedule: a falling crate that lands inside the next zone. */
export function stepSupply(w: World) {
  const at = SUPPLY.times[w.supplyIndex];
  if (at === undefined || w.time < at) return;
  w.supplyIndex++;
  const z = w.zone;
  const cx = z.phase === "warn" || z.phase === "shrink" ? z.toX : z.x;
  const cy = z.phase === "warn" || z.phase === "shrink" ? z.toY : z.y;
  const rad = Math.max(120, Math.min(z.toR > 0 ? z.toR : z.r, w.map.half) * 0.6);
  let x = cx;
  let y = cy;
  for (let i = 0; i < 30; i++) {
    const tx = cx + w.rng.range(-rad, rad);
    const ty = cy + w.rng.range(-rad, rad);
    if (w.insideArena(tx, ty, 90)) {
      x = tx;
      y = ty;
      break;
    }
  }
  w.spawnEffect({ kind: "supplyDrop", owner: 0, source: "zone", x, y, r: 70, life: SUPPLY.fallTime + SUPPLY.beaconSeconds, v: SUPPLY.fallTime, n: 0 });
  w.emit({ t: "supply", x, y, landed: false });
}

function landSupply(w: World, x: number, y: number) {
  const make: ((px: number, py: number) => void)[] = [];
  for (let i = 0; i < SUPPLY.weapons; i++) {
    const id = w.rng.weighted({ ...LOOT.weaponWeights, pistol: 0 }) as WeaponId;
    const r = pickRarity(w, SUPPLY.rarity);
    make.push((px, py) => lootFromWeapon(w, newWeapon(id, r), px, py));
  }
  for (let i = 0; i < SUPPLY.shields; i++) make.push((px, py) => createLoot(w, { kind: "shield", x: px, y: py }));
  for (let i = 0; i < SUPPLY.medkits; i++) make.push((px, py) => createLoot(w, { kind: "medkit", x: px, y: py }));
  for (let i = 0; i < SUPPLY.shards; i++) make.push((px, py) => createLoot(w, { kind: "shard", x: px, y: py }));
  make.push((px, py) => createLoot(w, { kind: "throwable", x: px, y: py, throwable: w.rng.pick(THROWABLE_IDS), count: 2 }));
  make.forEach((m, i) => {
    const s = spot(w, x, y, i + 1);
    m(s.x, s.y);
  });
  // Anyone standing under it gets shoved aside.
  for (const p of w.playersNear(x, y, 80)) {
    const d = Math.hypot(p.x - x, p.y - y) || 1;
    w.impulse(p, ((p.x - x) / d) * 700, ((p.y - y) / d) * 700);
  }
  w.emit({ t: "supply", x, y, landed: true });
  w.emit({ t: "explode", x, y, r: 120, source: "zone", by: 0 });
}

defineEffects({
  supplyDrop: {
    update(w, e) {
      if (e.n === 0 && e.age >= e.v) {
        e.n = 1;
        landSupply(w, e.x, e.y);
      }
    },
  },
});

/** Every weapon id that can appear as floor loot (for UIs and tests). */
export const LOOTABLE_WEAPONS = WEAPON_IDS.filter((id) => LOOT.weaponWeights[id] > 0);
