// Line of sight. Walls, rocks and crystals block vision; low cover, crates, cars and glass
// don't (you can see over and through them, but bullets still stop). The World adds smoke
// clouds on top of this. Used by server snapshot culling, bots, and the client's shadows.

import { sweepSolids } from "./collision";
import type { MapDef, Solid } from "./map/types";

const notVision = (s: Solid) => !s.vision;

/** True when a vision-blocking solid sits between A and B. */
export function visionBlocked(map: MapDef, ax: number, ay: number, bx: number, by: number): boolean {
  const h = sweepSolids(map, ax, ay, bx, by, 0, notVision);
  return !!h && h.t < 1;
}

/** True when any solid (cover included) would stop a bullet between A and B. */
export function bulletBlocked(map: MapDef, ax: number, ay: number, bx: number, by: number, r = 0): boolean {
  const h = sweepSolids(map, ax, ay, bx, by, r);
  return !!h && h.t < 1;
}

/**
 * Generous visibility of a target: the center, or either edge of the target pushed out
 * sideways by `margin`, is in sight. Things near a corner appear slightly before they're
 * fully exposed instead of popping in.
 */
export function canSeePoint(map: MapDef, vx: number, vy: number, tx: number, ty: number, margin: number): boolean {
  if (!visionBlocked(map, vx, vy, tx, ty)) return true;
  if (margin <= 0) return false;
  const dx = tx - vx;
  const dy = ty - vy;
  const d = Math.hypot(dx, dy) || 1;
  const px = (-dy / d) * margin;
  const py = (dx / d) * margin;
  return !visionBlocked(map, vx, vy, tx + px, ty + py) || !visionBlocked(map, vx, vy, tx - px, ty - py);
}

/** Does segment A→B pass within r of point C? */
export function segmentNearPoint(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / l2)) : 0;
  const px = ax + dx * t - cx;
  const py = ay + dy * t - cy;
  return px * px + py * py < r * r;
}
