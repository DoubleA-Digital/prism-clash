// What a player's hands do in one input frame: swap weapons, pull the trigger, reload,
// charge the lance, swing the blade, heal, throw. Pure functions on the Player only (no
// World), so the server runs them for real and the client replays the very same code for
// prediction: predicted shots, ammo, reload and heal timers always agree with the server.

import { GUN, ITEMS, PLAYER, RARITY, ULTIMATES, WEAPONS, type WeaponDef } from "../config";
import type { HealKind, InputFrame, Player, ThrowableId, WeaponId, WeaponItem } from "./types";
import { BTN } from "./types";

export const magSize = (w: WeaponItem) => (WEAPONS[w.id].mag > 0 ? Math.round(WEAPONS[w.id].mag * (RARITY[w.rarity]?.mag ?? 1)) : 0);
export const weaponDamage = (w: { id: WeaponId; rarity: number }) => WEAPONS[w.id].damage * (RARITY[w.rarity]?.damage ?? 1);

export function newWeapon(id: WeaponId, rarity: number): WeaponItem {
  const def = WEAPONS[id];
  const item: WeaponItem = { id, rarity, mag: 0, reserve: 0 };
  item.mag = magSize(item);
  item.reserve = def.infinite ? 0 : Math.round(item.mag * def.reserveMags);
  return item;
}

export const activeWeapon = (p: Player): WeaponItem | null => p.inv.weapons[p.inv.active] ?? null;

export interface FrameOut {
  /** Bullets/pellet volleys fired this frame (each volley shares the frame's shotId). */
  shots: number;
  /** Spread bloom (degrees) when the first shot left. */
  bloom: number;
  /** Lance released with this charge (0..1), or -1. */
  lance: number;
  swing: boolean;
  reload: "start" | "done" | null;
  heal: "start" | "done" | "cancel" | null;
  healItem: HealKind | null;
  throwItem: ThrowableId | null;
  swapped: boolean;
}

const canReload = (w: WeaponItem, def: WeaponDef) => def.kind !== "blade" && w.mag < magSize(w) && (def.infinite || w.reserve > 0);

function startReload(p: Player, def: WeaponDef, out: FrameOut) {
  p.reloadT = def.reload;
  p.charge = 0;
  out.reload = "start";
}

/** Best heal for the moment: a medkit when badly hurt, otherwise bandages first. */
export function pickHeal(p: Player): HealKind | null {
  if (p.hp >= PLAYER.maxHp) return null;
  const big = p.hp <= PLAYER.maxHp - ITEMS.medkit.heal * 0.6;
  if (big && p.inv.medkits > 0) return "medkit";
  if (p.inv.bandages > 0) return "bandage";
  return p.inv.medkits > 0 ? "medkit" : null;
}

