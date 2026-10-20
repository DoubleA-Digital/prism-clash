// The nav service: one grid + A* per map (shared by every bot in that match, built on first
// use), a per-tick search budget so a crowd of bots re-pathing at once can't spike a tick,
// and a once-per-tick refresh that reopens cells when destructibles break.

import { BOTS, type MapDef } from "@prism/shared";
import { AStar } from "./astar";
import { NavGrid } from "./grid";
import { smoothPath, type Pt } from "./smooth";

export { NavGrid, BASE_COST } from "./grid";
export { AStar, type CellPath } from "./astar";
export { gridLineClear, smoothPath, type Pt } from "./smooth";

const N = BOTS.nav;

export interface NavPath {
  /** Waypoints after the start, ending at (or as close as possible to) the goal. */
  pts: Pt[];
  complete: boolean;
  goalX: number;
  goalY: number;
  /** Grid version the path was planned on. */
  version: number;
}

const cache = new WeakMap<MapDef, Nav>();

export class Nav {
  readonly grid: NavGrid;
  private astar: AStar;
  private tick = -1;
  private left: number = N.searchesPerTick;
  /** Searches run so far (profiling). */
  searches = 0;

  constructor(map: MapDef) {
    this.grid = new NavGrid(map);
    this.astar = new AStar(this.grid);
  }

  /** The nav for a world's map, synced to its current tick. */
  static of(w: { map: MapDef; tick: number }): Nav {
    let n = cache.get(w.map);
    if (!n) {
      n = new Nav(w.map);
      cache.set(w.map, n);
    }
    n.sync(w.tick);
    return n;
  }

  private sync(tick: number) {
    if (tick === this.tick) return;
    this.tick = tick;
    this.left = N.searchesPerTick;
    this.grid.refresh();
  }

  /** Searches still allowed this tick. */
  get budget(): number {
    return this.left;
  }

  /**
   * Plans a smoothed path. Returns null when this tick's search budget is spent (ask again
   * next tick) or when there's no open cell near the start.
   */
  path(sx: number, sy: number, gx: number, gy: number, force = false): NavPath | null {
    if (this.left <= 0 && !force) return null;
    const g = this.grid;
    const start = g.nearestReaching(sx, sy, 4);
    if (start < 0) return null;
    const goal = g.nearestReaching(gx, gy, 8);
    this.left--;
    this.searches++;
    const res = this.astar.find(start, goal < 0 ? start : goal, N.maxExpand, N.heuristicWeight);
    if (!res) return null;
    const endInGoal = res.complete && goal >= 0 && g.cellAt(gx, gy) === goal;
    const ex = endInGoal ? gx : g.centerX(res.cells[res.cells.length - 1] ?? start);
    const ey = endInGoal ? gy : g.centerY(res.cells[res.cells.length - 1] ?? start);
    const pts = smoothPath(g, res.cells, sx, sy, ex, ey);
    return { pts, complete: res.complete && goal >= 0, goalX: gx, goalY: gy, version: g.version };
  }
}
