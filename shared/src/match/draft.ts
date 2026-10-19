// The draft: offers of distinct powers, a 4th card for whoever is last on points,
// and new picks replacing the older of a player's two slots.

import { MATCH } from "../config";
import type { Rng } from "../math/rng";
import type { PowerId, UltId } from "../sim/types";
import { POWER_IDS, ULT_IDS } from "../sim/types";

/** Players tied for last on points get the comeback card (never when everyone is tied). */
export function comebackPlayers(points: ReadonlyMap<number, number>): Set<number> {
  const vals = [...points.values()];
  if (vals.length < 2) return new Set();
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return new Set();
  return new Set([...points].filter(([, v]) => v === min).map(([id]) => id));
}

/** Distinct powers, avoiding ones the player already holds. */
export function draftOffer(rng: Rng, held: readonly (PowerId | null)[], count: number): PowerId[] {
  const pool = POWER_IDS.filter((id) => !held.includes(id));
  return rng.shuffle([...pool]).slice(0, Math.min(count, pool.length));
}

export function offerSize(playerId: number, comeback: ReadonlySet<number>): number {
  return comeback.has(playerId) ? MATCH.comebackOptions : MATCH.draftOptions;
}

export function ultOffer(rng: Rng): UltId[] {
  return rng.shuffle([...ULT_IDS]).slice(0, MATCH.ultOptions);
}

export interface DraftLoadout {
  slots: (PowerId | null)[];
  /** Index of the older slot: the next pick replaces it. Slots never move, so Q and E stay put. */
  older: number;
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
