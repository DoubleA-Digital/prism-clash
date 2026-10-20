// MIRROR SELF: a perfect copy of you (same look, name and health bar) that moves opposite to
// you and copies whatever you fire, at reduced damage, toward your aim point: one bullet, a
// shotgun's pellets, a rocket, a Prism Lance beam or an Energy Blade swing. It absorbs a few
// hits before shattering. It walks into walls like a player (never through them). Recast to
// swap places with it.

import { POWERS, WEAPONS } from "../config";
import { dist2, pointSegment } from "../math/vec";
import { activeWeapon, volleyAngles, weaponDamage } from "../sim/actions";
import { solidsInCircle, sweepSolids } from "../sim/collision";
import { definePower } from "../sim/hooks";
import { bulletBlocked } from "../sim/los";
import type { Effect, Player, PowerSlot, WeaponId } from "../sim/types";
import { PF, PROJ } from "../sim/types";
import { muzzle } from "../sim/weapons";
import type { World } from "../sim/world";
import { moveBody, walkTo } from "./geometry";
import { circle, glow, poly } from "./icon";

const C = POWERS.mirrorSelf;
const COLOR = "#D7E1FF";

/**
 * clone: x/y its position, angle its aim, v its remaining hp, n how many swaps happened (the
 * client flashes on change). x2/y2 hold the owner's last position (server bookkeeping).
 * hits[0] = time of its next allowed shot.
 */

function cloneOf(w: World, ownerId: number): Effect | undefined {
  for (const e of w.effects.values()) if (e.kind === "clone" && e.owner === ownerId && !e.dead) return e;
  return undefined;
}

function slotOf(p: Player): PowerSlot | undefined {
  return p.slots.find((s): s is PowerSlot => !!s && s.id === "mirrorSelf");
}

function inForeignBubble(w: World, x: number, y: number, owner: number): boolean {
  for (const e of w.effects.values()) {
    if (e.kind === "bubble" && !e.dead && e.owner !== owner && dist2(x, y, e.x, e.y) < e.r * e.r) return true;
  }
  return false;
}

/** The clone's copy of a Prism Lance shot: a beam from the clone along its aim, bouncing like the real one. */
function cloneBeam(w: World, e: Effect, owner: Player, dmg: number) {
  const def = WEAPONS.lance;
  const hit = new Set<number>([owner.id]);
  let x = e.x;
  let y = e.y;
  let dx = Math.cos(e.angle);
  let dy = Math.sin(e.angle);
  let left = def.beamRange;
  for (let seg = 0; seg <= def.bounces && left > 20; seg++) {
    const wall = sweepSolids(w.map, x, y, x + dx * left, y + dy * left, 0);
    const t = wall ? wall.t : 1;
    const hx = x + dx * left * t;
    const hy = y + dy * left * t;
    for (const o of w.players.values()) {
      if (!o.alive || hit.has(o.id) || (o.status.airborne ?? 0) > 0) continue;
      if (pointSegment(o.x, o.y, x, y, hx, hy).d > o.r + 10) continue;
      hit.add(o.id);
      w.damage(o, dmg, owner.id, "mirrorSelf", { x: o.x, y: o.y });
    }
    w.spawnEffect({ kind: "beam", owner: owner.id, source: "mirrorSelf", x, y, x2: hx, y2: hy, r: 8, life: 0.32, n: seg, v: 0.6 });
    if (!wall) break;
    w.damageSolid(wall.solid, dmg * 0.5, owner.id, false, hx, hy);
    left -= Math.hypot(hx - x, hy - y);
    const dot = dx * wall.nx + dy * wall.ny;
    dx -= 2 * dot * wall.nx;
    dy -= 2 * dot * wall.ny;
    x = hx + wall.nx * 2;
    y = hy + wall.ny * 2;
  }
}

