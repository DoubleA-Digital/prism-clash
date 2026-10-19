// BOOMERANG GLAIVE: a spinning blade that arcs out to range, then homes back to you, cutting
// anyone it passes on both legs. It flies back to where you threw it: be there to catch it
// and the cooldown resets instantly.
// Combo (Event Horizon Blade): a glaive passing near a Singularity is captured into orbit
// around the black hole and shreds everyone near it until the hole detonates.

import { COMBOS, HAZARD_TICK, NET, POWERS } from "../config";
import { dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect, Player } from "../sim/types";
import type { World } from "../sim/world";
import { triggerCombo } from "./combos";
import { popDecoy } from "./decoy-swarm";
import { glow, poly } from "./icon";

const C = POWERS.boomerangGlaive;
/** Outbound flight time: constant deceleration from outSpeed to 0 over `range`. */
const OUT_TIME = (2 * C.range) / C.outSpeed;
const ORBIT_EVERY = Math.max(1, Math.round(HAZARD_TICK * NET.tickRate));

/** Glaive phases (Effect.n). */
export const GLAIVE = { out: 0, back: 1, caught: 2, orbit: 3 } as const;

function hitReady(e: Effect, key: number, now: number, cd: number): boolean {
  e.hits ??= new Map();
  if (now - (e.hits.get(key) ?? -99) < cd) return false;
  e.hits.set(key, now);
  return true;
}

function turnBack(e: Effect) {
  if (e.n === GLAIVE.out) e.n = GLAIVE.back;
}

function catchGlaive(e: Effect, owner: Player) {
  e.n = GLAIVE.caught;
  e.vx = 0;
  e.vy = 0;
  e.x = owner.x;
  e.y = owner.y;
  e.life = e.age + C.caughtLinger;
  for (const s of owner.slots) if (s && s.id === "boomerangGlaive") s.cd = 0;
}

function tryCapture(w: World, e: Effect): boolean {
  for (const s of w.effects.values()) {
    if (s.kind !== "singularity" || s.dead) continue;
    if (dist2(e.x, e.y, s.x, s.y) > C.captureRadius * C.captureRadius) continue;
    e.n = GLAIVE.orbit;
    e.link = s.id;
    e.angle = Math.atan2(e.y - s.y, e.x - s.x);
    e.life = e.age + Math.max(0.1, s.life - s.age);
    triggerCombo(w, e.owner, "eventHorizonBlade", s.x, s.y, [s.owner]);
    return true;
  }
  return false;
}

function flyOut(w: World, e: Effect, dt: number) {
  const t = Math.min(e.age, OUT_TIME);
  const fwd = C.outSpeed * (1 - t / OUT_TIME);
  const lat = C.curve * C.outSpeed * Math.sin((Math.PI * t) / OUT_TIME);
  const dx = Math.cos(e.angle);
  const dy = Math.sin(e.angle);
  // Curves to the thrower's left, like a right-handed boomerang.
  e.vx = dx * fwd + dy * lat;
  e.vy = dy * fwd - dx * lat;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  if (e.age >= OUT_TIME) turnBack(e);
  if (!w.insideArena(e.x, e.y, e.r)) {
    e.x -= e.vx * dt;
    e.y -= e.vy * dt;
    turnBack(e);
    w.emit({ t: "impact", x: e.x, y: e.y, color: w.colorOf(e.owner), size: 1 });
  }
}

/** Returns to the spot it was thrown from (x2, y2), not to you: stand your ground or move to
 *  intercept it to catch it. Close to you it's magnetized into your hand. */
function flyBack(w: World, e: Effect, owner: Player, dt: number) {
  const near = dist2(e.x, e.y, owner.x, owner.y) < C.catchAssist * C.catchAssist;
  if (!near && e.v < 1 && dist2(e.x, e.y, e.x2, e.y2) < C.catchRadius * C.catchRadius) e.v = 1;
  const tx = near ? owner.x : e.x2;
  const ty = near ? owner.y : e.y2;
  if (near || e.v < 1) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, (near ? C.returnSteer * 2 : C.returnSteer) * dt);
    e.vx += ((dx / d) * C.returnSpeed - e.vx) * k;
    e.vy += ((dy / d) * C.returnSpeed - e.vy) * k;
  }
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  // Missed: it sails on past the throw point and fades out at the wall.
  if (!w.insideArena(e.x, e.y, e.r)) e.dead = true;
}

