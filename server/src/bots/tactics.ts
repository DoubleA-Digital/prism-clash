// Per-power bot tactics: when each power is worth casting, where to aim it (leading the
// target by the projectile's travel time), and when to recast. Bots stay beatable through
// reaction delay and aim error (applied by the brain), not by playing dumb with powers.

import { POWERS, ULTIMATES, type Player, type PowerId, type UltId, type World } from "@prism/shared";

export interface CastPlan {
  /** 0, 1 = power slots, 3 = ultimate. */
  slot: number;
  /** Exact aim for the cast tick (the brain adds difficulty-based error). */
  aim: number | null;
}

export interface TacticsContext {
  w: World;
  me: Player;
  target: Player | null;
  /** Enemy projectiles that will reach us within ~0.6 s. */
  threats: number;
  /** HP lost over the last 2.5 s. */
  recentLoss: number;
  inZoneDanger: boolean;
  /** 0..1 how willing this difficulty is to spend powers. */
  eagerness: number;
  rand: () => number;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Aim that leads a moving target for a projectile of the given speed. */
export function leadAim(me: Player, t: Player, speed: number): number {
  const d = dist(me, t);
  const time = speed > 0 ? d / speed : 0;
  const vx = t.vx + t.px;
  const vy = t.vy + t.py;
  return Math.atan2(t.y + vy * time * 0.8 - me.y, t.x + vx * time * 0.8 - me.x);
}

function nearEnemies(c: TacticsContext, r: number): Player[] {
  return c.w.enemiesOf(c.me).filter((o) => dist(o, c.me) < r && !c.w.hiddenFrom(c.me, o));
}

function los(c: TacticsContext, t: Player) {
  return !c.w.blocked(c.me.x, c.me.y, t.x, t.y);
}

/** Should this power be cast now? Returns an aim (or null for "current aim is fine"), or false. */
function powerPlan(c: TacticsContext, id: PowerId): number | null | false {
  const { me, target: t, w } = c;
  const d = t ? dist(me, t) : Infinity;
  const hp = me.hp;
  const fighting = !!t && d < 700;
  switch (id) {
    case "singularity":
      return t && d < 560 && d > 120 && los(c, t) ? leadAim(me, t, POWERS.singularity.speed) : false;
    case "stormTether":
      return t && d < POWERS.stormTether.range * 0.85 && los(c, t) ? leadAim(me, t, POWERS.stormTether.speed) : false;
    case "gravityFlip":
      return t && d < 620 && los(c, t) ? leadAim(me, t, POWERS.gravityFlip.speed) : false;
    case "boomerangGlaive":
      return t && d < POWERS.boomerangGlaive.range && d > 90 && los(c, t) ? leadAim(me, t, POWERS.boomerangGlaive.outSpeed) : false;
    case "phantomMark":
      // Dash straight through someone close.
      return t && d < 240 && los(c, t) ? Math.atan2(t.y - me.y, t.x - me.x) : false;
    case "shockwaveSlam":
      return nearEnemies(c, POWERS.shockwaveSlam.radius * 0.85).length >= 1 ? null : false;
    case "moltenPath":
      // Lay lava while kiting or when someone is chasing close.
      return t && d < 380 ? null : false;
    case "timeBubble":
      return nearEnemies(c, POWERS.timeBubble.radius).length >= 1 || c.threats >= 2 ? null : false;
    case "magnetar":
      return c.threats >= 2 || (c.threats >= 1 && hp < 50) ? null : false;
    case "mirrorSelf":
      return fighting && d > 200 ? null : false;
    case "ricochetPrism":
      return fighting ? null : false;
    case "thirdParty":
      return t && d < 600 && w.hurtByOther(t, me.id) ? null : fighting && c.rand() < 0.25 ? null : false;
    case "bountyBeacon":
      return w.enemiesOf(me).length > 0 && fighting ? null : false;
    case "voidCloak":
      return hp < 40 || (t && d > 500 && d < 800 && c.rand() < 0.3) ? null : false;
    case "decoySwarm":
      return hp < 55 && (fighting || c.threats > 0) ? null : false;
    case "chronoRewind":
      return c.recentLoss >= 30 ? null : false;
    case "portalPair":
      // Drop an exit when healthy, recast to escape when hurt (handled by recast logic).
      return fighting && hp > 60 && c.rand() < 0.4 ? null : false;
    case "hexSwap": {
      if (!t || d > POWERS.hexSwap.range * 0.9 || !los(c, t)) return false;
      // Swap when the enemy stands somewhere better (inside the zone while we're outside), or to break a chase.
      if (c.inZoneDanger) return Math.atan2(t.y - me.y, t.x - me.x);
      return hp < 45 && d > 350 ? Math.atan2(t.y - me.y, t.x - me.x) : false;
    }
    default:
      return false;
  }
}

function recastWanted(c: TacticsContext, id: PowerId, slotAge: number): number | null | false {
  const { me, target: t } = c;
  switch (id) {
    case "portalPair":
      // Blue portal once we've moved away; escape route is set.
      return slotAge > 1.2 && (me.hp < 50 || c.rand() < 0.08) ? null : false;
    case "mirrorSelf": {
      // Swap with the clone when it's safer (farther from the target) and we're hurt.
      const clone = [...c.w.effects.values()].find((e) => e.kind === "clone" && e.owner === me.id && !e.dead);
      if (!clone || !t) return false;
      return me.hp < 45 && dist(clone, t) > dist(me, t) + 120 ? null : false;
    }
    case "magnetar": {
      const field = [...c.w.effects.values()].find((e) => e.kind === "magnet" && e.owner === me.id && !e.dead);
      if (!field || !t) return false;
      return field.n >= 3 && los(c, t) ? Math.atan2(t.y - me.y, t.x - me.x) : false;
    }
    default:
      return c.rand() < 0.2 ? null : false;
  }
}

function ultPlan(c: TacticsContext, id: UltId): number | null | false {
  const { me, target: t } = c;
  const d = t ? dist(me, t) : Infinity;
  const near = nearEnemies(c, 650).length;
  switch (id) {
    case "meteorRain":
      return t && d > 250 && d < 760 ? Math.atan2(t.y - me.y, t.x - me.x) : false;
    case "riftCollapse":
      return t && d < ULTIMATES.riftCollapse.halfLength * 0.7 ? Math.atan2(t.y - me.y, t.x - me.x) : false;
    case "overdrive":
      return t && d < 600 && los(c, t) ? null : false;
    case "echoStorm":
      return me.slots.some((s) => s && s.cd <= 0) && t && d < 650 ? null : false;
    case "finalStand":
      return (me.hp < 45 && near >= 1) || near >= 2 ? null : false;
    case "huntersEye":
      return (t && d < 700) || near === 0 ? null : false;
    default:
      return false;
  }
}

/** The single best cast this think, if any. */
export function chooseCast(c: TacticsContext, slotAges: number[]): CastPlan | null {
  const me = c.me;
  if ((me.status.airborne ?? 0) > 0) return null;
  // Ultimate first: it's the biggest swing.
  if (me.ult && me.ult.charge >= 100) {
    const aim = ultPlan(c, me.ult.id);
    if (aim !== false) return { slot: 3, aim };
  }
  if (c.rand() > c.eagerness) return null;
  const order = [0, 1].sort(() => c.rand() - 0.5);
  for (const i of order) {
    const s = me.slots[i];
    if (!s) continue;
    if (s.recast > 0) {
      const aim = recastWanted(c, s.id, slotAges[i] ?? 0);
      if (aim !== false) return { slot: i, aim };
      continue;
    }
    if (s.cd > 0) continue;
    const aim = powerPlan(c, s.id);
    if (aim !== false) return { slot: i, aim };
  }
  return null;
}
