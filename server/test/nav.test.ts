// Bot navigation: grid classification, A* around walls and through doorways, smoothing,
// water costs, destructibles reopening cells, chokepoints, and the per-tick search budget.
import { describe, expect, test } from "vitest";
import { addSolid, BOTS, buildMap, circleBlocked, inWater, PLAY_MAPS, type MapDef } from "@prism/shared";
import { AStar, gridLineClear, Nav, NavGrid, type Pt } from "../src/bots/nav";

const yard = () => buildMap("testYard", 1);

/** A horizontal-ish wall across the yard at x in [-12, 12] with a door gap centered at doorY. */
function wallWithDoor(m: MapDef, doorY: number, door = 110) {
  const h = m.half;
  addSolid(m, "wall", -12, -h, 12, doorY - door / 2);
  return addSolid(m, "wall", -12, doorY + door / 2, 12, h);
}

/** Every point along the waypoint polyline stays out of solids (player radius). */
function polylineClear(m: MapDef, from: Pt, pts: Pt[], r = 20): boolean {
  let a = from;
  for (const b of pts) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10);
    for (let k = 0; k <= steps; k++) {
      const t = steps ? k / steps : 1;
      if (circleBlocked(m, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) return false;
    }
    a = b;
  }
  return true;
}

describe("nav grid", () => {
  test("cells touching solids are blocked, open floor is walkable, walls cost more nearby", () => {
    const m = yard();
    addSolid(m, "wall", -200, -12, 200, 12);
    const g = new NavGrid(m);
    expect(g.walkableAt(0, 0)).toBe(false);
    expect(g.walkableAt(0, 300)).toBe(true);
    // Hugging the map edge is either blocked or a costly squeeze.
    const edge = g.cellAt(m.half - 5, 0);
    expect(!g.walkable(edge) || (g.cost[edge] ?? 0) >= BOTS.nav.tightCost).toBe(true);
    let nearWall = 0;
    g.forCellsNear(0, -60, 50, (i) => {
      nearWall = Math.max(nearWall, g.cost[i] ?? 0);
    });
    const far = g.cellAt(0, -400);
    expect(nearWall).toBeGreaterThan(g.cost[far] ?? 0);
  });

  test("a doorway is a chokepoint and is still walkable", () => {
    const m = yard();
    wallWithDoor(m, 200);
    const g = new NavGrid(m);
    const door = g.nearestWalkable(0, 200, 1);
    expect(door).toBeGreaterThanOrEqual(0);
    let chokes = 0;
    g.forCellsNear(0, 200, 60, (i) => {
      if (g.choke[i]) chokes++;
    });
    expect(chokes).toBeGreaterThan(0);
    expect(g.choke[g.cellAt(-600, -600)]).toBe(0);
  });

  test("grid line checks see walls", () => {
    const m = yard();
    addSolid(m, "wall", -12, -300, 12, 300);
    const g = new NavGrid(m);
    expect(gridLineClear(g, -400, 0, 400, 0)).toBe(false);
    expect(gridLineClear(g, -400, 500, 400, 500)).toBe(true);
    expect(gridLineClear(g, -400, -500, -400, 500)).toBe(true);
  });
});

