// Full bot matches with no network: 12 bots with powers on each real map play one long
// battle royale to the end without exceptions, they move, loot, fight, and the zone closes.
import { describe, expect, test } from "vitest";
import { MATCH, PLAY_MAPS } from "@prism/shared";
import { playBotMatch } from "./support/botMatch";

describe("headless bot matches", () => {
  for (const map of PLAY_MAPS) {
    test(`12 bots finish a full match on ${map}`, () => {
      const r = playBotMatch(3, map);
      expect(r.w.alivePlayers().length).toBeLessThanOrEqual(1);
      expect(r.w.deaths.length).toBeGreaterThanOrEqual(MATCH.fighters - 1);
      expect(r.ticks).toBeLessThan(30 * MATCH.maxSeconds);
      expect(r.maxTravel).toBeGreaterThan(600);
      expect(r.shots).toBeGreaterThan(100);
      expect(r.looted).toBeGreaterThan(10);
      expect(r.kills).toBeGreaterThan(2);
    });
  }
});
