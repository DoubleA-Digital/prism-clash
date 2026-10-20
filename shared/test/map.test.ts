// The v2 map engine: seeded generation, spatial grid, circle-vs-rect movement with sliding,
// swept bullets (no tunneling), line of sight, water, bushes and spawn points.
import { describe, expect, test } from "vitest";
import {
  addBush, addSolid, buildMap, BTN, canSeePoint, circleBlocked, inWater, MATCH, movePlayer, PLAY_MAPS, resolveCircle, segRect, sweepSolids, visionBlocked,
  WEAPONS, World, type InputFrame, type Player,
} from "@prism/shared";

const DT = 1 / 30;
let seq = 0;
const frame = (p: Player, mx = 0, my = 0, buttons = 0, pressed = 0): InputFrame => ({ seq: ++seq, mx, my, aim: p.aim, buttons, pressed, dt: DT, shotId: 0 });

describe("map generation", () => {
  for (const id of PLAY_MAPS) {
    test(`${id}: deterministic per seed, varied across seeds, rich terrain`, () => {
      const a = buildMap(id, 1234);
      const b = buildMap(id, 1234);
      const c = buildMap(id, 99);
      expect(a.solids.map((s) => [s.kind, s.x0, s.y0, s.x1, s.y1])).toEqual(b.solids.map((s) => [s.kind, s.x0, s.y0, s.x1, s.y1]));
      expect(JSON.stringify(a.solids.slice(4, 40))).not.toEqual(JSON.stringify(c.solids.slice(4, 40)));
      const kinds = new Set(a.solids.map((s) => s.kind));
      for (const k of ["wall", "crate", "barrel"] as const) expect(kinds.has(k)).toBe(true);
      expect(a.solids.length).toBeGreaterThan(150);
      expect(a.bushes.length).toBeGreaterThan(20);
      expect(a.lootSpots.length).toBeGreaterThan(80);
      if (id === "neonCity") {
        expect(a.roofs.length).toBeGreaterThan(10);
        expect(kinds.has("glass") && kinds.has("car") && kinds.has("fence")).toBe(true);
      } else {
        expect(a.water.length).toBeGreaterThan(5);
        expect(a.bridges.length).toBe(3);
        expect(kinds.has("rock") && kinds.has("crystal")).toBe(true);
      }
    });

    test(`${id}: spawns are spread out and never inside geometry or water`, () => {
      for (const seed of [1, 2, 3]) {
        const m = buildMap(id, seed);
        expect(m.spawns.length).toBe(MATCH.fighters);
        for (const s of m.spawns) {
          expect(circleBlocked(m, s.x, s.y, 30)).toBe(false);
          expect(inWater(m, s.x, s.y)).toBe(false);
        }
        let closest = Infinity;
        for (const s of m.spawns) for (const o of m.spawns) if (s !== o) closest = Math.min(closest, Math.hypot(s.x - o.x, s.y - o.y));
        expect(closest).toBeGreaterThan(500);
      }
    });
  }
});

describe("collision", () => {
  test("a circle is pushed out of a rect and slides along it", () => {
    const m = buildMap("testYard", 1);
    addSolid(m, "wall", -100, -20, 100, 20);
    const o = { x: 0, y: -30, vx: 50, vy: 200 };
    const c = resolveCircle(m, o, 22);
    expect(c).not.toBeNull();
    expect(o.y).toBeCloseTo(-42, 5);
    expect(o.vy).toBe(0);
    expect(o.vx).toBe(50);
  });

  test("players walk around walls and dash never passes through a thin wall", () => {
    const w = new World("testYard", 1, { loot: false });
    addSolid(w.map, "wall", 100, -300, 124, 300);
    const p = w.addPlayer(1, "A", 0, false);
    p.x = 0;
    p.y = 0;
    for (let i = 0; i < 30; i++) movePlayer(p, frame(p, 1, 0, 0, i === 3 ? BTN.dash : 0), w.map, DT);
    expect(p.x).toBeLessThanOrEqual(100 - p.r + 0.01);
    // Sliding: pushing diagonally into the wall still moves along it.
    const y0 = p.y;
    for (let i = 0; i < 20; i++) movePlayer(p, frame(p, 0.7, 0.7), w.map, DT);
    expect(p.y).toBeGreaterThan(y0 + 100);
  });

  test("segRect reports the entry time and face normal", () => {
    const h = segRect(0, 0, 100, 0, 40, -10, 60, 10)!;
    expect(h.t).toBeCloseTo(0.4);
    expect([h.nx, h.ny]).toEqual([-1, 0]);
    expect(segRect(0, 50, 100, 0, 40, -10, 60, 10)).toBeNull();
  });

  test("fast bullets don't tunnel through thin walls", () => {
    const w = new World("testYard", 1, { loot: false });
    addSolid(w.map, "glass", 200, -60, 214, 60);
    w.addPlayer(1, "A", 0, false);
    const pr = w.spawnProjectile({ owner: 1, x: 0, y: 0, vx: WEAPONS.sniper.speed, vy: 0, r: 7, life: 1, damage: 5 });
    for (let i = 0; i < 5; i++) w.stepProjectile(pr, DT);
    expect(pr.dead).toBe(true);
    expect(sweepSolids(w.map, 0, 0, 400, 0, 0)?.solid.kind).toBe("glass");
  });
});