function orbit(w: World, e: Effect, dt: number) {
  const s = w.effects.get(e.link);
  if (!s || s.dead || s.kind !== "singularity") {
    e.dead = true;
    return;
  }
  e.angle += C.orbitSpeed * dt;
  const nx = s.x + Math.cos(e.angle) * C.orbitRadius;
  const ny = s.y + Math.sin(e.angle) * C.orbitRadius;
  e.vx = (nx - e.x) / dt;
  e.vy = (ny - e.y) / dt;
  e.x = nx;
  e.y = ny;
  if (w.tick % ORBIT_EVERY !== 0) return;
  for (const p of w.playersNear(s.x, s.y, C.orbitHitRadius, e.owner)) {
    if ((p.status.airborne ?? 0) > 0) continue;
    w.damage(p, COMBOS.singularityOrbitDps * HAZARD_TICK, e.owner, "boomerangGlaive", { x: p.x, y: p.y });
  }
}

/** Blade contact: enemies, enemy decoys and pillars along the glaive's path. */
function cut(w: World, e: Effect) {
  for (const p of w.players.values()) {
    if (!p.alive || p.id === e.owner || (p.status.airborne ?? 0) > 0) continue;
    if (dist2(e.x, e.y, p.x, p.y) > (e.r + p.r) ** 2) continue;
    if (!hitReady(e, p.id, w.time, C.hitCooldown)) continue;
    const dealt = w.damage(p, C.damage, e.owner, "boomerangGlaive", { x: p.x, y: p.y });
    if (dealt > 0) w.stat(e.owner).hits++;
    const sp = Math.hypot(e.vx, e.vy) || 1;
    w.impulse(p, (e.vx / sp) * C.knockback, (e.vy / sp) * C.knockback);
    w.emit({ t: "impact", x: p.x, y: p.y, color: w.colorOf(e.owner), size: 2 });
  }
  for (const d of w.effects.values()) {
    if (d.kind !== "decoy" || d.dead || d.owner === e.owner) continue;
    if (dist2(e.x, e.y, d.x, d.y) <= (e.r + d.r) ** 2) popDecoy(w, d);
  }
  for (const pl of w.arena.pillars) {
    if (pl.dead || dist2(e.x, e.y, pl.x, pl.y) > (e.r + pl.r) ** 2) continue;
    if (hitReady(e, -pl.id, w.time, C.hitCooldown)) w.damagePillar(pl.id, C.pillarDamage, e.x, e.y);
    turnBack(e);
  }
}

export const boomerangGlaive = definePower({
  id: "boomerangGlaive",
  name: "Boomerang Glaive",
  description: "Throw a spinning blade that curves out and returns, cutting on both passes. Catch it to reset the cooldown.",
  color: "#2EF2D0",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    ctx.save();
    ctx.rotate(t * 3);
    const blade = (rot: number) => {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const pts: [number, number][] = [[0.08, -0.06], [0.46, -0.16], [0.36, 0.02], [0.1, 0.08]];
      return pts.map(([x, y]) => [(x * c - y * s) * size, (x * s + y * c) * size] as [number, number]);
    };
    glow(ctx, "#2EF2D0", size * 0.14, size * 0.05);
    ctx.fillStyle = "rgba(46,242,208,0.35)";
    for (let i = 0; i < 3; i++) {
      poly(ctx, blade((i * Math.PI * 2) / 3), true, true);
      poly(ctx, blade((i * Math.PI * 2) / 3));
    }
    glow(ctx, "#E8FFFA", size * 0.08, size * 0.05);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Return arrow
    glow(ctx, "#2EF2D0", size * 0.06, size * 0.035);
    ctx.setLineDash([size * 0.05, size * 0.05]);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.44, -0.4, Math.PI * 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  onCast(w, p) {
    const e = w.spawnEffect({
      kind: "glaive", owner: p.id, source: "boomerangGlaive", x: p.x + Math.cos(p.aim) * p.r, y: p.y + Math.sin(p.aim) * p.r,
      r: C.radius, life: C.maxFlight, angle: p.aim, n: GLAIVE.out, vx: Math.cos(p.aim) * C.outSpeed, vy: Math.sin(p.aim) * C.outSpeed,
      // (x2, y2) = the throw point it flies back to; v = 1 once it has passed it.
      x2: p.x, y2: p.y, v: 0,
    });
    e.hits = new Map();
    return true;
  },
  effects: {
    glaive: {
      update(w, e, dt) {
        const owner = w.players.get(e.owner);
        if (!owner || !owner.alive) {
          if (e.n !== GLAIVE.orbit) e.dead = true;
        }
        if (e.dead) return;
        if (e.n === GLAIVE.orbit) return orbit(w, e, dt);
        if (!owner) return;
        if (e.n === GLAIVE.caught) {
          e.x = owner.x;
          e.y = owner.y;
          return;
        }
        if (e.n === GLAIVE.out) flyOut(w, e, dt);
        else flyBack(w, e, owner, dt);
        if (tryCapture(w, e)) return;
        cut(w, e);
        if (e.n === GLAIVE.back && dist2(e.x, e.y, owner.x, owner.y) <= C.catchRadius * C.catchRadius) catchGlaive(e, owner);
      },
    },
  },
  bot: { role: "attack", range: 520 },
});
