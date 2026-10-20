// Bot brain interface + the default brain. A bot produces one InputFrame per tick through
// the same validation and cooldowns as a human, so it can't cheat.

import { type Difficulty, type InputFrame, type Player, type PowerId, type UltId, type World } from "@prism/shared";
import { Nav } from "./nav";
import type { PersonalityId } from "./personality";
import { SmartBrain } from "./smart";

export interface BotBrain {
  think(w: World, me: Player): InputFrame;
  pickUlt(options: readonly UltId[]): number;
  pickPower(options: readonly PowerId[], held: readonly (PowerId | null)[]): number;
}

/** Builds the shared nav grid for a match's map ahead of time (it's ~20-40 ms, once per match). */
export function prepareBots(w: World): void {
  Nav.of(w);
}

/** A bot for the lobby difficulty; its personality is rolled from the seed unless given. */
export function createBrain(difficulty: Difficulty, seed: number, personality?: PersonalityId): BotBrain {
  return new SmartBrain(difficulty, seed, personality);
}
