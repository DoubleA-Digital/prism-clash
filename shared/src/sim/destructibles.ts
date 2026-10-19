// Breakable terrain (crates, barrels, glass, fences) and explosions. Destructible state is
// server-authoritative: hp and broken flags are synced to clients in snapshots. Barrels
// explode when broken, a beat later, so chains ripple outward instead of all at once.

import { TERRAIN } from "../config";
import { dist2 } from "../math/vec";
import { solidsInCircle } from "./collision";
import { visionBlocked } from "./los";
import { dropFromCrate } from "./loot";
import type { Solid } from "./map/types";
import type { SourceId } from "./types";
import type { World } from "./world";

export interface PendingBlast {
  x: number;
  y: number;
  at: number;
  by: number;
}

export interface ExplodeOpts {
  knock?: number;
  hitOwner?: boolean;
  /** Damage falls off to half at the edge. */
  falloff?: boolean;
  /** Walls (vision blockers) shield players from the blast. */
  walls?: boolean;
  /** Skip breaking terrain. */
  noSolids?: boolean;
}

/** Hurts a destructible. Tough ones (fences) only take explosive or melee damage. */
export function damageSolid(w: World, s: Solid, amount: number, by: number, explosive: boolean, x: number, y: number) {
  if (s.dead || s.maxHp <= 0 || amount <= 0) return;
  if (s.tough && !explosive) return;
  s.hp -= amount;
  if (s.hp > 0) {
    w.emit({ t: "solidHit", id: s.id, x, y });
    return;
  }
  s.hp = 0;
  s.dead = true;
  const cx = (s.x0 + s.x1) / 2;
  const cy = (s.y0 + s.y1) / 2;
  w.emit({ t: "solidBroken", id: s.id, x: cx, y: cy });
  if (s.kind === "crate") dropFromCrate(w, cx, cy);
  if (s.kind === "barrel") w.blasts.push({ x: cx, y: cy, at: w.time + TERRAIN.barrel.chainDelay, by });
}

export function stepBlasts(w: World) {
  if (!w.blasts.length) return;
  const due = w.blasts.filter((b) => b.at <= w.time);
  w.blasts = w.blasts.filter((b) => b.at > w.time);
  const B = TERRAIN.barrel;
  for (const b of due) explode(w, b.x, b.y, B.radius, B.damage, b.by, "barrel", { knock: B.knock, hitOwner: true, falloff: true, walls: true });
}

/** Damages everyone in a circle, knocks them back, and breaks destructibles in range. */
export function explode(w: World, x: number, y: number, r: number, damage: number, by: number, source: SourceId, opts: ExplodeOpts = {}) {
  for (const p of w.playersNear(x, y, r, opts.hitOwner ? 0 : by)) {
    if (opts.walls && visionBlocked(w.map, x, y, p.x, p.y)) continue;
    const d = Math.sqrt(dist2(x, y, p.x, p.y));
    const k = opts.falloff ? 1 - 0.5 * Math.min(1, d / (r + p.r)) : 1;
    w.damage(p, damage * k, by, source, { x: p.x, y: p.y });
    if (opts.knock) {
      const nx = d > 1 ? (p.x - x) / d : 0;
      const ny = d > 1 ? (p.y - y) / d : 0;
      w.impulse(p, nx * opts.knock * k, ny * opts.knock * k);
    }
  }
  if (!opts.noSolids) for (const s of solidsInCircle(w.map, x, y, r)) damageSolid(w, s, damage * TERRAIN.explosionSolidMult, by, true, x, y);
  w.emit({ t: "explode", x, y, r, source, by });
}
