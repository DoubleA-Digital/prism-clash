// Full bot matches with no network: 12 bots with powers on each real map play one long
// battle royale to the end without exceptions, they move, loot, fight, and the zone closes.
import { describe, expect, test } from "vitest";
import { allPowers, allUlts, MATCH, PLAY_MAPS, World, type InputFrame, type MapId } from "@prism/shared";
import { createBrain } from "../src/bots/brain";

function playMatch(seed: number, map: MapId) {
  const w = new World(map, seed);
  const powers = allPowers();
  const ults = allUlts();
  const brains = new Map<number, ReturnType<typeof createBrain>>();
  for (let i = 1; i <= MATCH.fighters; i++) {
    const p = w.addPlayer(i, `BOT${i}`, i - 1, true);
    const a = powers[(seed + i) % Math.max(1, powers.length)];
    const b = powers[(seed + i * 7 + 3) % Math.max(1, powers.length)];
    p.slots = [a ? { id: a.id, cd: 0, recast: 0 } : null, b ? { id: b.id, cd: 0, recast: 0 } : null];
    const u = ults[(seed + i) % Math.max(1, ults.length)];
    p.ult = u ? { id: u.id, charge: 40 } : null;
    brains.set(i, createBrain(i % 3 === 0 ? "hard" : i % 2 ? "normal" : "easy", seed * 31 + i));
  }
  w.placeSpawns();
  const start = new Map([...w.players.values()].map((p) => [p.id, { x: p.x, y: p.y }] as const));
  let ticks = 0;
  let maxTravel = 0;
  const limit = 30 * MATCH.maxSeconds;
  while (w.alivePlayers().length > 1 && ticks < limit) {
    const inputs = new Map<number, InputFrame[]>();
    for (const p of w.alivePlayers()) inputs.set(p.id, [brains.get(p.id)!.think(w, p)]);
    w.step(inputs);
    ticks++;
    if (ticks % 300 === 0) {
      for (const p of w.alivePlayers()) {
        const s = start.get(p.id)!;
        maxTravel = Math.max(maxTravel, Math.hypot(p.x - s.x, p.y - s.y));
      }
    }
  }
  return { w, ticks, maxTravel };
}

describe("headless bot matches", () => {
  for (const map of PLAY_MAPS) {
    test(`12 bots finish a full match on ${map}`, () => {
      const { w, ticks, maxTravel } = playMatch(3, map);
      expect(w.alivePlayers().length).toBeLessThanOrEqual(1);
      expect(w.deaths.length).toBeGreaterThanOrEqual(MATCH.fighters - 1);
      expect(ticks).toBeLessThan(30 * MATCH.maxSeconds);
      expect(maxTravel).toBeGreaterThan(600);
      const shots = [...w.stats.values()].reduce((a, s) => a + s.shots, 0);
      const looted = [...w.stats.values()].reduce((a, s) => a + s.looted, 0);
      const kills = [...w.stats.values()].reduce((a, s) => a + s.kills, 0);
      expect(shots).toBeGreaterThan(100);
      expect(looted).toBeGreaterThan(10);
      expect(kills).toBeGreaterThan(2);
    });
  }
});
