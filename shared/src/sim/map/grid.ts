// Uniform spatial hash for static shapes (solids, bushes) on the big map. Each cell lists
// the indices of the shapes overlapping it; queries dedupe with a stamp so a shape that
// spans several cells is visited once.

import type { Rect } from "./types";

export class StaticGrid {
  readonly cell: number;
  readonly x0: number;
  readonly y0: number;
  readonly cols: number;
  readonly rows: number;
  private cells: number[][];
  private stamp: Uint32Array;
  private mark = 0;

  constructor(half: number, cell: number, count: number) {
    this.cell = cell;
    this.x0 = -half - cell;
    this.y0 = -half - cell;
    this.cols = Math.ceil((half * 2) / cell) + 2;
    this.rows = this.cols;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.stamp = new Uint32Array(Math.max(1, count));
  }

  private cx(x: number) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.x0) / this.cell)));
  }

  private cy(y: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.y0) / this.cell)));
  }

  insert(idx: number, r: Rect) {
    if (idx >= this.stamp.length) {
      const s = new Uint32Array(Math.max(idx + 1, this.stamp.length * 2));
      s.set(this.stamp);
      this.stamp = s;
    }
    for (let y = this.cy(r.y0); y <= this.cy(r.y1); y++) {
      for (let x = this.cx(r.x0); x <= this.cx(r.x1); x++) this.cells[y * this.cols + x]?.push(idx);
    }
  }

  /** Calls `f` once per shape whose cells overlap the query rect. Return true from `f` to stop. */
  query(x0: number, y0: number, x1: number, y1: number, f: (idx: number) => boolean | void): void {
    this.mark = (this.mark + 1) >>> 0;
    if (this.mark === 0) {
      this.stamp.fill(0);
      this.mark = 1;
    }
    const m = this.mark;
    const ya = this.cy(Math.min(y0, y1));
    const yb = this.cy(Math.max(y0, y1));
    const xa = this.cx(Math.min(x0, x1));
    const xb = this.cx(Math.max(x0, x1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const list = this.cells[y * this.cols + x];
        if (!list) continue;
        for (const idx of list) {
          if (this.stamp[idx] === m) continue;
          this.stamp[idx] = m;
          if (f(idx) === true) return;
        }
      }
    }
  }
}
