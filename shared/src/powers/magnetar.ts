// MAGNETAR: a field around you that rips enemy projectiles out of the air and spins them in
// orbit (they stop doing damage). Recast, or let it run out, to fling them all outward as
// your own shots. Catching shots frozen by a Time Bubble is the Frozen Harvest combo.

import { POWERS, SHOT } from "../config";
import { dist2, TAU } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect, Player, Projectile } from "../sim/types";
import { PF, PROJ } from "../sim/types";
import type { World } from "../sim/world";
import { triggerCombo } from "./combos";
import { arc, circle, glow } from "./icon";

const C = POWERS.magnetar;
const COLOR = "#FF5A4E";

/**
 * magnet: follows the owner. angle = orbit phase, n = how many shots it holds.
 * hits = captured projectile ids, in capture order (their orbit slots).
 */

function fieldOf(w: World, ownerId: number): Effect | undefined {
  for (const e of w.effects.values()) if (e.kind === "magnet" && e.owner === ownerId && !e.dead) return e;
  return undefined;
}

function heldProjectiles(w: World, e: Effect): Projectile[] {
  const held = e.hits;
  if (!held || held.size === 0) return [];
  const out: Projectile[] = [];
  for (const pr of w.projectiles) if (!pr.dead && (pr.flags & PF.captured) !== 0 && held.has(pr.id)) out.push(pr);
  return out;
}

function capturable(pr: Projectile): boolean {
  return pr.kind !== PROJ.meteor && pr.kind !== PROJ.singularityOrb && (pr.flags & PF.captured) === 0;
}

/** Flings everything held outward, evenly spread, as the field owner's shots. */
function release(w: World, e: Effect, owner: Player) {
  const list = heldProjectiles(w, e);
  e.hits?.clear();
  e.n = 0;
  const n = list.length;
  list.forEach((pr, i) => {
    const a = e.angle + (i / n) * TAU;
    pr.owner = owner.id;
    pr.flags = (pr.flags & ~(PF.captured | PF.retargeted | PF.homing)) | PF.released;
    pr.x = owner.x + Math.cos(a) * C.orbitRadius;
    pr.y = owner.y + Math.sin(a) * C.orbitRadius;
    pr.vx = Math.cos(a) * C.releaseSpeed;
    pr.vy = Math.sin(a) * C.releaseSpeed;
    pr.life = C.releaseLife;
    pr.damage = Math.max(pr.damage, SHOT.damage);
    pr.shotId = 0;
    pr.portalCd = 0;
  });
  if (n > 0) w.emit({ t: "cast", by: owner.id, power: "magnetar", x: owner.x, y: owner.y, angle: e.angle });
}

export const magnetar = definePower({
  id: "magnetar",
  name: "Magnetar",
  description: "A field that captures enemy shots into orbit around you for up to 5s. Recast to fire them all back out as your own.",
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    // A core with field arcs and a few orbiting shots.
    glow(ctx, COLOR, size * 0.12, size * 0.06);
    arc(ctx, 0, 0, size * 0.4, -Math.PI * 0.85, -Math.PI * 0.15);
    arc(ctx, 0, 0, size * 0.4, Math.PI * 0.15, Math.PI * 0.85);
    glow(ctx, "#6FB7FF", size * 0.1, size * 0.06);
    arc(ctx, 0, 0, size * 0.4, Math.PI * 0.9, Math.PI * 1.1);
    arc(ctx, 0, 0, size * 0.4, -Math.PI * 0.1, Math.PI * 0.1);
    glow(ctx, "#ffffff", size * 0.1, size * 0.05);
    circle(ctx, 0, 0, size * 0.1, true);
    for (let i = 0; i < 4; i++) {
      const a = t * 2 + (i / 4) * Math.PI * 2;
      circle(ctx, Math.cos(a) * size * 0.25, Math.sin(a) * size * 0.25, size * 0.045, true);
    }
  },
  onCast(w, p, slot) {
    // A second cast while one is up (Echo Storm) just extends the field, keeping its catch.
    const old = fieldOf(w, p.id);
    if (old) {
      old.life = old.age + C.duration;
      slot.recast = C.duration;
      return true;
    }
    w.spawnEffect({ kind: "magnet", owner: p.id, source: "magnetar", x: p.x, y: p.y, r: C.radius, life: C.duration, angle: p.aim });
    slot.recast = C.duration;
    return true;
  },
  onRecast(w, p, slot) {
    slot.recast = 0;
    const e = fieldOf(w, p.id);
    if (!e) return;
    release(w, e, p);
    e.dead = true;
  },
  effects: {
    magnet: {
      update(w, e, dt) {
        const p = w.players.get(e.owner);
        if (!p || !p.alive) {
          e.dead = true;
          return;
        }
        e.x = p.x;
        e.y = p.y;
        e.angle = (e.angle + C.orbitSpeed * dt) % TAU;
        const list = heldProjectiles(w, e);
        // Forget anything that vanished; keep slots evenly spaced.
        if (e.hits && list.length !== e.hits.size) e.hits = new Map(list.map((pr) => [pr.id, 1]));
        e.n = list.length;
        const k = 1 - Math.exp(-14 * dt);
        list.forEach((pr, i) => {
          const a = e.angle + (i / list.length) * TAU;
          const tx = p.x + Math.cos(a) * C.orbitRadius;
          const ty = p.y + Math.sin(a) * C.orbitRadius;
          // Pulled smoothly into its slot, then locked in orbit.
          pr.x += (tx - pr.x) * k;
          pr.y += (ty - pr.y) * k;
          pr.vx = 0;
          pr.vy = 0;
          pr.life = C.holdLife;
        });
      },
      affectProjectile(w, e, pr) {
        if (e.dead || pr.owner === e.owner || !capturable(pr)) return;
        if (dist2(pr.x, pr.y, e.x, e.y) > e.r * e.r) return;
        e.hits ??= new Map();
        if (e.hits.size >= C.maxCaptured) return;
        // Frozen Harvest: plucking a shot out of a Time Bubble.
        for (const b of w.effects.values()) {
          if (b.kind === "bubble" && !b.dead && dist2(pr.x, pr.y, b.x, b.y) < b.r * b.r) {
            triggerCombo(w, e.owner, "frozenHarvest", pr.x, pr.y, [b.owner]);
            break;
          }
        }
        pr.flags |= PF.captured;
        pr.vx = 0;
        pr.vy = 0;
        pr.life = C.holdLife;
        e.hits.set(pr.id, 1);
        e.n = e.hits.size;
        w.emit({ t: "impact", x: pr.x, y: pr.y, color: w.colorOf(e.owner), size: 1 });
        return 0;
      },
      onExpire(w, e) {
        const p = w.players.get(e.owner);
        if (p && p.alive) release(w, e, p);
        if (p) {
          const slot = p.slots.find((s) => s?.id === "magnetar");
          if (slot) slot.recast = 0;
        }
      },
    },
  },
  bot: { role: "zone" },
});
