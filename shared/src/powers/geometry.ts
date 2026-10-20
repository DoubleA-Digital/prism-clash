// Terrain helpers for powers: moving a free body along a line without tunneling through thin
// walls, finding a clear landing spot for anything that teleports, line-of-sight tests for
// targeting, and the buff-extension rule echoes and repeat casts share.

import { ULTIMATES } from "../config";
import { circleBlocked, resolveCircle, type Body } from "../sim/collision";
import { visionBlocked } from "../sim/los";
import type { Player, StatusId } from "../sim/types";
import type { World } from "../sim/world";

/**
 * Moves a body by (dx, dy) in steps no longer than half its radius, resolving against the map
 * after each one, so it slides along walls and can never skip through a thin wall. Returns
 * true if it touched terrain on the way.
 */
export function moveBody(w: World, body: Body, dx: number, dy: number, r: number, bounce = 0): boolean {
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(4, r * 0.5)));
  let touched = false;
  for (let i = 0; i < steps; i++) {
    body.x += dx / steps;
    body.y += dy / steps;
    if (w.collideBody(body, r, bounce)) touched = true;
  }
  return touched;
}

/** Where a body of radius r ends up walking from A toward B (stopped or slid by walls, never through them). */
export function walkTo(w: World, ax: number, ay: number, bx: number, by: number, r: number): { x: number; y: number } {
  const body = { x: ax, y: ay, vx: 0, vy: 0 };
  moveBody(w, body, bx - ax, by - ay, r);
  return { x: body.x, y: body.y };
}

/**
 * A clear spot for a circle of radius r at or near (x, y). It's pushed out of any solid it
 * overlaps; if that still leaves it inside geometry (a pocket between solids), it backs off
 * toward the fallback point (fx, fy), which must itself be clear (where the body came from).
 */
export function clearSpot(w: World, x: number, y: number, r: number, fx: number, fy: number): { x: number; y: number } {
  const h = w.map.half - r - 1;
  const body = { x: Math.max(-h, Math.min(h, x)), y: Math.max(-h, Math.min(h, y)), vx: 0, vy: 0 };
  resolveCircle(w.map, body, r);
  if (!circleBlocked(w.map, body.x, body.y, r - 0.5)) return { x: body.x, y: body.y };
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    const px = x + (fx - x) * t;
    const py = y + (fy - y) * t;
    if (!circleBlocked(w.map, px, py, r - 0.5)) return { x: px, y: py };
  }
  return { x: fx, y: fy };
}

/** A vision-blocking wall (wall, rock, crystal) stands between A and B. Low cover, crates and glass don't count. */
export function wallBetween(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  return visionBlocked(w.map, ax, ay, bx, by);
}

/** A player at A can see B: no wall and no smoke in the way (targeting powers use this). */
export function inSight(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  return w.canSee(ax, ay, bx, by);
}

/**
 * Grants a timed buff. Cast again while it's still running (an Echo Storm echo, or a cooldown
 * reset), it adds ULTIMATES.echoStorm.buffExtend × duration instead of a wasted refresh.
 * Returns the buff's new remaining time.
 */
export function grantBuff(w: World, p: Player, s: StatusId, duration: number): number {
  const cur = p.status[s] ?? 0;
  const next = cur > 0 ? cur + duration * ULTIMATES.echoStorm.buffExtend : duration;
  w.addStatus(p, s, next);
  return next;
}