/** The clone's copy of an Energy Blade swing: the same arc around the clone (no lunge). */
function cloneSlash(w: World, e: Effect, owner: Player, dmg: number) {
  const def = WEAPONS.blade;
  const half = (def.arc / 2) * (Math.PI / 180);
  for (const o of w.players.values()) {
    if (!o.alive || o.id === owner.id) continue;
    const dx = o.x - e.x;
    const dy = o.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > def.reach + o.r) continue;
    let da = Math.atan2(dy, dx) - e.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > half && d > o.r + e.r) continue;
    if (bulletBlocked(w.map, e.x, e.y, o.x, o.y)) continue;
    w.damage(o, dmg, owner.id, "mirrorSelf", { x: o.x, y: o.y });
    w.impulse(o, (dx / (d || 1)) * 260, (dy / (d || 1)) * 260);
  }
  const cx = e.x + Math.cos(e.angle) * def.reach * 0.6;
  const cy = e.y + Math.sin(e.angle) * def.reach * 0.6;
  for (const s of solidsInCircle(w.map, cx, cy, def.reach * 0.55)) w.damageSolid(s, dmg, owner.id, true, cx, cy);
  w.spawnEffect({ kind: "slash", owner: owner.id, source: "mirrorSelf", x: e.x, y: e.y, angle: e.angle, r: def.reach, life: def.swingTime + 0.05 });
}

/** The clone fires a copy of the owner's gun in hand, at damageMult, from its own muzzle. */
function cloneFire(w: World, e: Effect, owner: Player) {
  const gun: { id: WeaponId; rarity: number } = activeWeapon(owner) ?? { id: "pistol", rarity: 0 };
  const def = WEAPONS[gun.id];
  const dmg = weaponDamage(gun) * C.damageMult;
  if (def.kind === "lance") cloneBeam(w, e, owner, dmg);
  else if (def.kind === "blade") cloneSlash(w, e, owner, dmg);
  else {
    const start = muzzle(w, e.x, e.y, e.angle);
    const ricochet = (owner.status.ricochet ?? 0) > 0;
    let flags = ricochet ? PF.ricochet : 0;
    if ((owner.status.hunter ?? 0) > 0) flags |= PF.homing;
    for (const a of volleyAngles(gun.id, e.angle, 0, () => w.rng.next() * 2 - 1)) {
      w.spawnProjectile({
        owner: owner.id, kind: def.kind === "rocket" ? PROJ.rocket : PROJ.clone, source: "mirrorSelf", weapon: gun.id, rarity: gun.rarity,
        x: start.x, y: start.y, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, damage: dmg, life: def.life, r: def.radius,
        pierce: def.pierce, flags, maxBounces: ricochet ? POWERS.ricochetPrism.maxBounces : 0,
      });
    }
  }
  w.emit({ t: "shoot", by: owner.id, x: e.x, y: e.y, angle: e.angle, weapon: gun.id });
}

function shatter(w: World, e: Effect) {
  e.dead = true;
  w.emit({ t: "explode", x: e.x, y: e.y, r: 70, source: "mirrorSelf", by: e.owner });
  const owner = w.players.get(e.owner);
  const slot = owner ? slotOf(owner) : undefined;
  if (slot) slot.recast = 0;
}

