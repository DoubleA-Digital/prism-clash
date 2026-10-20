// Plug-in points for powers and ultimates. A power is one file that calls definePower();
// adding a power = that file + one line in powers/registry.ts. The world looks hooks up
// here, so it never needs to know about any specific power.

import type { World } from "./world";
import type { Effect, EffectKind, Player, PowerId, PowerSlot, Projectile, SourceId, UltId } from "./types";

export interface EffectHooks {
  /** Every tick while alive. */
  update?(w: World, e: Effect, dt: number): void;
  /** Every tick, once per living player (pulls, burns, slows). */
  affectPlayer?(w: World, e: Effect, p: Player, dt: number): void;
  /** Every tick, once per projectile in flight. Return a time scale (<1 slows it). */
  affectProjectile?(w: World, e: Effect, pr: Projectile, dt: number): number | void;
  /** A projectile hit this effect (decoys, clones). */
  onProjectileHit?(w: World, e: Effect, pr: Projectile): void;
  onExpire?(w: World, e: Effect): void;
}

/** How bots should think about a power. */
export interface BotHint {
  /** "attack": needs a target in range; "defend": use when hurt or threatened; "mobility"; "zone"; "buff". */
  role: "attack" | "defend" | "mobility" | "zone" | "buff";
  /** Preferred distance to the target when casting (attack powers). */
  range?: number;
  /** Use when own HP is below this (defend powers). */
  hpBelow?: number;
}

/** What a power sends over the network: the generic Effect fields cover every power's
 *  live state, so serialize/deserialize map between an Effect and its compact array. */
export interface PowerNet {
  serialize(e: Effect): number[];
  deserialize(a: readonly number[], into: Effect): void;
}

export interface PowerDef {
  id: PowerId;
  name: string;
  description: string;
  /** Signature color (CSS hex). */
  color: string;
  cooldown: number;
  /** Draws the icon centered at (0,0) filling `size`. Client-only. */
  drawIcon(ctx: CanvasRenderingContext2D, size: number, t: number): void;
  /** Returns false if the cast is refused (no target, etc.); cooldown isn't spent then. */
  onCast(w: World, p: Player, slot: PowerSlot): boolean;
  /** When slot.recast > 0, pressing the key again calls this instead (portal 2, swap with clone…). */
  onRecast?(w: World, p: Player, slot: PowerSlot): void;
  /** The recast window ran out without a recast. */
  onRecastExpire?(w: World, p: Player, slot: PowerSlot): void;
  /** The power leaves its slot mid-match (a Prism Shard pick replaced it): clear passive leftovers. */
  onUnequip?(w: World, p: Player): void;
  /** Every tick for players holding this power (passive bits, trails while active). */
  onPlayerTick?(w: World, p: Player, dt: number): void;
  /** Called when a projectile from this power hits a player (instead of plain damage). */
  onHit?(w: World, pr: Projectile, target: Player, x: number, y: number): void;
  /** Called when a projectile from this power runs out of life. */
  onProjectileExpire?(w: World, pr: Projectile): void;
  /** Effect kinds this power owns, and their behavior. */
  effects?: Partial<Record<EffectKind, EffectHooks>>;
  net?: PowerNet;
  bot: BotHint;
}

export interface UltDef {
  id: UltId;
  name: string;
  description: string;
  color: string;
  drawIcon(ctx: CanvasRenderingContext2D, size: number, t: number): void;
  onCast(w: World, p: Player): boolean;
  onHit?(w: World, pr: Projectile, target: Player, x: number, y: number): void;
  effects?: Partial<Record<EffectKind, EffectHooks>>;
  bot: { minTargets: number; hpBelow?: number };
}

const powers = new Map<PowerId, PowerDef>();
const ults = new Map<UltId, UltDef>();
const effectRegistry = new Map<EffectKind, EffectHooks>();
const hitHooks = new Map<SourceId, (w: World, pr: Projectile, target: Player, x: number, y: number) => void>();
const expireHooks = new Map<SourceId, (w: World, pr: Projectile) => void>();

function registerEffects(effects: Partial<Record<EffectKind, EffectHooks>> | undefined) {
  if (!effects) return;
  for (const [k, h] of Object.entries(effects) as [EffectKind, EffectHooks][]) {
    const prev = effectRegistry.get(k);
    // Two owners of one effect kind merge (e.g. "flash" is used by several powers).
    effectRegistry.set(k, prev ? mergeHooks(prev, h) : h);
  }
}

function mergeHooks(a: EffectHooks, b: EffectHooks): EffectHooks {
  const both = <A extends unknown[]>(f?: (...x: A) => unknown, g?: (...x: A) => unknown) =>
    f && g ? (...x: A) => { f(...x); g(...x); } : (f ?? g);
  return {
    update: both(a.update, b.update),
    affectPlayer: both(a.affectPlayer, b.affectPlayer),
    affectProjectile: a.affectProjectile ?? b.affectProjectile,
    onProjectileHit: both(a.onProjectileHit, b.onProjectileHit),
    onExpire: both(a.onExpire, b.onExpire),
  } as EffectHooks;
}

export function definePower(def: PowerDef): PowerDef {
  powers.set(def.id, def);
  registerEffects(def.effects);
  if (def.onHit) hitHooks.set(def.id, def.onHit);
  if (def.onProjectileExpire) expireHooks.set(def.id, def.onProjectileExpire);
  return def;
}

export function defineUlt(def: UltDef): UltDef {
  ults.set(def.id, def);
  registerEffects(def.effects);
  if (def.onHit) hitHooks.set(def.id, def.onHit);
  return def;
}

/** Effects not owned by any one power (echo casts, generic flashes). */
export function defineEffects(effects: Partial<Record<EffectKind, EffectHooks>>) {
  registerEffects(effects);
}

export const powerDef = (id: PowerId) => powers.get(id);
export const ultDef = (id: UltId) => ults.get(id);
export const effectHooks = (kind: EffectKind) => effectRegistry.get(kind);
export const projectileHitHook = (s: SourceId) => hitHooks.get(s);
export const projectileExpireHook = (s: SourceId) => expireHooks.get(s);
export const allPowers = () => [...powers.values()];
export const allUlts = () => [...ults.values()];
