// Where the hands and the weapon go this frame. Pure math: turns the aim and the animation
// progress values into a grip transform, two hand positions and any held prop (mag, grenade,
// bandage, medkit). Everything is in hero-local units before the body bob is applied.

import type { WeaponId } from "@prism/shared";
import { smooth } from "./paint";
import { playing, type ChibiAnim, type ChibiWeapon } from "./types";
import { WEAPON_ART } from "./weapons";

type Pt = [number, number];

export interface HeldProp {
  kind: "mag" | "oldmag" | "grenade" | "bandage" | "medkit";
  x: number;
  y: number;
  /** Orientation (rad) for mags; progress 0..1 for heal props. */
  a: number;
  k: number;
}

export interface Pose {
  weapon: { id: WeaponId; rarity: number; x: number; y: number; a: number; flip: boolean } | null;
  main: Pt | null;
  off: Pt | null;
  weaponBehind: boolean;
  handsBehind: boolean;
  held: HeldProp[];
  /** Body shove from recoil. */
  shove: Pt;
  /** Muzzle tip + flash strength 0..1 (0 = no flash). */
  muzzle: { x: number; y: number; a: number; k: number } | null;
  /** Blade trail arc around the pivot. */
  slash: { a0: number; a1: number; r0: number; r1: number; k: number } | null;
}

/** Chest point the arms pivot around. */
export const PIVOT: Pt = [0, 4];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: readonly [number, number], b: readonly [number, number], t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

