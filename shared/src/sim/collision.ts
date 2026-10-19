// Collision against the map's axis-aligned solids: circle-vs-AABB push-out with sliding
// (players, clones, decoys), and swept segment-vs-AABB for projectiles so fast bullets never
// tunnel through thin walls. All queries go through the map's spatial grid.

import type { MapDef, Solid } from "./map/types";

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface WallContact {
  nx: number;
  ny: number;
  /** Speed into the solid before the collision (for wall-slam damage). */
  impact: number;
  solid: Solid;
}

const scratch: number[] = [];

function near(map: MapDef, x0: number, y0: number, x1: number, y1: number): number[] {
  scratch.length = 0;
  map.grid.query(x0, y0, x1, y1, (i) => {
    scratch.push(i);
  });
  return scratch;
}

/**
 * Pushes a circle out of every live solid it overlaps and removes the velocity going into
 * them (so it slides along walls). `bounce` > 0 reflects part of it instead.
 * Returns the hardest contact, if any.
 */
export function resolveCircle(map: MapDef, o: Body, r: number, bounce = 0): WallContact | null {
  let contact: WallContact | null = null;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const list = near(map, o.x - r, o.y - r, o.x + r, o.y + r).slice();
    for (const i of list) {
      const s = map.solids[i];
      if (!s || s.dead) continue;
      const cx = o.x < s.x0 ? s.x0 : o.x > s.x1 ? s.x1 : o.x;
      const cy = o.y < s.y0 ? s.y0 : o.y > s.y1 ? s.y1 : o.y;
      let dx = o.x - cx;
      let dy = o.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      let push: number;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        push = r - d;
      } else {
        // Center inside the rect: leave through the nearest face.
        const l = o.x - s.x0;
        const rr = s.x1 - o.x;
        const t = o.y - s.y0;
        const b = s.y1 - o.y;
        const m = Math.min(l, rr, t, b);
        dx = m === l ? -1 : m === rr ? 1 : 0;
        dy = m === t ? -1 : m === b ? 1 : 0;
        if (dx !== 0) dy = 0;
        push = m + r;
      }
      o.x += dx * push;
      o.y += dy * push;
      const vn = o.vx * dx + o.vy * dy;
      if (vn < 0) {
        o.vx -= (1 + bounce) * vn * dx;
        o.vy -= (1 + bounce) * vn * dy;
        if (!contact || -vn > contact.impact) contact = { nx: dx, ny: dy, impact: -vn, solid: s };
      } else if (!contact) contact = { nx: dx, ny: dy, impact: 0, solid: s };
      moved = true;
    }
    if (!moved) break;
  }
  return contact;
}

/** Does a circle overlap any live solid? */
export function circleBlocked(map: MapDef, x: number, y: number, r: number): boolean {
  for (const i of near(map, x - r, y - r, x + r, y + r)) {
    const s = map.solids[i];
    if (!s || s.dead) continue;
    const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x;
    const cy = y < s.y0 ? s.y0 : y > s.y1 ? s.y1 : y;
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}

export interface SegHit {
  t: number;
  nx: number;
  ny: number;
}

/** Segment A→A+D against an AABB (slab test). t in [0,1] of first contact plus the face normal. */
export function segRect(ax: number, ay: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): SegHit | null {
  if (ax > x0 && ax < x1 && ay > y0 && ay < y1) {
    // Starting inside: report an immediate hit on the face we're moving away from least.
    if (Math.abs(dx) >= Math.abs(dy)) return { t: 0, nx: dx > 0 ? -1 : 1, ny: 0 };
    return { t: 0, nx: 0, ny: dy > 0 ? -1 : 1 };
  }
  let tmin = 0;
  let tmax = 1;
  let nx = 0;
  let ny = 0;
  if (Math.abs(dx) < 1e-9) {
    if (ax < x0 || ax > x1) return null;
  } else {
    let t1 = (x0 - ax) / dx;
    let t2 = (x1 - ax) / dx;
    let n = -1;
    if (t1 > t2) {
      const k = t1;
      t1 = t2;
      t2 = k;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) {
    if (ay < y0 || ay > y1) return null;
  } else {
    let t1 = (y0 - ay) / dy;
    let t2 = (y1 - ay) / dy;
    let n = -1;
    if (t1 > t2) {
      const k = t1;
      t1 = t2;
      t2 = k;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, nx, ny };
}

export interface SweepHit extends SegHit {
  solid: Solid;
}

/**
 * First live solid a circle of radius r hits moving from A to B (rects expanded by r).
 * `skip` filters solids out (e.g. ones that don't block vision for LOS).
 */
export function sweepSolids(map: MapDef, ax: number, ay: number, bx: number, by: number, r: number, skip?: (s: Solid) => boolean): SweepHit | null {
  const dx = bx - ax;
  const dy = by - ay;
  let best: SweepHit | null = null;
  for (const i of near(map, Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r)) {
    const s = map.solids[i];
    if (!s || s.dead || skip?.(s)) continue;
    const h = segRect(ax, ay, dx, dy, s.x0 - r, s.y0 - r, s.x1 + r, s.y1 + r);
    if (h && (!best || h.t < best.t)) best = { ...h, solid: s };
  }
  return best;
}

/** Live solids overlapping a circle (explosions, melee). */
export function solidsInCircle(map: MapDef, x: number, y: number, r: number): Solid[] {
  const out: Solid[] = [];
  for (const i of near(map, x - r, y - r, x + r, y + r)) {
    const s = map.solids[i];
    if (!s || s.dead) continue;
    const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x;
    const cy = y < s.y0 ? s.y0 : y > s.y1 ? s.y1 : y;
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) out.push(s);
  }
  return out;
}
