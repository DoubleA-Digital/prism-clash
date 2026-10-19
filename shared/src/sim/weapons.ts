// Turning a frame's hand actions into the world: every gun fires through fireVolley (one
// generic projectile path tagged with weapon, rarity and owner, so powers can hook any
// gun's bullets), the Prism Lance traces a bouncing beam, and the Energy Blade swings.

import { GUN, NET, PLAYER, POWERS, WEAPONS } from "../config";
import { pointSegment } from "../math/vec";
import { activeWeapon, spreadNoise, volleyAngles, weaponDamage, type FrameOut } from "./actions";
import { solidsInCircle, sweepSolids } from "./collision";
import { bulletBlocked } from "./los";
import { throwItem } from "./throwables";
import type { InputFrame, Player, Projectile } from "./types";
import { PF, PROJ } from "./types";
import type { World } from "./world";

/** Hooks other systems (powers) can register to see every gun projectile as it is fired. */
const fireHooks: ((w: World, p: Player, pr: Projectile) => void)[] = [];
export function onGunFired(f: (w: World, p: Player, pr: Projectile) => void) {
  fireHooks.push(f);
}

/** Where a gun's projectiles start: the muzzle, or the body center if the muzzle is inside a wall. */
export function muzzle(w: { map: World["map"] }, x: number, y: number, angle: number): { x: number; y: number } {
  const mx = x + Math.cos(angle) * PLAYER.muzzle;
  const my = y + Math.sin(angle) * PLAYER.muzzle;
  return bulletBlocked(w.map, x, y, mx, my) ? { x, y } : { x: mx, y: my };
}

export function onFrameActions(w: World, p: Player, out: FrameOut, f: InputFrame) {
  for (let i = 0; i < out.shots; i++) fireVolley(w, p, f.shotId, out.bloom, f.aim);
  if (out.lance >= 0) fireLance(w, p, out.lance, f.aim);
  if (out.swing) swingBlade(w, p, f.aim);
  const item = activeWeapon(p);
  if (out.reload === "start" && item) w.emit({ t: "reload", by: p.id, weapon: item.id });
  if (out.heal === "start" && out.healItem) w.emit({ t: "heal", by: p.id, item: out.healItem, done: false });
  if (out.heal === "done" && out.healItem) {
    w.emit({ t: "heal", by: p.id, item: out.healItem, done: true });
    w.stat(p.id).healed++;
  }
  if (out.throwItem) throwItem(w, p, out.throwItem, f.aim);
}

function markFired(w: World, p: Player) {
  w.stat(p.id).shots++;
  w.firedAt.set(p.id, w.tick);
  p.sinceShot = 0;
}

/** One trigger pull of the active gun: one bullet, a shotgun's pellets, or a rocket. */
export function fireVolley(w: World, p: Player, shotId: number, bloom: number, aim: number) {
  const item = activeWeapon(p);
  if (!item) return;
  const def = WEAPONS[item.id];
  const noise = shotId > 0 ? (k: number) => spreadNoise(shotId, k) : () => w.rng.next() * 2 - 1;
  const angles = volleyAngles(item.id, aim, bloom, noise);
  const dmg = weaponDamage(item);
  let flags = PF.gun;
  let maxBounces = 0;
  if ((p.status.ricochet ?? 0) > 0) {
    flags |= PF.ricochet;
    maxBounces = POWERS.ricochetPrism.maxBounces;
  }
  const crit = p.cloakCrit || (p.status.cloaked ?? 0) > 0;
  if (crit) {
    flags |= PF.crit;
    p.cloakCrit = false;
    p.status.cloaked = 0;
  }
  if ((p.status.hunter ?? 0) > 0) flags |= PF.homing;
  const start = muzzle(w, p.x, p.y, aim);
  for (const a of angles) {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const pr = w.spawnProjectile({
      owner: p.id, kind: def.kind === "rocket" ? PROJ.rocket : PROJ.basic, x: start.x, y: start.y,
      vx: cos * def.speed + p.vx * GUN.inheritVelocity, vy: sin * def.speed + p.vy * GUN.inheritVelocity, r: def.radius, life: def.life,
      damage: crit ? dmg * GUN.critMult : dmg, flags, maxBounces, shotId, source: item.id, weapon: item.id, rarity: item.rarity, pierce: def.pierce,
    });
    for (const h of fireHooks) h(w, p, pr);
    w.lagCompensate(pr);
  }
  markFired(w, p);
  w.emit({ t: "shoot", by: p.id, x: start.x, y: start.y, angle: aim, weapon: item.id });
}

