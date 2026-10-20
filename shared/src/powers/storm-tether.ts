// STORM TETHER: a fast lightning bolt that chains you to whoever it hits. Both of you take
// light chip damage while linked; if they pull farther than the max length the chain snaps
// for big damage. A bolt fired through a portal stays linked through it (Storm Gate).
// Walls cut the chain: if a wall (or rock, or crystal) sits across it for wallBreak seconds it
// breaks harmlessly, so ducking around a corner is the counterplay to a tether. Low cover,
// crates and glass don't cut it.

import { NET, POWERS } from "../config";
import { dist } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect, Player } from "../sim/types";
import { PF, PROJ } from "../sim/types";
import type { World } from "../sim/world";
import { wallBetween } from "./geometry";
import { glow, poly } from "./icon";

const C = POWERS.stormTether;
const COLOR = "#4DA6FF";
const chipEvery = Math.max(1, Math.round(C.chipInterval * NET.tickRate));

/**
 * tether: owner = caster, link = target, r = the length at which it snaps. v = 0 while live, 1 once snapped (a short recoil).
 * n = 1 while the shortest route runs through a portal pair; then (x, y) is the portal on the
 * caster's side and (x2, y2) the one on the target's side. hits[0] = entry portal id.
 */

function portalRoute(w: World, e: Effect): { ax: number; ay: number; bx: number; by: number } | null {
  const entryId = e.hits?.get(0);
  const a = entryId ? w.effects.get(entryId) : undefined;
  const b = a && a.link ? w.effects.get(a.link) : undefined;
  if (!a || !b || a.dead || b.dead) return null;
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
}

/** The chain's length: straight, or through the portal pair when that's shorter. */
function chain(w: World, e: Effect, a: Player, b: Player): { length: number; route: ReturnType<typeof portalRoute> } {
  const direct = dist(a.x, a.y, b.x, b.y);
  const route = portalRoute(w, e);
  const routed = route ? dist(a.x, a.y, route.ax, route.ay) + dist(route.bx, route.by, b.x, b.y) : Infinity;
  return routed < direct ? { length: routed, route } : { length: direct, route: null };
}

/** Hits key holding when a wall first cut the chain (absent while it's clear). */
const CUT_SINCE = -1;

/** Does a wall cut the chain as it currently runs (each leg of a portal route counts)? */
function cutByWall(w: World, a: Player, b: Player, route: ReturnType<typeof portalRoute>): boolean {
  if (!route) return wallBetween(w, a.x, a.y, b.x, b.y);
  return wallBetween(w, a.x, a.y, route.ax, route.ay) || wallBetween(w, route.bx, route.by, b.x, b.y);
}

/** Picks which portal of the pair the bolt entered (the orientation with the shorter chain). */
function entryPortal(w: World, owner: number, caster: Player, target: Player): number {
  for (const a of w.effects.values()) {
    if (a.kind !== "portal" || a.owner !== owner || a.dead || !a.link) continue;
    const b = w.effects.get(a.link);
    if (!b || b.dead) continue;
    const viaA = dist(caster.x, caster.y, a.x, a.y) + dist(b.x, b.y, target.x, target.y);
    const viaB = dist(caster.x, caster.y, b.x, b.y) + dist(a.x, a.y, target.x, target.y);
    return viaA <= viaB ? a.id : b.id;
  }
  return 0;
}

export const stormTether = definePower({
  id: "stormTether",
  name: "Storm Tether",
  description: `Fire a lightning bolt that chains you to an enemy. If they get too far away the chain snaps for ${C.snapDamage}. Walls cut it. Works through portals.`,
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size) {
    // Two nodes joined by a jagged bolt.
    glow(ctx, COLOR, size * 0.14, size * 0.08);
    poly(ctx, [[-size * 0.38, size * 0.3], [-size * 0.08, -size * 0.02], [size * 0.04, size * 0.12], [size * 0.38, -size * 0.3]], false);
    glow(ctx, "#ffffff", size * 0.1, size * 0.05);
    ctx.beginPath();
    ctx.arc(-size * 0.38, size * 0.3, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(size * 0.38, -size * 0.3, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
  },
  onCast(w, p) {
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    const pr = w.spawnProjectile({
      owner: p.id, kind: PROJ.tether, source: "stormTether", x: p.x + cos * 34, y: p.y + sin * 34,
      vx: cos * C.speed, vy: sin * C.speed, r: C.boltRadius, damage: C.boltDamage, life: C.range / C.speed,
    });
    w.lagCompensate(pr);
    return true;
  },
  onHit(w, pr, target, x, y) {
    const caster = w.players.get(pr.owner);
    w.damage(target, pr.damage, pr.owner, "stormTether", { x, y });
    if (!caster || !caster.alive || !target.alive) return;
    // One chain per caster: a new hit replaces the old one.
    for (const e of w.effects.values()) if (e.kind === "tether" && e.owner === caster.id) e.dead = true;
    const e = w.spawnEffect({ kind: "tether", owner: caster.id, link: target.id, source: "stormTether", x: (caster.x + target.x) / 2, y: (caster.y + target.y) / 2, r: C.maxLength, life: C.duration });
    if ((pr.flags & PF.portalled) !== 0 && pr.portalOwner) {
      const entry = entryPortal(w, pr.portalOwner, caster, target);
      if (entry) e.hits = new Map([[0, entry]]);
    }
    // Hits beyond the max length get some slack instead of snapping on the spot.
    e.r = Math.max(C.maxLength, chain(w, e, caster, target).length + C.slack);
    w.addStatus(target, "tethered", 0.2);
    w.addStatus(caster, "tethered", 0.2);
  },
  effects: {
    tether: {
      update(w, e) {
        if (e.v >= 1) return;
        const a = w.players.get(e.owner);
        const b = w.players.get(e.link);
        if (!a || !b || !a.alive || !b.alive) {
          e.dead = true;
          return;
        }
        const { length, route } = chain(w, e, a, b);
        if (route) {
          e.n = 1;
          e.x = route.ax;
          e.y = route.ay;
          e.x2 = route.bx;
          e.y2 = route.by;
        } else {
          e.n = 0;
          e.x = (a.x + b.x) / 2;
          e.y = (a.y + b.y) / 2;
        }
        // A wall across the chain for long enough breaks it, without the snap damage.
        e.hits ??= new Map();
        if (cutByWall(w, a, b, route)) {
          const since = e.hits.get(CUT_SINCE) ?? w.time;
          e.hits.set(CUT_SINCE, since);
          if (w.time - since >= C.wallBreak) {
            w.emit({ t: "impact", x: e.x, y: e.y, color: w.colorOf(a.id), size: 2 });
            e.v = 1;
            e.life = e.age + C.snapLinger;
            return;
          }
        } else e.hits.delete(CUT_SINCE);
        if (length > e.r) {
          // Snap: big hit on the target, then a brief recoil visual.
          w.damage(b, C.snapDamage, a.id, "stormTether", { x: b.x, y: b.y });
          w.emit({ t: "impact", x: b.x, y: b.y, color: w.colorOf(a.id), size: 3 });
          e.v = 1;
          e.life = e.age + C.snapLinger;
          return;
        }
        w.addStatus(a, "tethered", 0.2);
        w.addStatus(b, "tethered", 0.2);
        if (w.tick % chipEvery === 0) {
          const chip = C.chipDps * C.chipInterval;
          w.damage(b, chip, a.id, "stormTether");
          if (a.alive && b.alive) w.damage(a, chip, b.id, "stormTether");
        }
      },
    },
  },
  bot: { role: "attack", range: 620 },
});
