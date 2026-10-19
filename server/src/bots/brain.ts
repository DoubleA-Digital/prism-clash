// Bot brain interface + the default brain. A bot produces one InputFrame per tick through
// the same validation and cooldowns as a human, so it can't cheat.

import { type Difficulty, type InputFrame, type Player, type PowerId, type UltId, type World } from "@prism/shared";
import { SmartBrain } from "./smart";

export interface BotBrain {
  think(w: World, me: Player): InputFrame;
  pickUlt(options: readonly UltId[]): number;
  pickPower(options: readonly PowerId[], held: readonly (PowerId | null)[]): number;
}

export function createBrain(difficulty: Difficulty, seed: number): BotBrain {
  return new SmartBrain(difficulty, seed);
}
