// Navigation grid built from a map's static geometry. Each cell stores the cost of stepping
// into it (0 = blocked): a cell is blocked when a player-sized circle at its center would
// touch a solid (walls, low cover, glass, cars, and destructibles until they break), costs
// more right next to walls (so paths keep some clearance) and in water (it slows you).
// Destructibles are re-checked cheaply every tick; when one breaks, only the cells around it
// are reclassified and `version` goes up so bots know to re-path.

import { BOTS, circleBlocked, inBush, inWater, sweepSolids, type MapDef, type Solid } from "@prism/shared";

const N = BOTS.nav;

/** Step cost of an open, dry cell away from walls (diagonals cost 1.4×). */
export const BASE_COST = 10;

interface Pending {
  solid: Solid;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export class NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly y0: number;
  /** Cost to step into each cell (×BASE_COST); 0 = blocked. */
  readonly cost: Uint8Array;
  /** 1 where the cell center is inside a bush (ambush spots). */
  readonly bush: Uint8Array;
  /** 1 where the cell is a narrow passage between blocked cells (doorways, gaps). */
  readonly choke: Uint8Array;
  /** Goes up whenever cells reopen (a crate, glass pane or fence broke). */
  version = 0;
  private pending: Pending[] = [];

  constructor(readonly map: MapDef, cell: number = N.cell) {
    this.cell = cell;
    this.cols = Math.ceil((map.half * 2) / cell);
    this.rows = this.cols;
    this.x0 = -map.half;
    this.y0 = -map.half;
    const n = this.cols * this.rows;
    this.cost = new Uint8Array(n);
    this.bush = new Uint8Array(n);
    this.choke = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.classify(i);
      if (this.cost[i] && inBush(map, this.centerX(i), this.centerY(i))) this.bush[i] = 1;
    }
    const pad = N.clearance + N.nearPad + cell;
    for (const s of map.solids) {
      if (s.maxHp <= 0 || s.dead) continue;
      this.pending.push({ solid: s, c0: this.cx(s.x0 - pad), r0: this.cy(s.y0 - pad), c1: this.cx(s.x1 + pad), r1: this.cy(s.y1 + pad) });
    }
    for (let i = 0; i < n; i++) this.choke[i] = this.isChoke(i) ? 1 : 0;
  }

  cx(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.x0) / this.cell)));
  }

  cy(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.y0) / this.cell)));
  }

  cellAt(x: number, y: number): number {
    return this.cy(y) * this.cols + this.cx(x);
  }

  centerX(i: number): number {
    return this.x0 + ((i % this.cols) + 0.5) * this.cell;
  }

  centerY(i: number): number {
    return this.y0 + (Math.floor(i / this.cols) + 0.5) * this.cell;
  }

  walkable(i: number): boolean {
    return (this.cost[i] ?? 0) > 0;
  }

  walkableAt(x: number, y: number): boolean {
    return this.walkable(this.cellAt(x, y));
  }

  private classify(i: number) {
    const x = this.centerX(i);
    const y = this.centerY(i);
    let c = BASE_COST;
    if (circleBlocked(this.map, x, y, N.clearance)) {
      // Too tight for comfort; still usable (at a steep cost) when it's the only way out of
      // a pocket the bot squeezed into, as long as a slimmer body would fit.
      if (circleBlocked(this.map, x, y, N.tightClearance)) {
        this.cost[i] = 0;
        return;
      }
      c += N.tightCost;
    }
    if (circleBlocked(this.map, x, y, N.clearance + N.nearPad)) c += N.nearCost;
    if (inWater(this.map, x, y)) c += N.waterCost;
    this.cost[i] = c;
  }

  /** Is cell (c, r) open? Out-of-range counts as blocked. */
  private open(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && (this.cost[r * this.cols + c] ?? 0) > 0;
  }

  /** Open run through (c, r) along one axis, up to 3 cells each way; closed = walls at both ends. */
  private run(c: number, r: number, dc: number, dr: number): { len: number; closed: boolean } {
    let len = 1;
    let ends = 0;
    for (const s of [1, -1]) {
      let k = 1;
      for (; k <= 3; k++) {
        if (!this.open(c + dc * k * s, r + dr * k * s)) {
          ends++;
          break;
        }
        len++;
      }
    }
    return { len, closed: ends === 2 };
  }

  private isChoke(i: number): boolean {
    if (!this.cost[i]) return false;
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    const h = this.run(c, r, 1, 0);
    if (h.closed && h.len <= 3 && this.open(c, r - 1) && this.open(c, r + 1)) return true;
    const v = this.run(c, r, 0, 1);
    return v.closed && v.len <= 3 && this.open(c - 1, r) && this.open(c + 1, r);
  }

  /**
   * Checks the destructibles that still stand; reclassifies cells around any that broke.
   * Returns true if anything changed.
   */
  refresh(): boolean {
    let changed = false;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      if (!p || !p.solid.dead) continue;
      for (let r = p.r0; r <= p.r1; r++) for (let c = p.c0; c <= p.c1; c++) this.classify(r * this.cols + c);
      for (let r = Math.max(0, p.r0 - 3); r <= Math.min(this.rows - 1, p.r1 + 3); r++) {
        for (let c = Math.max(0, p.c0 - 3); c <= Math.min(this.cols - 1, p.c1 + 3); c++) {
          const i = r * this.cols + c;
          this.choke[i] = this.isChoke(i) ? 1 : 0;
        }
      }
      const last = this.pending.pop();
      if (last && k < this.pending.length) this.pending[k] = last;
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  /** The open cell nearest to (x, y), searching rings out to `maxRing` cells; -1 if none. */
  nearestWalkable(x: number, y: number, maxRing = 6): number {
    const c0 = this.cx(x);
    const r0 = this.cy(y);
    if (this.open(c0, r0)) return r0 * this.cols + c0;
    let best = -1;
    let bd = Infinity;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring || !this.open(c, r)) continue;
          const i = r * this.cols + c;
          const d = (this.centerX(i) - x) ** 2 + (this.centerY(i) - y) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * The open cell nearest to a goal point that can actually reach it in a straight line (no
   * solid between the cell center and the point), so a goal tucked against a wall resolves to
   * a cell on its own side. Falls back to the plain nearest open cell.
   */
  nearestReaching(x: number, y: number, maxRing = 6): number {
    const c0 = this.cx(x);
    const r0 = this.cy(y);
    if (this.open(c0, r0)) return r0 * this.cols + c0;
    let best = -1;
    let bd = Infinity;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring || !this.open(c, r)) continue;
          const i = r * this.cols + c;
          const px = this.centerX(i);
          const py = this.centerY(i);
          const d = (px - x) ** 2 + (py - y) ** 2;
          if (d >= bd) continue;
          const hit = sweepSolids(this.map, px, py, x, y, 0);
          if (hit && hit.t < 1) continue;
          bd = d;
          best = i;
        }
      }
      if (best >= 0) return best;
    }
    return this.nearestWalkable(x, y, maxRing);
  }

  /** Calls f for every open cell whose center lies within `radius` of (x, y). Return true to stop. */
  forCellsNear(x: number, y: number, radius: number, f: (i: number, cx: number, cy: number) => boolean | void): void {
    const ca = this.cx(x - radius);
    const cb = this.cx(x + radius);
    const ra = this.cy(y - radius);
    const rb = this.cy(y + radius);
    const r2 = radius * radius;
    for (let r = ra; r <= rb; r++) {
      for (let c = ca; c <= cb; c++) {
        const i = r * this.cols + c;
        if (!this.cost[i]) continue;
        const px = this.centerX(i);
        const py = this.centerY(i);
        if ((px - x) ** 2 + (py - y) ** 2 > r2) continue;
        if (f(i, px, py) === true) return;
      }
    }
  }
}