describe("line of sight", () => {
  test("walls block vision, low cover and glass don't, broken walls stop blocking", () => {
    const m = buildMap("testYard", 1);
    const wall = addSolid(m, "wall", -20, -100, 20, 100);
    addSolid(m, "cover", 200, -100, 220, 100);
    addSolid(m, "glass", 400, -100, 410, 100);
    expect(visionBlocked(m, -300, 0, 300, 0)).toBe(true);
    expect(visionBlocked(m, 100, 0, 600, 0)).toBe(false);
    expect(visionBlocked(m, -300, 150, 300, 150)).toBe(false);
    wall.dead = true;
    expect(visionBlocked(m, -300, 0, 300, 0)).toBe(false);
  });

  test("the generous check sees a target peeking past a corner", () => {
    const m = buildMap("testYard", 1);
    addSolid(m, "wall", -20, -400, 20, 0);
    // Target just past the wall's end: center hidden, edge visible.
    expect(visionBlocked(m, -300, -60, 300, 30)).toBe(true);
    expect(canSeePoint(m, -300, -60, 300, 30, 40)).toBe(true);
    expect(canSeePoint(m, -300, -300, 300, -300, 40)).toBe(false);
  });

  test("smoke clouds block sight in the world", () => {
    const w = new World("testYard", 1, { loot: false });
    expect(w.canSee(-400, 0, 400, 0)).toBe(true);
    const e = w.spawnEffect({ kind: "smoke", owner: 0, source: "smoke", x: 0, y: 0, r: 200, life: 5 });
    e.age = 1;
    expect(w.canSee(-400, 0, 400, 0)).toBe(false);
    expect(w.canSee(-400, 300, 400, 300)).toBe(true);
  });
});

describe("terrain effects", () => {
  test("water slows movement", () => {
    const w = new World("testYard", 1, { loot: false });
    w.map.water.push({ x0: -600, y0: 200, x1: 600, y1: 600 });
    const a = w.addPlayer(1, "A", 0, false);
    const b = w.addPlayer(2, "B", 1, false);
    a.x = -400;
    a.y = 0;
    b.x = -400;
    b.y = 400;
    for (let i = 0; i < 30; i++) {
      movePlayer(a, frame(a, 1, 0), w.map, DT);
      movePlayer(b, frame(b, 1, 0), w.map, DT);
    }
    expect(b.x + 400).toBeLessThan((a.x + 400) * 0.75);
  });

  test("bushes hide players until close or until they shoot", () => {
    const w = new World("testYard", 1, { loot: false });
    addBush(w.map, 500, 0, 120);
    const viewer = w.addPlayer(1, "V", 0, false);
    const hider = w.addPlayer(2, "H", 1, false);
    viewer.x = -400;
    hider.x = 500;
    expect(w.hiddenFrom(viewer, hider)).toBe(true);
    expect(w.visibleTo(viewer, hider)).toBe(false);
    viewer.x = 330;
    expect(w.hiddenFrom(viewer, hider)).toBe(false);
    viewer.x = -400;
    w.firedAt.set(hider.id, w.tick);
    expect(w.hiddenFrom(viewer, hider)).toBe(false);
  });

  test("interest: players behind walls or out of range aren't visible", () => {
    const w = new World("testYard", 1, { loot: false });
    addSolid(w.map, "wall", -20, -400, 20, 400);
    const a = w.addPlayer(1, "A", 0, false);
    const b = w.addPlayer(2, "B", 1, false);
    a.x = -300;
    b.x = 300;
    expect(w.visibleTo(a, b)).toBe(false);
    b.y = -600;
    a.y = -600;
    expect(w.visibleTo(a, b)).toBe(true);
  });
});
