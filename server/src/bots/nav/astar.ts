// A* over the nav grid: 8-way moves (no cutting corners past blocked cells), octile
// heuristic, a binary heap with lazy deletion, and generation stamps so no arrays are cleared
// between searches. A node budget keeps every search cheap: when it runs out (or the goal is
// walled off) the path leads to the explored cell closest to the goal instead.

import type { NavGrid } from "./grid";
import { BASE_COST } from "./grid";

export interface CellPath {
  /** Cell indices from start to end (inclusive). */
  cells: number[];
  /** True when the path reaches the goal cell. */
  complete: boolean;
  expanded: number;
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10],
  [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14],
];

export class AStar {
  private g: Float32Array;
  private parent: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heapNode = new Int32Array(1024);
  private heapF = new Float32Array(1024);
  private size = 0;

  constructor(private grid: NavGrid) {
    const n = grid.cols * grid.rows;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  private push(node: number, f: number) {
    if (this.size >= this.heapNode.length) {
      const nn = new Int32Array(this.heapNode.length * 2);
      nn.set(this.heapNode);
      const nf = new Float32Array(this.heapF.length * 2);
      nf.set(this.heapF);
      this.heapNode = nn;
      this.heapF = nf;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pf = this.heapF[p] ?? 0;
      if (pf <= f) break;
      this.heapNode[i] = this.heapNode[p] ?? 0;
      this.heapF[i] = pf;
      i = p;
    }
    this.heapNode[i] = node;
    this.heapF[i] = f;
  }

  private pop(): number {
    const top = this.heapNode[0] ?? -1;
    const n = --this.size;
    if (n <= 0) return top;
    const node = this.heapNode[n] ?? 0;
    const f = this.heapF[n] ?? 0;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && (this.heapF[r] ?? 0) < (this.heapF[l] ?? 0) ? r : l;
      const cf = this.heapF[c] ?? 0;
      if (cf >= f) break;
      this.heapNode[i] = this.heapNode[c] ?? 0;
      this.heapF[i] = cf;
      i = c;
    }
    this.heapNode[i] = node;
    this.heapF[i] = f;
    return top;
  }

  /** Octile distance in cost units (each cell costs at least BASE_COST). */
  private h(a: number, goalC: number, goalR: number): number {
    const cols = this.grid.cols;
    const dx = Math.abs((a % cols) - goalC);
    const dy = Math.abs(Math.floor(a / cols) - goalR);
    return (dx > dy ? 10 * (dx - dy) + 14 * dy : 10 * (dy - dx) + 14 * dx) * (BASE_COST / 10);
  }

  /** Path between two open cells. Returns null when the start cell is blocked. */
  find(start: number, goal: number, maxExpand: number, weight = 1): CellPath | null {
    const grid = this.grid;
    const cost = grid.cost;
    if (!cost[start]) return null;
    if (start === goal) return { cells: [start], complete: true, expanded: 0 };
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const cols = grid.cols;
    const rows = grid.rows;
    const goalC = goal % cols;
    const goalR = Math.floor(goal / cols);
    this.size = 0;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.seen[start] = gen;
    this.push(start, this.h(start, goalC, goalR) * weight);
    let best = start;
    let bestH = this.h(start, goalC, goalR);
    let expanded = 0;
    let found = false;
    while (this.size > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        found = true;
        best = cur;
        break;
      }
      const hc = this.h(cur, goalC, goalR);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      if (++expanded > maxExpand) break;
      const c = cur % cols;
      const r = Math.floor(cur / cols);
      const gc = this.g[cur] ?? 0;
      for (const [dc, dr, step] of DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        const k = cost[ni] ?? 0;
        if (!k || this.closed[ni] === gen) continue;
        // Diagonals only when both side cells are open (no squeezing past corners).
        if (dc !== 0 && dr !== 0 && (!cost[r * cols + nc] || !cost[nr * cols + c])) continue;
        const ng = gc + (step * k) / 10;
        if (this.seen[ni] === gen && ng >= (this.g[ni] ?? 0)) continue;
        this.seen[ni] = gen;
        this.g[ni] = ng;
        this.parent[ni] = cur;
        this.push(ni, ng + this.h(ni, goalC, goalR) * weight);
      }
    }
    const cells: number[] = [];
    for (let n = best; n >= 0; n = this.parent[n] ?? -1) {
      cells.push(n);
      if (n === start) break;
    }
    cells.reverse();
    return { cells, complete: found, expanded };
  }
}
