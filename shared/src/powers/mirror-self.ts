// MIRROR SELF: a perfect copy of you (same core, name and health bar) that moves opposite to
// you and fires real 40%-damage shots at your aim point whenever you shoot. It absorbs a few
// hits before shattering. Recast to swap places with it.

import { PLAYER, POWERS, WEAPONS } from "../config";
import { dist2 } from "../math/vec";
import { activeWeapon, weaponDamage } from "../sim/actions";
import { definePower } from "../sim/hooks";
import type { Effect, Player, PowerSlot } from "../sim/types";
import { PF, PROJ } from "../sim/types";
import type { World } from "../sim/world";
import { circle, glow, poly } from "./icon";

const C = POWERS.mirrorSelf;
const COLOR = "#D7E1FF";
const SIDE_OFFSET = 70;

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
  description: "Split off a clone that moves opposite to you and fires 40% shots at your aim. Enemies can't tell which is real. Recast to swap places.",
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
    const side = p.aim + Math.PI / 2;
    let x = p.x + Math.cos(side) * SIDE_OFFSET;
    let y = p.y + Math.sin(side) * SIDE_OFFSET;
    if (!w.insideArena(x, y, C.radius)) {
      x = p.x - Math.cos(side) * SIDE_OFFSET;
      y = p.y - Math.sin(side) * SIDE_OFFSET;
    }
    const e = w.spawnEffect({ kind: "clone", owner: p.id, source: "mirrorSelf", x, y, x2: p.x, y2: p.y, r: C.radius, life: C.duration, angle: p.aim, v: C.hp });
    // Settle it out of walls straight away.
    const body = { x: e.x, y: e.y, vx: 0, vy: 0 };
    w.collideBody(body, e.r);
    e.x = body.x;
    e.y = body.y;
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
        const body = { x: e.x - dx * scale, y: e.y - dy * scale, vx: -dx / dt, vy: -dy / dt };
        w.collideBody(body, e.r);
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
        // Fire when the owner fires (this tick), at most every fireCooldown.
        e.hits ??= new Map();
        const next = e.hits.get(0) ?? 0;
        if (p.sinceShot === 0 && w.time >= next) {
          e.hits.set(0, w.time + C.fireCooldown);
          const cos = Math.cos(e.angle);
          const sin = Math.sin(e.angle);
          const ricochet = (p.status.ricochet ?? 0) > 0;
          // The clone copies whatever gun the owner holds (at reduced damage).
          const gun = activeWeapon(p) ?? { id: "pistol" as const, rarity: 0 };
          const def = WEAPONS[gun.id];
          const pr = w.spawnProjectile({
            owner: p.id, kind: PROJ.clone, source: "mirrorSelf", x: e.x + cos * PLAYER.muzzle, y: e.y + sin * PLAYER.muzzle,
            vx: cos * def.speed, vy: sin * def.speed, damage: weaponDamage(gun) * C.damageMult, life: def.life, r: def.radius,
            flags: ricochet ? PF.ricochet : 0, maxBounces: ricochet ? POWERS.ricochetPrism.maxBounces : 0,
          });
          w.emit({ t: "shoot", by: p.id, x: pr.x, y: pr.y, angle: e.angle, weapon: gun.id });
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
