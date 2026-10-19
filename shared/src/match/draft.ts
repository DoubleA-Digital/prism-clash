// The draft: offers of distinct powers, and new picks filling an empty slot or replacing
// the older of a player's two slots.

import { MATCH } from "../config";
import type { Rng } from "../math/rng";
import type { PowerId, UltId } from "../sim/types";
import { POWER_IDS, ULT_IDS } from "../sim/types";

/** Distinct powers, avoiding ones the player already holds. */
export function draftOffer(rng: Rng, held: readonly (PowerId | null)[], count: number = MATCH.draftOptions): PowerId[] {
  const pool = POWER_IDS.filter((id) => !held.includes(id));
  return rng.shuffle([...pool]).slice(0, Math.min(count, pool.length));
}

export function ultOffer(rng: Rng): UltId[] {
  return rng.shuffle([...ULT_IDS]).slice(0, MATCH.ultOptions);
}

export interface DraftLoadout {
  slots: (PowerId | null)[];
  /** Index of the older slot: the next pick replaces it. Slots never move, so Q and E stay put. */
  older: number;
}

/** Which slot a new pick will land in. */
export function pickSlot(l: DraftLoadout): number {
  const empty = [l.slots[0] ?? null, l.slots[1] ?? null].indexOf(null);
  return empty >= 0 ? empty : l.older;
}

export function applyPick(l: DraftLoadout, pick: PowerId): DraftLoadout {
  const slots = [l.slots[0] ?? null, l.slots[1] ?? null];
  const empty = slots.indexOf(null);
  if (empty >= 0) {
    slots[empty] = pick;
    const other = 1 - empty;
    return { slots, older: slots[other] ? other : empty };
  }
  slots[l.older] = pick;
  return { slots, older: 1 - l.older };
}
