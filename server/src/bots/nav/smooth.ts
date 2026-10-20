// Path smoothing (string pulling): from each anchor, skip ahead to the farthest grid point
// that a straight walk can reach through open cells. A straight cut may never cross terrain
// costlier than the cells the A* path itself used there, so smoothing doesn't drag paths
// through water or along walls the search was avoiding.

import { BOTS, sweepSolids } from "@prism/shared";
import type { NavGrid } from "./grid";

export interface Pt {
  x: number;
  y: number;
}

/**
 * Walks every cell the segment A→B touches (grid traversal; at exact corners both side cells
 * count). False if any is blocked or costs more than `maxCost`.
 */
export function gridLineClear(grid: NavGrid, ax: number, ay: number, bx: number, by: number, maxCost = 255): boolean {
  const cell = grid.cell;
  const fx = (ax - grid.x0) / cell;
  const fy = (ay - grid.y0) / cell;
  const tx = (bx - grid.x0) / cell;
  const ty = (by - grid.y0) / cell;
  let c = Math.floor(fx);
  let r = Math.floor(fy);
  const ec = Math.floor(tx);
  const er = Math.floor(ty);
  const ok = (cc: number, rr: number) => {
    if (cc < 0 || rr < 0 || cc >= grid.cols || rr >= grid.rows) return false;
    const k = grid.cost[rr * grid.cols + cc] ?? 0;
    return k > 0 && k <= maxCost;
  };
  if (!ok(c, r)) return false;
  const dx = tx - fx;
  const dy = ty - fy;
  const sc = dx > 0 ? 1 : -1;
  const sr = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = dx !== 0 ? (dx > 0 ? c + 1 - fx : fx - c) * tdx : Infinity;
  let tmy = dy !== 0 ? (dy > 0 ? r + 1 - fy : fy - r) * tdy : Infinity;
  let guard = grid.cols + grid.rows + 4;
  while ((c !== ec || r !== er) && guard-- > 0) {
    // Float safety: the segment ends inside the current cell.
    if (Math.min(tmx, tmy) > 1 + 1e-9) break;
    if (Math.abs(tmx - tmy) < 1e-9) {
      if (!ok(c + sc, r) || !ok(c, r + sr)) return false;
      c += sc;
      r += sr;
      tmx += tdx;
      tmy += tdy;
    } else if (tmx < tmy) {
      c += sc;
      tmx += tdx;
    } else {
      r += sr;
      tmy += tdy;
    }
    if (!ok(c, r)) return false;
  }
  return true;
}

/** Exact check on top of the grid walk: a body of `clearRadius` sliding A→B touches no live solid. */
function segmentHitsSolid(grid: NavGrid, a: Pt, b: Pt): boolean {
  const h = sweepSolids(grid.map, a.x, a.y, b.x, b.y, BOTS.nav.clearRadius);
  return !!h && h.t < 1;
}

/** Turns an A* cell path into a short list of waypoints from (sx, sy) to (gx, gy). */
export function smoothPath(grid: NavGrid, cells: readonly number[], sx: number, sy: number, gx: number, gy: number): Pt[] {
  const n = cells.length;
  if (n <= 1) return [{ x: gx, y: gy }];
  // Points: the real start, the inner cell centers, and the real goal (if it's inside the last cell's reach).
  const pts: Pt[] = [{ x: sx, y: sy }];
  const costs: number[] = [grid.cost[cells[0] ?? 0] ?? 255];
  for (let i = 1; i < n; i++) {
    const ci = cells[i] ?? 0;
    pts.push({ x: grid.centerX(ci), y: grid.centerY(ci) });
    costs.push(grid.cost[ci] ?? 255);
  }
  const last = cells[n - 1] ?? 0;
  if (grid.cellAt(gx, gy) === last && n > 1) pts[pts.length - 1] = { x: gx, y: gy };
  const out: Pt[] = [];
  const look = BOTS.nav.smoothLookahead;
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1;
    let maxC = Math.max(costs[i] ?? 255, costs[i + 1] ?? 255);
    const a = pts[i]!;
    for (let j = i + 2; j < pts.length && j <= i + look; j++) {
      maxC = Math.max(maxC, costs[j] ?? 255);
      const b = pts[j]!;
      if (!gridLineClear(grid, a.x, a.y, b.x, b.y, maxC) || segmentHitsSolid(grid, a, b)) break;
      best = j;
    }
    out.push(pts[best]!);
    i = best;
  }
  return out;
}
