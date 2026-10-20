// Projectile flight: power fields bend or slow them, homing steers them, Energy Blade swings
// deflect them, then one swept step against players, decoys/clones and the map's solids
// (no tunneling). Guns, rockets and power projectiles all go through here.

import { NET, POWERS, ULTIMATES, WEAPONS } from "../config";
import { dist2, sweepCircle } from "../math/vec";
import { sweepSolids } from "./collision";
import { bulletBlocked } from "./los";
import { effectHooks, projectileExpireHook, projectileHitHook } from "./hooks";
import { stepGrenade } from "./throwables";
import type { Effect, Player, Projectile } from "./types";
import { PF, PROJ } from "./types";
import type { World } from "./world";

/** Runs a new projectile through the past positions of other players (shooter's view). */
export function lagCompensate(w: World, proj: Projectile) {
  const lat = Math.min(w.latencyTicks.get(proj.owner) ?? 0, Math.round((NET.lagCompMaxMs / 1000) * NET.tickRate));
  for (let k = lat; k > 0 && !proj.dead; k--) stepProjectile(w, proj, w.dt, w.tick - k);
}

export function stepProjectile(w: World, pr: Projectile, dt: number, asOfTick = w.tick) {
  // Held in orbit by an effect (Magnetar), which moves it; it fizzles if nothing refreshes it.
  if ((pr.flags & PF.captured) !== 0) {
    pr.life -= dt;
    if (pr.life <= 0) w.killProjectile(pr);
    return;
  }
  if (pr.kind === PROJ.grenade) {
    stepGrenade(w, pr, dt);
    return;
  }
  let scale = 1;
  for (const e of w.effects.values()) {
    const h = effectHooks(e.kind);
    if (h?.affectProjectile && !e.dead) {
      const s = h.affectProjectile(w, e, pr, dt);
      if (typeof s === "number") scale *= s;
      if (pr.dead) return;
    }
  }
  if ((pr.flags & PF.homing) !== 0) steerHoming(w, pr, dt);
  deflect(w, pr);
  const sdt = dt * scale;
  const ox = pr.x;
  const oy = pr.y;
  const nx = ox + pr.vx * sdt;
  const ny = oy + pr.vy * sdt;
  pr.life -= sdt;
  if (pr.portalCd > 0) pr.portalCd -= dt;

  // Players (swept), using rewound positions during lag compensation.
  let bestT = 2;
  let bestP: Player | null = null;
  for (const pl of w.players.values()) {
    if (!pl.alive || pl.id === pr.owner || pl.id === pr.lastHit || (pl.status.airborne ?? 0) > 0) continue;
    const pos = w.positionAt(pl, asOfTick);
    const t = sweepCircle(ox, oy, nx, ny, pos.x, pos.y, pl.r + pr.r);
    if (t >= 0 && t < bestT) {
      bestT = t;
      bestP = pl;
    }
  }
  // Decoys and clones absorb hits too.
  let bestE: Effect | null = null;
  for (const e of w.effects.values()) {
    if (e.dead || (e.kind !== "decoy" && e.kind !== "clone") || e.owner === pr.owner) continue;
    const t = sweepCircle(ox, oy, nx, ny, e.x, e.y, e.r + pr.r);
    if (t >= 0 && t < bestT) {
      bestT = t;
      bestP = null;
      bestE = e;
    }
  }
  const wall = sweepSolids(w.map, ox, oy, nx, ny, pr.r);
  if (wall && wall.t <= 1 && wall.t < bestT) {
    const hx = ox + (nx - ox) * wall.t;
    const hy = oy + (ny - oy) * wall.t;
    const s = wall.solid;
    const rocket = pr.kind === PROJ.rocket;
    const canBounce = pr.bounces < pr.maxBounces;
    if (s.maxHp > 0 && !rocket) w.damageSolid(s, pr.weapon ? pr.damage * 0.6 : 4, pr.owner, false, hx, hy);
    // Rockets blow on terrain, unless they still have Ricochet bounces left.
    if (rocket && !canBounce) {
      detonateRocket(w, pr, hx + wall.nx * 4, hy + wall.ny * 4);
      return;
    }
    if (canBounce) {
      pr.x = hx + wall.nx * 0.5;
      pr.y = hy + wall.ny * 0.5;
      const vn = pr.vx * wall.nx + pr.vy * wall.ny;
      pr.vx -= 2 * vn * wall.nx;
      pr.vy -= 2 * vn * wall.ny;
      bounce(w, pr);
      return;
    }
    w.emit({ t: "impact", x: hx, y: hy, color: w.colorOf(pr.owner), size: 1 });
    // A power projectile that hits terrain ends right there, like running out of flight
    // (a Singularity orb collapses against the wall instead of vanishing).
    pr.x = hx;
    pr.y = hy;
    projectileExpireHook(pr.source)?.(w, pr);
    w.killProjectile(pr);
    return;
  }
  if (bestT <= 1) {
    const hx = ox + (nx - ox) * bestT;
    const hy = oy + (ny - oy) * bestT;
    if (bestE) {
      effectHooks(bestE.kind)?.onProjectileHit?.(w, bestE, pr);
      w.emit({ t: "impact", x: hx, y: hy, color: w.colorOf(pr.owner), size: 1 });
      w.killProjectile(pr);
      return;
    }
    if (bestP) {
      hitPlayer(w, pr, bestP, hx, hy);
      if (pr.dead) return;
    }
  }
  pr.x = nx;
  pr.y = ny;
  if (pr.life <= 0) {
    if (pr.kind === PROJ.rocket) {
      detonateRocket(w, pr, pr.x, pr.y);
      return;
    }
    projectileExpireHook(pr.source)?.(w, pr);
    w.killProjectile(pr);
  }
}