/**
 * Prism Lance: a hitscan beam traced the moment you release the trigger. It pierces every
 * player along the line (each hit once), stops at walls, and bounces off the first wall it
 * reaches. Damage scales with charge. Rendered by short-lived "beam" effects, one per segment.
 * Lag compensation rewinds other players to what the shooter saw.
 */
export function fireLance(w: World, p: Player, charge: number, aim: number) {
  const item = activeWeapon(p);
  if (!item) return;
  const def = WEAPONS.lance;
  const dmg = weaponDamage(item) * (def.minCharge + (1 - def.minCharge) * charge);
  const lat = Math.min(w.latencyTicks.get(p.id) ?? 0, Math.round((NET.lagCompMaxMs / 1000) * NET.tickRate));
  const hit = new Set<number>();
  let x = p.x;
  let y = p.y;
  let dx = Math.cos(aim);
  let dy = Math.sin(aim);
  let left = def.beamRange;
  for (let seg = 0; seg <= def.bounces && left > 20; seg++) {
    const ex = x + dx * left;
    const ey = y + dy * left;
    const wall = sweepSolids(w.map, x, y, ex, ey, 0);
    const t = wall ? wall.t : 1;
    const hx = x + (ex - x) * t;
    const hy = y + (ey - y) * t;
    for (const o of w.players.values()) {
      if (!o.alive || o.id === p.id || hit.has(o.id) || (o.status.airborne ?? 0) > 0) continue;
      const pos = w.positionAt(o, w.tick - lat);
      if (pointSegment(pos.x, pos.y, x, y, hx, hy).d > o.r + 10) continue;
      hit.add(o.id);
      const dealt = w.damage(o, dmg, p.id, "lance", { x: pos.x, y: pos.y, crit: charge >= 0.999 });
      if (dealt > 0) w.stat(p.id).hits++;
    }
    w.spawnEffect({ kind: "beam", owner: p.id, source: "lance", x, y, x2: hx, y2: hy, r: 6 + charge * 8, life: 0.32, n: seg, v: charge });
    if (!wall) break;
    w.damageSolid(wall.solid, dmg * 0.5, p.id, false, hx, hy);
    left -= Math.hypot(hx - x, hy - y);
    const dot = dx * wall.nx + dy * wall.ny;
    dx -= 2 * dot * wall.nx;
    dy -= 2 * dot * wall.ny;
    x = hx + wall.nx * 2;
    y = hy + wall.ny * 2;
    w.emit({ t: "bounce", x: hx, y: hy, n: seg + 1 });
  }
  markFired(w, p);
  w.emit({ t: "shoot", by: p.id, x: p.x, y: p.y, angle: aim, weapon: "lance" });
}

/** Energy Blade: a wide arc in front of you (the lunge itself is applied by actFrame). */
export function swingBlade(w: World, p: Player, aim: number) {
  const item = activeWeapon(p);
  if (!item) return;
  const def = WEAPONS.blade;
  const half = (def.arc / 2) * (Math.PI / 180);
  const dmg = weaponDamage(item);
  for (const o of w.players.values()) {
    if (!o.alive || o.id === p.id) continue;
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > def.reach + o.r) continue;
    let da = Math.atan2(dy, dx) - aim;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > half && d > o.r + p.r) continue;
    if (bulletBlocked(w.map, p.x, p.y, o.x, o.y)) continue;
    const dealt = w.damage(o, dmg, p.id, "blade", { x: o.x, y: o.y });
    if (dealt > 0) w.stat(p.id).hits++;
    w.impulse(o, (dx / (d || 1)) * 380, (dy / (d || 1)) * 380);
  }
  const cx = p.x + Math.cos(aim) * def.reach * 0.6;
  const cy = p.y + Math.sin(aim) * def.reach * 0.6;
  for (const s of solidsInCircle(w.map, cx, cy, def.reach * 0.55)) w.damageSolid(s, dmg, p.id, true, cx, cy);
  w.spawnEffect({ kind: "slash", owner: p.id, source: "blade", x: p.x, y: p.y, angle: aim, r: def.reach, life: def.swingTime + 0.05 });
  markFired(w, p);
  w.emit({ t: "slash", by: p.id, x: p.x, y: p.y, angle: aim });
}