/** Deterministic spread in [-1, 1] for a predicted shot (client and server agree on it). */
export function spreadNoise(shotId: number, k: number): number {
  let h = Math.imul((shotId + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 7, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Angles of every projectile in one volley. `noise` returns [-1, 1]. */
export function volleyAngles(id: WeaponId, aim: number, bloom: number, noise: (k: number) => number): number[] {
  const def = WEAPONS[id];
  const deg = Math.PI / 180;
  if (def.kind === "shotgun") {
    const out: number[] = [];
    for (let k = 0; k < def.pellets; k++) {
      const even = ((k + 0.5) / def.pellets) * 2 - 1;
      out.push(aim + (even * def.spread + noise(k) * def.spread * 0.18) * deg);
    }
    return out;
  }
  return [aim + noise(0) * (def.spread + bloom) * deg];
}

/**
 * Runs one input frame of hands logic on a player. Advances the weapon timers by dt.
 * Returns what happened so the caller can spawn projectiles, play sounds, etc.
 */
export function actFrame(p: Player, f: InputFrame, dt: number): FrameOut {
  const out: FrameOut = { shots: 0, bloom: 0, lance: -1, swing: false, reload: null, heal: null, healItem: null, throwItem: null, swapped: false };
  if (!p.alive) return out;
  const st = p.status;
  const inv = p.inv;
  const od = (st.overdrive ?? 0) > 0;
  const fireRate = od ? ULTIMATES.overdrive.fireRateMult : 1;
  const reloadRate = od ? ULTIMATES.overdrive.reloadMult : 1;
  const blocked = (st.airborne ?? 0) > 0 || (st.finalStand ?? 0) > 0 || p.dashT > 0;
  p.throwCd = Math.max(0, p.throwCd - dt);
  p.swingT = Math.max(0, p.swingT - dt);

  // Weapon swap: 1 / 2 pick a slot, the wheel toggles. Swapping cancels reload and charge.
  let want = inv.active;
  if (f.pressed & BTN.slot1) want = 0;
  if (f.pressed & BTN.slot2) want = 1;
  if (f.pressed & BTN.swap) want = 1 - inv.active;
  if (want !== inv.active && inv.weapons[want]) {
    inv.active = want;
    p.reloadT = 0;
    p.charge = 0;
    p.fireCd = Math.max(p.fireCd, 0.18);
    out.swapped = true;
  }

  const w = inv.weapons[inv.active];
  const held = (f.buttons & BTN.shoot) !== 0;
  if (w) {
    const def = WEAPONS[w.id];
    // Bloom builds while the trigger is held and settles once you let go.
    if (!held) p.bloom = Math.max(0, p.bloom - def.bloomRecover * dt);
    if (p.reloadT > 0) {
      p.reloadT -= dt * reloadRate;
      if (p.reloadT <= 0) {
        p.reloadT = 0;
        const need = magSize(w) - w.mag;
        const take = def.infinite ? need : Math.min(need, w.reserve);
        w.mag += take;
        if (!def.infinite) w.reserve -= take;
        out.reload = "done";
      }
    }
    p.fireCd -= dt;
    const firing = held && !blocked && p.reloadT <= 0;
    if (!firing && def.kind !== "lance") p.fireCd = Math.max(0, p.fireCd);
    if ((f.pressed & BTN.reload) && p.reloadT <= 0 && canReload(w, def)) startReload(p, def, out);

    if (def.kind === "blade") {
      if (firing && p.fireCd <= 0) {
        p.fireCd = def.fireCd / fireRate;
        p.swingT = def.swingTime;
        p.px += Math.cos(f.aim) * def.lunge;
        p.py += Math.sin(f.aim) * def.lunge;
        out.swing = true;
      }
    } else if (def.kind === "lance") {
      p.fireCd = Math.max(0, p.fireCd);
      if (firing && w.mag > 0) p.charge = Math.min(1, p.charge + dt / def.chargeTime);
      else if (!held && p.charge > 0) {
        if (!blocked && p.fireCd <= 0 && w.mag > 0) {
          out.lance = p.charge;
          if (!od) w.mag--;
          p.fireCd = def.fireCd / fireRate;
        }
        p.charge = 0;
      } else if (blocked) p.charge = 0;
    } else {
      while (firing && p.fireCd <= 0 && w.mag > 0 && out.shots < 3) {
        if (out.shots === 0) out.bloom = p.bloom;
        out.shots++;
        if (!od) w.mag--;
        p.fireCd += Math.max(GUN.minFireCd, def.fireCd / fireRate);
        p.bloom = Math.min(def.bloomMax, p.bloom + def.bloomPerShot);
      }
    }
    // Auto reload on an empty magazine.
    if (w.mag <= 0 && p.reloadT <= 0 && canReload(w, def)) startReload(p, def, out);
  }

  // Throwables
  if ((f.pressed & BTN.throw) && inv.throwable && inv.throws > 0 && p.throwCd <= 0 && !blocked) {
    out.throwItem = inv.throwable;
    inv.throws--;
    if (inv.throws <= 0) inv.throwable = null;
    p.throwCd = ITEMS.throwCd;
  }

  // Healing: hold the key to channel. Shooting, swinging, throwing or dashing interrupts it.
  const acted = out.shots > 0 || out.swing || out.lance >= 0 || out.throwItem !== null || p.charge > 0 || p.dashT > 0 || (f.pressed & BTN.dash) !== 0;
  const healHeld = (f.buttons & BTN.heal) !== 0;
  if (p.healKind) {
    if (!healHeld || acted) {
      p.healKind = null;
      p.healT = 0;
      out.heal = "cancel";
    } else {
      p.healT -= dt;
      if (p.healT <= 0) {
        const kind = p.healKind;
        p.healKind = null;
        p.healT = 0;
        if (kind === "medkit" && inv.medkits > 0) {
          inv.medkits--;
          p.hp = Math.min(PLAYER.maxHp, p.hp + ITEMS.medkit.heal);
        } else if (kind === "bandage" && inv.bandages > 0) {
          inv.bandages--;
          p.hp = Math.min(PLAYER.maxHp, p.hp + ITEMS.bandage.heal);
        }
        out.heal = "done";
        out.healItem = kind;
      }
    }
  } else if (healHeld && !acted && !blocked) {
    const kind = pickHeal(p);
    if (kind) {
      p.healKind = kind;
      p.healT = ITEMS[kind].time;
      out.heal = "start";
      out.healItem = kind;
    }
  }
  return out;
}
