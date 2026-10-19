// Core rules: delta compression, codec round trips, placement scoring, draft rules, RNG.
import { describe, expect, test } from "vitest";
import {
  applyDelta, applyPick, comebackPlayers, decodeSelf, draftOffer, encodeDelta, encodeSelf, inputFromWire, inputToWire, placements, Rng,
  World, POINTS, POWER_IDS, type EntityMap,
} from "../src";

describe("delta compression", () => {
  test("round-trips adds, changes and removals exactly", () => {
    const rng = new Rng(3);
    let base: EntityMap = new Map();
    for (let step = 0; step < 200; step++) {
      const cur: EntityMap = new Map();
      for (const [id, arr] of base) {
        if (rng.next() < 0.1) continue; // removed
        cur.set(id, arr.map((v, i) => (i > 0 && rng.next() < 0.3 ? v + rng.int(50) - 25 : v)));
      }
      for (let k = 0; k < 3; k++) cur.set(1 + rng.int(500), [rng.int(5), rng.int(1000), -rng.int(1000), rng.int(9)]);
      const { e, r } = encodeDelta(base, cur);
      const back = applyDelta(base, e, r);
      expect([...back.entries()].sort()).toEqual([...cur.entries()].sort());
      base = cur;
    }
  });

  test("unchanged entities cost nothing", () => {
    const m: EntityMap = new Map([[5, [0, 1, 2, 3]]]);
    expect(encodeDelta(m, new Map(m)).e).toEqual([]);
  });

  test("garbage deltas are rejected, not trusted", () => {
    expect(() => applyDelta(null, [-7, 3, 1], [])).toThrow();
    expect(() => applyDelta(null, [9, 999, 1], [])).toThrow();
  });
});

describe("codec", () => {
  test("input frames survive the wire (quantized)", () => {
    const f = { seq: 42, mx: 0.7071, my: -0.7071, aim: 2.5, buttons: 5, pressed: 1, dt: 0.0166, shotId: 9 };
    const back = inputFromWire(inputToWire(f))!;
    expect(back.seq).toBe(42);
    expect(back.mx).toBeCloseTo(0.7071, 2);
    expect(back.aim).toBeCloseTo(2.5, 3);
    expect(back.dt).toBeCloseTo(0.017, 3);
    expect(inputFromWire([1, 2, 3])).toBeNull();
    expect(inputFromWire([NaN, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  test("private self state round-trips", () => {
    const w = new World("openVoid", 2, 1);
    const p = w.addPlayer(1, "A", 0, false);
    p.x = 123.4;
    p.y = -56.7;
    p.slots = [{ id: "singularity", cd: 3.2, recast: 0 }, null, null];
    p.ult = { id: "overdrive", charge: 55 };
    const s = decodeSelf(encodeSelf(p))!;
    expect(s.x).toBeCloseTo(123.4, 1);
    expect(s.slots[0]).toEqual({ id: "singularity", cd: 3.2, recast: 0 });
    expect(s.ult).toEqual({ id: "overdrive", charge: 55 });
  });
});

describe("placement points", () => {
  test("5/3/2/1/0 plus kills", () => {
    const deaths = [{ id: 5, tick: 10 }, { id: 4, tick: 20 }, { id: 3, tick: 30 }, { id: 2, tick: 40 }];
    const kills = new Map([[1, 2], [2, 1]]);
    const pl = placements([1, 2, 3, 4, 5], deaths, kills);
    expect(pl.map((p) => [p.playerId, p.place, p.points])).toEqual([[1, 1, 7], [2, 2, 4], [3, 3, 2], [4, 4, 1], [5, 5, 0]]);
  });

  test("simultaneous deaths share the lower place", () => {
    const pl = placements([1, 2, 3], [{ id: 2, tick: 50 }, { id: 3, tick: 50 }], new Map());
    expect(pl.find((p) => p.playerId === 2)?.place).toBe(3);
    expect(pl.find((p) => p.playerId === 3)?.place).toBe(3);
    expect(pl.find((p) => p.playerId === 1)?.points).toBe(POINTS.placement[0]);
  });
});

describe("draft", () => {
  test("offers are distinct and avoid held powers", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 100; i++) {
      const held = ["singularity", "portalPair"] as const;
      const o = draftOffer(rng, held, 4);
      expect(new Set(o).size).toBe(4);
      expect(o.some((x) => held.includes(x as (typeof held)[number]))).toBe(false);
      expect(o.every((x) => POWER_IDS.includes(x))).toBe(true);
    }
  });

  test("comeback: last place gets the 4th card, never when everyone is tied", () => {
    expect(comebackPlayers(new Map([[1, 0], [2, 0]])).size).toBe(0);
    expect([...comebackPlayers(new Map([[1, 7], [2, 2], [3, 2]]))].sort()).toEqual([2, 3]);
  });

  test("new pick replaces the older slot; slots never move", () => {
    let l = applyPick({ slots: [null, null], older: 0 }, "singularity");
    l = applyPick(l, "portalPair");
    expect(l.slots).toEqual(["singularity", "portalPair"]);
    l = applyPick(l, "hexSwap");
    expect(l.slots).toEqual(["hexSwap", "portalPair"]);
    l = applyPick(l, "magnetar");
    expect(l.slots).toEqual(["hexSwap", "magnetar"]);
  });
});

describe("rng", () => {
  test("same seed, same sequence", () => {
    const a = new Rng(77);
    const b = new Rng(77);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });
});