describe("A* and smoothing", () => {
  test("open floor gives a straight run of waypoints", () => {
    const m = yard();
    const nav = new Nav(m);
    const p = nav.path(-500, -400, 500, 400, true)!;
    expect(p.complete).toBe(true);
    expect(p.pts.length).toBeLessThanOrEqual(2);
    expect(p.pts[p.pts.length - 1]).toEqual({ x: 500, y: 400 });
  });

  test("goes through the doorway around a wall, with few waypoints and no wall clipping", () => {
    const m = yard();
    wallWithDoor(m, 500);
    const nav = new Nav(m);
    const p = nav.path(-500, -300, 500, -300, true)!;
    expect(p.complete).toBe(true);
    expect(p.pts.length).toBeLessThanOrEqual(5);
    const throughDoor = p.pts.some((q) => Math.abs(q.y - 500) < 80);
    expect(throughDoor).toBe(true);
    expect(polylineClear(m, { x: -500, y: -300 }, p.pts)).toBe(true);
    expect(p.pts[p.pts.length - 1]).toEqual({ x: 500, y: -300 });
  });

  test("a sealed wall gives a partial path that ends on our side near the goal", () => {
    const m = yard();
    addSolid(m, "wall", -12, -m.half, 12, m.half);
    const nav = new Nav(m);
    const p = nav.path(-500, 0, 500, 0, true)!;
    expect(p.complete).toBe(false);
    const end = p.pts[p.pts.length - 1]!;
    expect(end.x).toBeLessThan(0);
    expect(end.x).toBeGreaterThan(-120);
  });

  test("the node budget cuts long searches short but still heads toward the goal", () => {
    const m = yard();
    wallWithDoor(m, 1000);
    const g = new NavGrid(m);
    const a = new AStar(g);
    const res = a.find(g.cellAt(-600, -600), g.cellAt(600, -600), 40)!;
    expect(res.complete).toBe(false);
    expect(res.expanded).toBeLessThanOrEqual(41);
    const end = res.cells[res.cells.length - 1]!;
    expect(g.centerX(end)).toBeGreaterThan(-600);
  });

  test("wading costs extra: paths cross a river on the bridge when it's close", () => {
    const m = yard();
    m.water.push({ x0: -200, y0: -m.half, x1: 200, y1: m.half });
    m.bridges.push({ x0: -200, y0: -200, x1: 200, y1: -100 });
    const nav = new Nav(m);
    const p = nav.path(-600, 0, 600, 0, true)!;
    expect(p.complete).toBe(true);
    // Wading distance along the path: only grazing the bridge edge, versus 400 straight across.
    let a: Pt = { x: -600, y: 0 };
    let wet = 0;
    for (const b of p.pts) {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5);
      for (let k = 0; k < steps; k++) if (inWater(m, a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps)) wet += 5;
      a = b;
    }
    expect(wet).toBeLessThan(120);
  });

  test("a crate in the only gap blocks the path until it breaks, then the grid reopens", () => {
    const m = yard();
    wallWithDoor(m, 0, 130);
    const crate = addSolid(m, "crate", -30, -40, 30, 40);
    const nav = new Nav(m);
    const before = nav.path(-400, 0, 400, 0, true)!;
    expect(before.complete).toBe(false);
    const v = nav.grid.version;
    crate.dead = true;
    expect(nav.grid.refresh()).toBe(true);
    expect(nav.grid.version).toBe(v + 1);
    const after = nav.path(-400, 0, 400, 0, true)!;
    expect(after.complete).toBe(true);
  });

  test("searches per tick are budgeted per world and reset on the next tick", () => {
    const m = yard();
    const w = { map: m, tick: 1 };
    const nav = Nav.of(w);
    for (let i = 0; i < BOTS.nav.searchesPerTick; i++) expect(nav.path(-500, 0, 500, 100)).not.toBeNull();
    expect(nav.path(-500, 0, 500, 100)).toBeNull();
    w.tick = 2;
    expect(Nav.of(w)).toBe(nav);
    expect(nav.path(-500, 0, 500, 100)).not.toBeNull();
  });

  for (const id of PLAY_MAPS) {
    test(`long paths across ${id} are found quickly`, () => {
      const m = buildMap(id, 5);
      const nav = new Nav(m);
      const s = m.spawns;
      let complete = 0;
      let total = 0;
      const t0 = performance.now();
      for (let i = 0; i < s.length; i++) {
        const a = s[i]!;
        const b = s[(i + 5) % s.length]!;
        const p = nav.path(a.x, a.y, b.x, b.y, true);
        if (!p) continue;
        total++;
        if (p.complete) complete++;
        expect(polylineClear(m, a, p.pts, 14)).toBe(true);
      }
      const ms = (performance.now() - t0) / Math.max(1, total);
      expect(total).toBe(s.length);
      expect(complete).toBeGreaterThanOrEqual(total - 1);
      expect(ms).toBeLessThan(15);
    });
  }
});
