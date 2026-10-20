// Public input types for the chibi hero renderer, plus the timing hints an integrator needs to
// turn sim state into animation progress values.
//
// Convention: every `...T` field is a 0..1 progress value for a one-shot animation. Any value
// outside [0, 1) (use -1) means "not playing". Map them from sim timers, for example
//   recoilT = sinceShot / CHIBI_TIMING.recoil[weapon]
//   reloadT = 1 - reloadLeft / reloadTotal
//   hitT    = sinceHit / CHIBI_TIMING.hit

import type { HeroId, WeaponId } from "@prism/shared";

export interface ChibiAnim {
  /** Walk cycle phase in radians. Advance it by distanceMoved * CHIBI_TIMING.stridePerUnit. */
  walkPhase: number;
  /** Current movement speed in world units/s. Scales bob, sway and step size (0 = idle breathing). */
  speed: number;
  /** Last shot's kick, 0..1 (per-weapon profile: the sniper kicks big, the SMG jitters). */
  recoilT: number;
  /** Reload, 0..1: the gun tilts, the support hand drops the mag and slaps in a new one. */
  reloadT: number;
  /** Healing, 0..1. `healKind` picks the bandage wrap or the medkit. */
  healT: number;
  healKind?: "bandage" | "medkit";
  /** Throwable arm swing, 0..1. The grenade leaves the hand at ~0.55. */
  throwT: number;
  /** Melee slash arc, 0..1 (Energy Blade swing; other guns do a short bash). */
  slashT: number;
  /** Which way the slash sweeps: 1 or -1 (alternate it per swing for a combo feel). */
  slashSide?: number;
  /** Dash, 0..1: stretch along the dash plus afterimages. */
  dashT: number;
  /** Dash direction in radians (defaults to the aim). */
  dashAngle?: number;
  /** Took damage, 0..1: white flash plus squash. */
  hitT: number;
  /** Death, 0..1: pop into neon shards and a fading ghost floats up. At >= 1 nothing is drawn. */
  deathT: number;
  /** Spawn / drop-in landing, 0..1: falls from the sky, squashes, ring shockwave. */
  spawnT: number;
  /** Cloak amount 0..1 (0 = fully visible). Shimmering partial alpha. */
  cloak: number;
  /** Prism Lance charge 0..1 (glow builds at the crystal emitter). */
  charge?: number;
}

export interface ChibiWeapon {
  id: WeaponId;
  /** Rarity tier 0..3 (Common, Rare, Epic, Legendary), drawn as the accent glow color. */
  rarity: number;
}

export interface ChibiDrawState {
  heroId: HeroId;
  /** Player color hex (#RRGGBB): neon rim / outline glow so teams stay readable. */
  color: string;
  /** World position of the hitbox center. */
  x: number;
  y: number;
  /** Aim angle in radians (canvas convention: 0 = right, PI/2 = down). */
  aim: number;
  /** Weapon in hand, or null for empty hands. */
  weapon: ChibiWeapon | null;
  anim: ChibiAnim;
  /** Draw scale (1 = sized for the 22-unit hitbox, about 44 px tall body at 1x zoom). */
  scale: number;
  /** Seconds, any monotonic clock (idle breathing, blinking, glow hum). */
  time: number;
  /** Optional per-entity seed (player id) so idle cycles and death shards differ. */
  seed?: number;
  /** Draw the soft floor glow in the player color under the hero (default true). */
  floorGlow?: boolean;
  /** Draw the built-in muzzle flash during recoil (default true). */
  muzzleFlash?: boolean;
}

/** A fresh, idle animation state (every one-shot set to -1, standing still). */
export function idleAnim(): ChibiAnim {
  return { walkPhase: 0, speed: 0, recoilT: -1, reloadT: -1, healT: -1, throwT: -1, slashT: -1, dashT: -1, hitT: -1, deathT: -1, spawnT: -1, cloak: 0 };
}

/** Suggested durations (seconds) for mapping "time since event" onto the 0..1 fields. */
export const CHIBI_TIMING = {
  recoil: { pistol: 0.16, smg: 0.08, rifle: 0.11, shotgun: 0.32, sniper: 0.5, rocket: 0.42, lance: 0.3, blade: 0.25 } satisfies Record<WeaponId, number>,
  hit: 0.22,
  death: 1.2,
  spawn: 0.9,
  dash: 0.22,
  throw: 0.5,
  slash: 0.25,
  /** Walk phase radians per world unit moved (one full step pair every ~46 units). */
  stridePerUnit: (Math.PI * 2) / 46,
} as const;

/** True if a 0..1 progress value is currently playing. */
export const playing = (t: number | undefined): t is number => t !== undefined && t >= 0 && t < 1;
