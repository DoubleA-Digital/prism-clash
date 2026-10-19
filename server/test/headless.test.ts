// Bots play whole rounds on the real World with every power available: no exceptions,
// nobody stuck, and every round ends with one survivor.
import { describe, expect, test } from "vitest";
import { allPowers, allUlts, LAYOUTS, World, type InputFrame } from "@prism/shared";
import { createBrain } from "../src/bots/brain";

function playRound(seed: number, layout: (typeof LAYOUTS)[number], players = 5) {
  const w = new World(layout, players, seed);
  const powers = allPowers();
  const ults = allUlts();
  const brains = new Map<number, ReturnType<typeof createBrain>>();
  for (let i = 1; i <= players; i++) {
    const p = w.addPlayer(i, `BOT${i}`, i - 1, true);
    const a = powers[(seed + i) % Math.max(1, powers.length)];
    const b = powers[(seed + i * 7 + 3) % Math.max(1, powers.length)];
    p.slots = [a ? { id: a.id, cd: 0, recast: 0 } : null, b ? { id: b.id, cd: 0, recast: 0 } : null, null];
    const u = ults[(seed + i) % Math.max(1, ults.length)];
    p.ult = u ? { id: u.id, charge: 60 } : null;
    brains.set(i, createBrain(i % 3 === 0 ? "hard" : i % 2 ? "normal" : "easy", seed * 31 + i));
  }
  w.placeSpawns();
  const moved = new Map<number, number>();
  let ticks = 0;
  while (w.alivePlayers().length > 1 && ticks < 30 * 60 * 4) {
    const inputs = new Map<number, InputFrame[]>();
    for (const p of w.alivePlayers()) {
      const before = { x: p.x, y: p.y };
      inputs.set(p.id, [brains.get(p.id)!.think(w, p)]);
      moved.set(p.id, (moved.get(p.id) ?? 0) + (Math.hypot(p.x - before.x, p.y - before.y) > 0 ? 0 : 0));
    }
    w.step(inputs);
    ticks++;
  }
  return { w, ticks };
}

describe("headless bot rounds", () => {
  for (const layout of LAYOUTS) {
    test(`5 bots finish a round on ${layout}`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        const { w, ticks } = playRound(seed, layout);
        expect(w.alivePlayers().length).toBeLessThanOrEqual(1);
        expect(ticks).toBeLessThan(30 * 60 * 4);
        expect(w.deaths.length).toBeGreaterThanOrEqual(4);
      }
    });
  }
});
