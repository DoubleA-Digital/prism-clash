// Profiles full 10-bot matches on both maps (bots draft their own loadouts, like a room's
// pre-match): every match must finish without exceptions, and the bots' share of each 33 ms
// server tick must stay small. Prints winner, kills, duration and per-tick costs.
import { describe, expect, test } from "vitest";
import { MATCH, PLAY_MAPS } from "@prism/shared";
import { describeMatch, playBotMatch } from "./support/botMatch";

const SEEDS = [11, 4, 23];

describe("bot match benchmark", () => {
  for (const map of PLAY_MAPS) {
    test(`${MATCH.fighters}-bot matches on ${map} finish and stay cheap`, () => {
      for (const seed of SEEDS) {
        const r = playBotMatch(seed, map, { draft: true });
        console.log(`seed ${seed} ${describeMatch(map, r)}`);
        expect(r.w.alivePlayers().length).toBeLessThanOrEqual(1);
        expect(r.ticks).toBeLessThan(30 * MATCH.maxSeconds);
        expect(r.w.deaths.length).toBeGreaterThanOrEqual(MATCH.fighters - 1);
        expect(r.looted).toBeGreaterThan(20);
        // Bots' whole share of a tick, averaged: well under a millisecond on a dev machine.
        expect(r.botMs.mean).toBeLessThan(2);
      }
    });
  }
});
