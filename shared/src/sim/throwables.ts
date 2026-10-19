// Throwables: a grenade rolls out along your aim (friction, bounces off walls), then on its
// fuse: Frag explodes, Smoke becomes a cloud that blocks line of sight, Shock Mine arms and
// waits for an enemy to step close.

import { ITEMS } from "../config";
import { sweepSolids } from "./collision";
import { defineEffects } from "./hooks";
import type { Player, Projectile, ThrowableId } from "./types";
import { PROJ } from "./types";
import type { World } from "./world";

const T = ITEMS.throwables;

export function throwItem(w: World, p: Player, item: ThrowableId, aim: number) {
  const def = T[item];
  const cos = Math.cos(aim);
  const sin = Math.sin(aim);
  w.spawnProjectile({
    owner: p.id, kind: PROJ.grenade, source: item, x: p.x + cos * p.r, y: p.y + sin * p.r,
    vx: cos * def.speed + p.vx * 0.3, vy: sin * def.speed + p.vy * 0.3, r: 9, life: def.fuse, damage: 0, maxBounces: 99,
  });
  w.firedAt.set(p.id, w.tick);
  w.emit({ t: "throw", by: p.id, x: p.x, y: p.y, item });
}

/** Rolling grenade: slows down, bounces off solids at half speed, goes off at the end of its fuse. */
export function stepGrenade(w: World, pr: Projectile, dt: number) {
  const item = pr.source as ThrowableId;
  const def = T[item] ?? T.frag;
  const k = Math.exp(-def.friction * dt);
  pr.vx *= k;
  pr.vy *= k;
  const nx = pr.x + pr.vx * dt;
  const ny = pr.y + pr.vy * dt;
  const hit = sweepSolids(w.map, pr.x, pr.y, nx, ny, pr.r);
  if (hit && hit.t < 1) {
    pr.x += (nx - pr.x) * hit.t + hit.nx * 0.5;
    pr.y += (ny - pr.y) * hit.t + hit.ny * 0.5;
    const vn = pr.vx * hit.nx + pr.vy * hit.ny;
    pr.vx = (pr.vx - 2 * vn * hit.nx) * 0.5;
    pr.vy = (pr.vy - 2 * vn * hit.ny) * 0.5;
  } else {
    pr.x = nx;
    pr.y = ny;
  }
  pr.life -= dt;
  if (pr.life > 0) return;
  w.killProjectile(pr);
  if (item === "frag") {
    w.explode(pr.x, pr.y, T.frag.radius, T.frag.damage, pr.owner, "frag", { knock: T.frag.knock, hitOwner: true, falloff: true, walls: true });
  } else if (item === "smoke") {
    w.spawnEffect({ kind: "smoke", owner: pr.owner, source: "smoke", x: pr.x, y: pr.y, r: T.smoke.radius, life: T.smoke.duration });
  } else {
    w.spawnEffect({ kind: "mine", owner: pr.owner, source: "mine", x: pr.x, y: pr.y, r: T.mine.trigger, life: T.mine.life });
  }
}

defineEffects({
  mine: {
    update(w, e) {
      for (const p of w.playersNear(e.x, e.y, T.mine.trigger, e.owner)) {
        if ((p.status.airborne ?? 0) > 0) continue;
        e.dead = true;
        for (const q of w.playersNear(e.x, e.y, T.mine.radius, e.owner)) w.addStatus(q, "shocked", T.mine.slow);
        w.explode(e.x, e.y, T.mine.radius, T.mine.damage, e.owner, "mine", { walls: true, noSolids: true });
        return;
      }
    },
  },
});