export function computePose(aim: number, weapon: ChibiWeapon | null, A: ChibiAnim, time: number, seed: number): Pose {
  const fs = Math.cos(aim) < 0 ? -1 : 1;
  const art = weapon ? WEAPON_ART[weapon.id] : null;
  const isBlade = weapon?.id === "blade";
  const pose: Pose = { weapon: null, main: null, off: null, weaponBehind: false, handsBehind: false, held: [], shove: [0, 0], muzzle: null, slash: null };

  let aw = aim + (isBlade ? fs * -0.35 : 0);
  let reach = art ? art.reach : 9;
  let lateral = 3.6;
  let kick = 0;

  if (art && playing(A.recoilT)) {
    const u = A.recoilT;
    const k = u < 0.12 ? u / 0.12 : (1 - (u - 0.12) / 0.88) ** 2;
    const r = art.recoil;
    kick = r.kick * k;
    const j = r.jitter * k;
    const q = Math.floor(time * 50) + seed * 13;
    lateral += hash(q) * j;
    aw += fs * (-r.rot * k + hash(q + 7) * j * 0.05);
    pose.shove = [-Math.cos(aim) * r.body * k, -Math.sin(aim) * r.body * k];
    if (u < 0.3 && !isBlade && weapon?.id !== "lance") pose.muzzle = { x: 0, y: 0, a: 0, k: 1 - u / 0.3 };
  }
  let offLocal: Pt | null = art?.off ? [art.off[0], art.off[1]] : null;
  const reloading = art && playing(A.reloadT);
  if (reloading && art) {
    const u = A.reloadT;
    const env = smooth(0, 0.15, u) * (1 - smooth(0.85, 1, u));
    if (isBlade) aw += fs * Math.PI * 2 * smooth(0.05, 0.95, u);
    else {
      aw += fs * -0.62 * env;
      reach -= 3 * env;
    }
  }
  const throwing = playing(A.throwT);
  if (throwing) {
    const u = A.throwT;
    const env = smooth(0, 0.2, u) * (1 - smooth(0.7, 1, u));
    aw += fs * 0.9 * env;
    reach -= 4 * env;
  }
  if (art && playing(A.slashT)) {
    const u = A.slashT;
    if (isBlade) {
      const side = A.slashSide === -1 ? -1 : 1;
      const e = 1 - (1 - u) ** 3;
      const a0 = aim + fs * side * -1.55;
      aw = aim + fs * side * lerp(-1.55, 1.35, e);
      reach = 11;
      pose.slash = { a0, a1: aw, r0: reach + 4, r1: reach + art.muzzle + 2, k: 1 - smooth(0.55, 1, u) };
    } else reach += 5 * Math.sin(Math.PI * u);
  }

  const healing = playing(A.healT);
  const ca = Math.cos(aw);
  const sa = Math.sin(aw);
  const gx = PIVOT[0] + ca * (reach - kick) - sa * lateral * fs;
  const gy = PIVOT[1] + sa * (reach - kick) + ca * lateral * fs;
  const toHero = (l: readonly [number, number]): Pt => [gx + ca * l[0] - sa * l[1] * fs, gy + sa * l[0] + ca * l[1] * fs];

  if (weapon && art) {
    if (healing) {
      pose.weapon = { id: weapon.id, rarity: weapon.rarity, x: fs * 5, y: 9, a: -Math.PI / 2 - fs * 0.75, flip: fs < 0 };
      pose.weaponBehind = true;
    } else {
      pose.weapon = { id: weapon.id, rarity: weapon.rarity, x: gx, y: gy, a: aw, flip: fs < 0 };
      pose.weaponBehind = Math.sin(aw) < -0.42;
      pose.main = toHero([0.4, 1.2]);
      if (pose.muzzle) {
        const m = toHero([art.muzzle + 1, 0]);
        pose.muzzle = { x: m[0], y: m[1], a: aw, k: pose.muzzle.k };
      }
    }
  } else {
    const px = -Math.sin(aim) * fs;
    const py = Math.cos(aim) * fs;
    const punch = playing(A.slashT) ? Math.sin(Math.PI * A.slashT) * 7 : 0;
    pose.main = [PIVOT[0] + Math.cos(aim) * (9 + punch) + px * 4.6, PIVOT[1] + Math.sin(aim) * (9 + punch) + py * 4.6];
    pose.off = [PIVOT[0] + Math.cos(aim) * 8 - px * 4.6, PIVOT[1] + Math.sin(aim) * 8 - py * 4.6];
    pose.weaponBehind = Math.sin(aim) < -0.42;
  }
  pose.handsBehind = pose.weaponBehind && !healing;

  // Support hand: on the foregrip, or free at the side for the blade / empty-handed.
  const sidePx = -Math.sin(aim) * fs;
  const sidePy = Math.cos(aim) * fs;
  const freeHand: Pt = [PIVOT[0] - sidePx * 10 + Math.cos(aim) * 2, PIVOT[1] - sidePy * 10 + Math.sin(aim) * 2 + 2];
  if (art && !healing) {
    if (offLocal && reloading) {
      const u = A.reloadT;
      const M: Pt = [art.mag[0], art.mag[1]];
      const D: Pt = [M[0] - 2, M[1] + 11];
      const rest = offLocal;
      let held: "mag" | null = null;
      if (u < 0.2) offLocal = lerpPt(rest, M, smooth(0, 1, u / 0.2));
      else if (u < 0.42) offLocal = lerpPt(M, D, smooth(0, 1, (u - 0.2) / 0.22));
      else if (u < 0.68) {
        offLocal = lerpPt(D, M, smooth(0, 1, (u - 0.42) / 0.26));
        held = "mag";
      } else if (u < 0.8) offLocal = [M[0], M[1] - Math.sin(((u - 0.68) / 0.12) * Math.PI) * 1.5];
      else offLocal = lerpPt(M, rest, smooth(0, 1, (u - 0.8) / 0.2));
      const o = toHero(offLocal);
      if (held) pose.held.push({ kind: "mag", x: o[0], y: o[1] - 1, a: aw, k: 1 });
      if (u > 0.2 && u < 0.62) {
        const f = (u - 0.2) / 0.42;
        const s = toHero(M);
        pose.held.push({ kind: "oldmag", x: s[0] + f * 3 * fs, y: s[1] + 26 * f * f, a: aw + f * 2.4 * fs, k: 1 - smooth(0.6, 1, f) });
      }
    }
    pose.off = offLocal ? toHero(offLocal) : freeHand;
  }

  if (healing) {
    const u = A.healT;
    if (A.healKind === "medkit") {
      const c: Pt = [fs * 1.5, 12.5 + Math.sin(u * Math.PI * 6) * 0.7];
      pose.main = [c[0] + 6.8, c[1] + 0.5];
      pose.off = [c[0] - 6.8, c[1] + 0.5];
      pose.held.push({ kind: "medkit", x: c[0], y: c[1], a: 0, k: u });
    } else {
      const c: Pt = [fs * 2.5, 12];
      const w = u * Math.PI * 7;
      pose.main = [c[0] + Math.cos(w) * 4.4, c[1] + Math.sin(w) * 2];
      pose.off = [c[0] - Math.cos(w) * 4.4, c[1] - Math.sin(w) * 2];
      pose.held.push({ kind: "bandage", x: pose.off[0], y: pose.off[1], a: w, k: u });
    }
  } else if (throwing) {
    const u = A.throwT;
    const rest = pose.off ?? freeHand;
    const at = (e: number): Pt => {
      const th = aim - fs * 2.5 * (1 - e);
      const r = 9 + 8 * e;
      return [PIVOT[0] + Math.cos(th) * r, PIVOT[1] + Math.sin(th) * r - 5 * Math.sin(Math.PI * e)];
    };
    let o: Pt;
    if (u < 0.35) o = lerpPt(rest, at(0), smooth(0, 1, u / 0.35));
    else if (u < 0.55) o = at(((u - 0.35) / 0.2) ** 1.4);
    else o = lerpPt(at(1), rest, smooth(0, 1, (u - 0.55) / 0.45));
    pose.off = o;
    if (u < 0.55) pose.held.push({ kind: "grenade", x: o[0], y: o[1] - 1, a: time * 6, k: 1 });
  }
  return pose;
}
