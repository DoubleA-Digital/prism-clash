// Weapon audio playback: per-gun shots (close voice, or a cheap distant pop for far fighters
// so fights stay locatable), rarity layers, reloads, dry fire, swaps, rocket blasts and the
// Energy Blade. Each gun has its own voice cap in the positional mixer, so twelve fighters
// spraying never clip or flood the audio graph. Recipes live in weaponRecipes.ts.

import type { WeaponId } from "@prism/shared";
import { audio } from "./audio";

interface GunMix {
  gain: number;
  /** Max simultaneous close voices of this gun. */
  cap: number;
  /** Hearing range: far fighters stay audible as distant pops out to here. */
  range: number;
  ref: number;
}

const MIX: Record<WeaponId, GunMix> = {
  pistol: { gain: 0.8, cap: 4, range: 3000, ref: 520 },
  smg: { gain: 0.62, cap: 5, range: 2600, ref: 480 },
  rifle: { gain: 0.8, cap: 5, range: 3200, ref: 540 },
  shotgun: { gain: 1, cap: 3, range: 3000, ref: 560 },
  sniper: { gain: 1.1, cap: 2, range: 4400, ref: 760 },
  rocket: { gain: 0.9, cap: 2, range: 3000, ref: 560 },
  lance: { gain: 0.9, cap: 3, range: 3400, ref: 560 },
  blade: { gain: 0.75, cap: 3, range: 1300, ref: 420 },
};

/** Past this distance a gunshot switches to its cheap distant-pop voice. */
const FAR_AT = 1250;
const FAR_CAP = 6;

export interface ShotOpts {
  /** The local player's own shot: full level, centered. */
  own?: boolean;
  /** 0 common .. 3 legendary. */
  rarity?: number;
}

const jitter = () => 0.96 + Math.random() * 0.08;

/** A gun going off (own shots play this at prediction time; lance on its beam event). */
export function weaponShot(weapon: WeaponId, x: number, y: number, o: ShotOpts = {}) {
  const m = MIX[weapon];
  const pitch = jitter();
  const rarity = Math.max(0, Math.min(3, Math.round(o.rarity ?? 0)));
  if (o.own) {
    audio.sfx(`gun:${weapon}`, x, y, { positional: false, gain: m.gain, pitch, group: `gun:${weapon}`, cap: m.cap });
    if (rarity > 0) audio.sfx(`rarity:${rarity}`, x, y, { positional: false, gain: m.gain, group: "rarity", cap: 3 });
    return;
  }
  const l = audio.listenerPos;
  const far = Math.hypot(x - l.x, y - l.y) > FAR_AT;
  if (far) {
    audio.sfx(`gun:far:${weapon}`, x, y, { gain: m.gain * 1.4, pitch, range: m.range, ref: m.ref, group: "gun:far", cap: FAR_CAP });
    return;
  }
  audio.sfx(`gun:${weapon}`, x, y, { gain: m.gain * 0.85, pitch, range: m.range, ref: m.ref, group: `gun:${weapon}`, cap: m.cap });
  if (rarity > 1) audio.sfx(`rarity:${rarity}`, x, y, { gain: m.gain * 0.7, ref: m.ref, group: "rarity", cap: 3 });
}

/** Reload sequence for the weapon's class. Others' reloads are quiet and short-ranged. */
export function weaponReload(weapon: WeaponId, x: number, y: number, own: boolean) {
  if (weapon === "blade") return;
  audio.sfx(`reload:${weapon}`, x, y, { positional: !own, gain: own ? 1.8 : 1.1, range: 800, ref: 300, group: "reload", cap: 3 });
}

/** Trigger pulled on an empty magazine (call from local input; there is no server event). */
export function dryFire(weapon: WeaponId) {
  const energy = weapon === "lance";
  const heavy = weapon === "shotgun" || weapon === "sniper" || weapon === "rocket";
  audio.sfx(energy ? "gun:dry:energy" : "gun:dry", 0, 0, { positional: false, pitch: heavy ? 0.75 : 1, gain: 2, group: "dry", cap: 2 });
}

/** Switching weapons (local). Rarer guns announce themselves with a faint layer. */
export function weaponSwap(weapon: WeaponId, rarity = 0) {
  const heavy = weapon === "shotgun" || weapon === "sniper" || weapon === "rocket";
  audio.sfx("gun:swap", 0, 0, { positional: false, pitch: heavy ? 0.8 : 1.05, gain: 1.3, group: "swap", cap: 2 });
  if (rarity >= 3) audio.sfx("rarity:3", 0, 0, { positional: false, gain: 0.5, group: "rarity", cap: 3 });
}

export function rocketExplosion(x: number, y: number, scale = 1) {
  audio.sfx("rocket:explode", x, y, { gain: 1.1 * scale, range: 3200, ref: 620, group: "explosion", cap: 4 });
}

export function bladeSwing(x: number, y: number, own: boolean) {
  audio.sfx("blade:swing", x, y, { positional: !own, gain: own ? 0.8 : 0.65, range: 1300, group: "blade", cap: 3 });
}

export function bladeHit(x: number, y: number) {
  audio.sfx("blade:hit", x, y, { gain: 0.9, range: 1300, group: "blade:hit", cap: 3 });
}

export function bladeDeflect(x: number, y: number) {
  audio.sfx("blade:deflect", x, y, { gain: 0.85, range: 1600, group: "deflect", cap: 3 });
}
