// Bot picks for the pre-match ultimate and power drafts and in-match Prism Shard drafts:
// round out the loadout (an attack power first, then something defensive or mobile), never
// take a duplicate, lean toward the personality's taste, with a little randomness.

import { powerDef, type BotHint, type PowerId, type Rng, type UltId } from "@prism/shared";
import type { PersonalityId } from "./personality";

type Role = BotHint["role"];

const ROLE_TASTE: Record<PersonalityId, Record<Role, number>> = {
  aggressive: { attack: 0.35, buff: 0.3, zone: 0.1, mobility: 0.1, defend: 0 },
  cautious: { attack: 0, buff: 0, zone: 0.15, mobility: 0.3, defend: 0.35 },
  looter: { attack: 0.15, buff: 0.1, zone: 0.1, mobility: 0.2, defend: 0.15 },
};

const ULT_TASTE: Record<PersonalityId, Partial<Record<UltId, number>>> = {
  aggressive: { overdrive: 0.5, meteorRain: 0.35, riftCollapse: 0.3, echoStorm: 0.25 },
  cautious: { finalStand: 0.5, huntersEye: 0.4, riftCollapse: 0.15 },
  looter: { huntersEye: 0.35, echoStorm: 0.3, overdrive: 0.2 },
};

const roleOf = (id: PowerId): Role => powerDef(id)?.bot.role ?? "buff";

export function pickPowerIndex(options: readonly PowerId[], held: readonly (PowerId | null)[], personality: PersonalityId, rng: Rng): number {
  const roles = held.filter((h): h is PowerId => !!h).map(roleOf);
  const hasAttack = roles.includes("attack");
  const hasSafety = roles.includes("defend") || roles.includes("mobility");
  let best = 0;
  let bestScore = -Infinity;
  options.forEach((o, i) => {
    const role = roleOf(o);
    let s = rng.next() * 0.6 + ROLE_TASTE[personality][role];
    if (!hasAttack && role === "attack") s += 0.9;
    if (hasAttack && !hasSafety && (role === "defend" || role === "mobility")) s += 0.5;
    if (roles.length && roles.every((r) => r === role)) s -= 0.3;
    if (held.includes(o)) s -= 5;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}

export function pickUltIndex(options: readonly UltId[], personality: PersonalityId, rng: Rng): number {
  let best = 0;
  let bestScore = -Infinity;
  options.forEach((o, i) => {
    const s = rng.next() * 0.7 + (ULT_TASTE[personality][o] ?? 0);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}