export const mirrorSelf = definePower({
  id: "mirrorSelf",
  name: "Mirror Self",
  description: `Split off a clone that moves opposite to you and copies your gun at ${Math.round(C.damageMult * 100)}% damage, aimed where you aim. Enemies can't tell which is real. Recast to swap places.`,
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size) {
    // Two cores either side of a mirror line, one solid, one ghosted.
    glow(ctx, "#ffffff", size * 0.06, size * 0.04);
    ctx.setLineDash([size * 0.05, size * 0.05]);
    poly(ctx, [[0, -size * 0.42], [0, size * 0.42]], false);
    ctx.setLineDash([]);
    glow(ctx, COLOR, size * 0.12, size * 0.07);
    circle(ctx, -size * 0.2, 0, size * 0.15);
    circle(ctx, -size * 0.2, 0, size * 0.05, true);
    poly(ctx, [[-size * 0.42, -size * 0.06], [-size * 0.5, 0], [-size * 0.42, size * 0.06]], false);
    ctx.globalAlpha *= 0.55;
    circle(ctx, size * 0.2, 0, size * 0.15);
    circle(ctx, size * 0.2, 0, size * 0.05, true);
    poly(ctx, [[size * 0.42, -size * 0.06], [size * 0.5, 0], [size * 0.42, size * 0.06]], false);
    ctx.globalAlpha /= 0.55;
  },
  onCast(w, p, slot) {
    // Several clones can coexist (Echo Storm); the recast swaps with the oldest.
    // Split sideways from the aim so both cores are visible from the first frame.
    // It walks out from you, so a wall beside you stops it instead of it appearing in the next
    // room; whichever side has more room wins.
    const side = p.aim + Math.PI / 2;
    const a = walkTo(w, p.x, p.y, p.x + Math.cos(side) * C.sideOffset, p.y + Math.sin(side) * C.sideOffset, C.radius);
    const b = walkTo(w, p.x, p.y, p.x - Math.cos(side) * C.sideOffset, p.y - Math.sin(side) * C.sideOffset, C.radius);
    const pick = dist2(a.x, a.y, p.x, p.y) >= dist2(b.x, b.y, p.x, p.y) - 1 ? a : b;
    w.spawnEffect({ kind: "clone", owner: p.id, source: "mirrorSelf", x: pick.x, y: pick.y, x2: p.x, y2: p.y, r: C.radius, life: C.duration, angle: p.aim, v: C.hp });
    slot.recast = C.duration;
    return true;
  },
  onRecast(w, p, slot) {
    slot.recast = 0;
    const e = cloneOf(w, p.id);
    if (!e) return;
    const px = p.x;
    const py = p.y;
    w.teleport(p, e.x, e.y);
    e.x = px;
    e.y = py;
    e.x2 = p.x;
    e.y2 = p.y;
    e.n++;
    w.emit({ t: "cast", by: p.id, power: "mirrorSelf", x: p.x, y: p.y, angle: p.aim });
  },
  effects: {
    clone: {
      update(w, e, dt) {
        const p = w.players.get(e.owner);
        if (!p || !p.alive) {
          e.dead = true;
          return;
        }
        // Mirror the owner's real displacement (not their input), ignoring teleports.
        let dx = p.x - e.x2;
        let dy = p.y - e.y2;
        if (dx * dx + dy * dy > 90 * 90 || p.warp > 0) {
          dx = 0;
          dy = 0;
        }
        const scale = (inForeignBubble(w, e.x, e.y, e.owner) ? POWERS.timeBubble.slow : 1) / ((p.status.timeBubble ?? 0) > 0 ? POWERS.timeBubble.slow : 1);
        const body = { x: e.x, y: e.y, vx: -dx / dt, vy: -dy / dt };
        moveBody(w, body, -dx * scale, -dy * scale, e.r);
        e.vx = (body.x - e.x) / dt;
        e.vy = (body.y - e.y) / dt;
        e.x = body.x;
        e.y = body.y;
        e.x2 = p.x;
        e.y2 = p.y;
        // Aim at the owner's aim point.
        const ax = p.x + Math.cos(p.aim) * C.aimDistance;
        const ay = p.y + Math.sin(p.aim) * C.aimDistance;
        e.angle = Math.atan2(ay - e.y, ax - e.x);
        // Fire when the owner fires (this tick), at most every max(fireCooldown, the gun's cooldown).
        e.hits ??= new Map();
        const next = e.hits.get(0) ?? 0;
        if (p.sinceShot === 0 && w.time >= next) {
          const gun = activeWeapon(p);
          e.hits.set(0, w.time + Math.max(C.fireCooldown, gun ? WEAPONS[gun.id].fireCd : 0));
          cloneFire(w, e, p);
        }
      },
      onProjectileHit(w, e, pr) {
        if (e.dead) return;
        e.v -= pr.damage;
        // Sell the illusion: the shooter sees a damage number pop on the clone.
        w.emit({ t: "hit", target: 0, by: pr.owner, amount: Math.round(pr.damage), crit: (pr.flags & PF.crit) !== 0, source: pr.source, x: e.x, y: e.y, armor: false });
        if (e.v <= 0) shatter(w, e);
      },
      onExpire(w, e) {
        w.emit({ t: "impact", x: e.x, y: e.y, color: w.colorOf(e.owner), size: 2 });
      },
    },
  },
  bot: { role: "buff" },
});
