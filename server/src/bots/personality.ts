// A bot's character: the lobby difficulty (reaction, aim, cover use…) combined with a
// personality (aggressive, cautious, looter) whose numbers are jittered per bot, so eleven
// bots spread out, loot differently and pick different fights.

import { BOTS, type Difficulty, type Rng } from "@prism/shared";

export type PersonalityId = keyof typeof BOTS.personalities;
export const PERSONALITY_IDS = Object.keys(BOTS.personalities) as PersonalityId[];

export interface Profile {
  difficulty: Difficulty;
  personality: PersonalityId;
  reaction: number;
  aimErrorDeg: number;
  aimSettle: number;
  castChance: number;
  dodgeSkill: number;
  leadSkill: number;
  throwSkill: number;
  hearing: number;
  /** Appetite for fights (difficulty × personality). */
  aggression: number;
  /** How likely they are to break line of sight when it makes sense. */
  coverUse: number;
  /** How much they value loot and how cleanly they judge it. */
  loot: number;
  lootSmarts: number;
  /** Multiplier on each gun's preferred fighting range. */
  range: number;
  /** How early they leave for the next zone (higher = earlier). */
  rotateEarly: number;
  ambush: number;
  supply: number;
  thirdParty: number;
  healBelow: number;
}

export function makeProfile(difficulty: Difficulty, rng: Rng, forced?: PersonalityId): Profile {
  const d = BOTS.difficulty[difficulty];
  const weights = {} as Record<PersonalityId, number>;
  for (const id of PERSONALITY_IDS) weights[id] = BOTS.personalities[id].weight;
  const personality = forced ?? rng.weighted(weights);
  const p = BOTS.personalities[personality];
  const j = () => 1 + (rng.next() * 2 - 1) * BOTS.personalityJitter;
  return {
    difficulty,
    personality,
    reaction: d.reaction * j(),
    aimErrorDeg: d.aimErrorDeg * j(),
    aimSettle: d.aimSettle,
    castChance: d.castChance,
    dodgeSkill: d.dodgeSkill,
    leadSkill: d.leadSkill,
    throwSkill: d.throwSkill,
    hearing: d.hearing,
    aggression: d.aggression * p.aggression * j(),
    coverUse: Math.min(1, d.coverUse * p.caution * j()),
    loot: p.loot * j(),
    lootSmarts: d.lootSmarts,
    range: p.range * j(),
    rotateEarly: p.rotateEarly * j(),
    ambush: p.ambush * j(),
    supply: p.supply * j(),
    thirdParty: p.thirdParty * j(),
    healBelow: p.healBelow * j(),
  };
}
