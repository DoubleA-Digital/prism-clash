// Battle royale placement: one long round, last fighter standing wins.

import type { Placement } from "../net/protocol";

/**
 * Placements for a finished match. `deaths` is in order of death (first died = last place);
 * players who died on the same tick share the lowest of their tied places.
 */
export function placements(playerIds: readonly number[], deaths: readonly { id: number; tick: number }[], kills: ReadonlyMap<number, number>): Placement[] {
  const n = playerIds.length;
  const dead = new Set(deaths.map((d) => d.id));
  const out: Placement[] = [];
  const survivors = playerIds.filter((id) => !dead.has(id));
  // Survivors share first place (normally exactly one).
  for (const id of survivors) out.push({ playerId: id, place: 1, kills: kills.get(id) ?? 0 });
  // Walk deaths from last to first: later deaths place higher.
  let place = survivors.length + 1;
  for (let i = deaths.length - 1; i >= 0; ) {
    const tick = deaths[i]?.tick ?? 0;
    const group: number[] = [];
    while (i >= 0 && deaths[i]?.tick === tick) {
      const d = deaths[i];
      if (d && !group.includes(d.id) && playerIds.includes(d.id)) group.push(d.id);
      i--;
    }
    const shared = Math.min(n, place + group.length - 1);
    for (const id of group) out.push({ playerId: id, place: shared, kills: kills.get(id) ?? 0 });
    place += group.length;
  }
  return out.sort((a, b) => a.place - b.place || b.kills - a.kills);
}

/** The match winner: first place, ties broken by kills. */
export function matchWinner(pl: readonly Placement[]): number {
  return pl[0]?.playerId ?? 0;
}
