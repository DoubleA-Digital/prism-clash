// Fight judgement: how hard each gun hits at a distance, whether a fight is winnable, which
// enemy to focus, where each gun likes to fight from, and where to break line of sight.

import {
  BOTS, bulletBlocked, visionBlocked, weaponDamage, weaponRange, WEAPONS,
  type Player, type Solid, type WeaponId, type World,
} from "@prism/shared";
import type { NavGrid } from "./nav";
import type { Contact } from "./perception";

const C = BOTS.combat;

/** Rough damage per second of a gun at distance d (includes falloff and a miss factor). */
export function dpsAt(id: WeaponId, rarity: number, d: number): number {
  const def = WEAPONS[id];
  const dmg = weaponDamage({ id, rarity }) * Math.max(1, def.pellets);
  const cycle = def.kind === "lance" ? def.chargeTime * 0.8 + def.fireCd : def.fireCd + (def.mag > 0 ? def.reload / Math.max(1, def.mag * (1 + rarity * 0.25)) : 0);
  let dps = dmg / Math.max(0.05, cycle);
  const range = weaponRange(id);
  if (def.kind === "blade") dps *= d < range + 60 ? 1 : d < 300 ? 0.35 : 0.05;
  else if (d > range) dps *= Math.max(0.05, 1 - (d - range) / (range * 0.6));
  if (def.kind === "shotgun") dps *= d < 160 ? 0.9 : d < 300 ? 0.5 : 0.2;
  else if (def.kind !== "blade") dps *= d < 250 ? 0.7 : d < 600 ? 0.5 : 0.35;
  return dps;
}

/** The distance a bot wants to fight at with this gun. */
export function prefRange(id: WeaponId, mult: number): number {
  return C.prefRange[id] * (id === "blade" || id === "shotgun" ? Math.min(1, mult) : mult);
}

/**
 * Chance (0..1) to win a duel against a contact right now: compares time-to-kill both ways
 * with the guns in hand, health and armor, plus bonuses for catching someone mid-fight and
 * penalties for every other enemy in sight.
 */
export function winChance(me: Player, myGun: WeaponId, myRarity: number, c: Contact, othersVisible: number, theyAreBusy: boolean): number {
  const d = Math.hypot(c.x - me.x, c.y - me.y);
  const mine = dpsAt(myGun, myRarity, d);
  const theirs = dpsAt(c.weapon, c.rarity, d);
  const ttkThem = (c.hp + c.armor) / Math.max(1, mine);
  const ttkMe = (me.hp + me.armor) / Math.max(1, theirs);
  let p = ttkMe / (ttkMe + ttkThem);
  if (theyAreBusy) p += C.thirdPartyBonus;
  p -= othersVisible * C.crowdPenalty;
  return Math.max(0, Math.min(1, p));
}

/**
 * Which visible contact to focus: close, weak, already being hurt, and the current target
 * gets a stickiness bonus so aim doesn't flick between people.
 */
export function pickTarget(me: Player, visible: readonly Contact[], current: number, busy: (id: number) => boolean): Contact | null {
  let best: Contact | null = null;
  let bs = Infinity;
  for (const c of visible) {
    const d = Math.hypot(c.x - me.x, c.y - me.y);
    let s = d + (c.hp + c.armor) * 3;
    if (c.id === current) s -= 220;
    if (busy(c.id)) s -= 120;
    if (c.hitUsAt > 0) s -= 80;
    if (s < bs) {
      bs = s;
      best = c;
    }
  }
  return best;
}

export interface Spot {
  x: number;
  y: number;
}

/**
 * A nearby walkable spot where terrain stops bullets from (tx, ty): rings of samples around
 * the bot, scored by distance, preferring spots that also break vision, staying away from the
 * threat and inside the safe zone.
 */
export function findCover(w: World, grid: NavGrid, me: Player, tx: number, ty: number, inZone: (x: number, y: number) => boolean): Spot | null {
  let best: Spot | null = null;
  let bs = Infinity;
  const away = Math.atan2(me.y - ty, me.x - tx);
  for (const r of C.coverRings) {
    for (let k = 0; k < C.coverSamples; k++) {
      const a = away + ((k + (r % 2) * 0.5) / C.coverSamples) * Math.PI * 2;
      const x = me.x + Math.cos(a) * r;
      const y = me.y + Math.sin(a) * r;
      if (!grid.walkableAt(x, y)) continue;
      let s = r;
      const dT = Math.hypot(x - tx, y - ty);
      if (dT < 260) s += 400;
      if (!inZone(x, y)) s += 500;
      if (s >= bs) continue;
      if (!bulletBlocked(w.map, x, y, tx, ty)) continue;
      if (visionBlocked(w.map, x, y, tx, ty)) s -= 70;
      // Moving toward the threat to reach cover is a bad trade.
      if (Math.hypot(me.x - tx, me.y - ty) > dT + 60) s += 220;
      if (s < bs) {
        bs = s;
        best = { x, y };
      }
    }
    if (best && bs < r + 60) break;
  }
  return best;
}

/** A spot `dist` away from the threat (backing off), as walkable as we can find. */
export function backOff(grid: NavGrid, me: Player, tx: number, ty: number, dist: number): Spot {
  const base = Math.atan2(me.y - ty, me.x - tx);
  for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const x = me.x + Math.cos(base + off) * dist;
    const y = me.y + Math.sin(base + off) * dist;
    if (grid.walkableAt(x, y)) return { x, y };
  }
  return { x: me.x + Math.cos(base) * dist, y: me.y + Math.sin(base) * dist };
}

/** The nearest unbroken crate worth opening. */
export function nearCrate(w: World, me: Player, range: number, skip: (id: number) => boolean = () => false): Solid | null {
  let best: Solid | null = null;
  let bd = range;
  w.map.grid.query(me.x - range, me.y - range, me.x + range, me.y + range, (i) => {
    const s = w.map.solids[i];
    if (!s || s.dead || s.kind !== "crate" || skip(s.id)) return;
    const d = Math.hypot((s.x0 + s.x1) / 2 - me.x, (s.y0 + s.y1) / 2 - me.y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  });
  return best;
}