function bounce(w: World, pr: Projectile) {
  pr.bounces++;
  pr.damage *= 1 + POWERS.ricochetPrism.damagePerBounce;
  pr.life = Math.max(pr.life, POWERS.ricochetPrism.bounceLife);
  w.emit({ t: "bounce", x: pr.x, y: pr.y, n: pr.bounces });
}

function steerHoming(w: World, pr: Projectile, dt: number) {
  let best: Player | null = null;
  let bd = ULTIMATES.huntersEye.homingRange ** 2;
  for (const p of w.players.values()) {
    if (!p.alive || p.id === pr.owner || (p.status.airborne ?? 0) > 0) continue;
    const d = dist2(pr.x, pr.y, p.x, p.y);
    // Homing only locks onto targets the shot has a clear line to: it never bends around walls or cover.
    if (d < bd && !bulletBlocked(w.map, pr.x, pr.y, p.x, p.y)) {
      bd = d;
      best = p;
    }
  }
  if (!best) return;
  const sp = Math.hypot(pr.vx, pr.vy);
  const want = Math.atan2(best.y - pr.y, best.x - pr.x);
  const cur = Math.atan2(pr.vy, pr.vx);
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const maxTurn = ULTIMATES.huntersEye.homingTurn * dt;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, d));
  pr.vx = Math.cos(cur + turn) * sp;
  pr.vy = Math.sin(cur + turn) * sp;
}

/** A swinging Energy Blade sends enemy projectiles back the way the swinger is aiming. */
function deflect(w: World, pr: Projectile) {
  const reach = WEAPONS.blade.reach;
  const half = ((WEAPONS.blade.arc / 2) * Math.PI) / 180;
  for (const p of w.players.values()) {
    if (p.swingT <= 0 || !p.alive || p.id === pr.owner) continue;
    const dx = pr.x - p.x;
    const dy = pr.y - p.y;
    if (dx * dx + dy * dy > (reach + pr.r) ** 2) continue;
    let da = Math.atan2(dy, dx) - p.aim;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > half) continue;
    const sp = Math.hypot(pr.vx, pr.vy);
    pr.vx = Math.cos(p.aim) * sp;
    pr.vy = Math.sin(p.aim) * sp;
    pr.owner = p.id;
    pr.flags = (pr.flags | PF.deflected) & ~PF.homing;
    pr.shotId = 0;
    pr.lastHit = 0;
    pr.life = Math.max(pr.life, pr.life0 * 0.6);
    w.emit({ t: "deflect", by: p.id, x: pr.x, y: pr.y });
    return;
  }
}

function detonateRocket(w: World, pr: Projectile, x: number, y: number) {
  const def = WEAPONS.rocket;
  w.explode(x, y, def.splash, pr.damage, pr.owner, "rocket", { knock: def.knock, hitOwner: true, falloff: true, walls: true });
  w.killProjectile(pr);
}

/** Damage falls off over a projectile's flight for weapons with falloff (shotgun pellets). */
function falloff(pr: Projectile): number {
  if (!pr.weapon) return 1;
  const min = WEAPONS[pr.weapon].falloffMin;
  if (min >= 1 || pr.life0 <= 0) return 1;
  const traveled = Math.max(0, 1 - Math.max(0, pr.life) / pr.life0);
  return 1 - (1 - min) * Math.min(1, traveled);
}

export function hitPlayer(w: World, pr: Projectile, target: Player, x: number, y: number) {
  if (pr.kind === PROJ.rocket) {
    // A direct hit lands the full blast on the target.
    detonateRocket(w, pr, x, y);
    return;
  }
  const crit = (pr.flags & PF.crit) !== 0;
  const hook = projectileHitHook(pr.source);
  if (hook) hook(w, pr, target, x, y);
  else {
    const dealt = w.damage(target, pr.damage * falloff(pr), pr.owner, pr.source, { crit, x, y });
    if (dealt > 0 && w.players.has(pr.owner)) w.stat(pr.owner).hits++;
  }
  w.emit({ t: "impact", x, y, color: w.colorOf(pr.owner), size: crit ? 2 : 1 });
  if (pr.pierce > 0 && !hook) {
    pr.pierce--;
    pr.lastHit = target.id;
    return;
  }
  w.killProjectile(pr);
}
