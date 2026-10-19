// Battle royale scoring: placement points per round, +1 per kill, first to 15.

import { POINTS } from "../config";
import type { Placement } from "../net/protocol";

/**
 * Placements for a finished round. `deaths` is in order of death (first died = last place);
 * players who died on the same tick share the lowest of their tied places.
 * Points use the top of the table: with 3 players, 1st/2nd/3rd get 5/3/2.
 */
export function placements(playerIds: readonly number[], deaths: readonly { id: number; tick: number }[], kills: ReadonlyMap<number, number>): Placement[] {
  const n = playerIds.length;
  const dead = new Set(deaths.map((d) => d.id));
  const out: Placement[] = [];
  const survivors = playerIds.filter((id) => !dead.has(id));
  // Survivors share first place (normally exactly one).
  for (const id of survivors) out.push({ playerId: id, place: 1, points: 0, kills: kills.get(id) ?? 0 });
  // Walk deaths from last to first: later deaths place higher.
  let place = survivors.length + 1;
  for (let i = deaths.length - 1; i >= 0; ) {
    const tick = deaths[i]?.tick ?? 0;
    const group: number[] = [];
    while (i >= 0 && deaths[i]?.tick === tick) {
      const d = deaths[i];
      if (d && !group.includes(d.id)) group.push(d.id);
      i--;
    }
    const shared = Math.min(n, place + group.length - 1);
    for (const id of group) out.push({ playerId: id, place: shared, points: 0, kills: kills.get(id) ?? 0 });
    place += group.length;
  }
  for (const p of out) p.points = (POINTS.placement[p.place - 1] ?? 0) + p.kills * POINTS.perKill;
  return out.sort((a, b) => a.place - b.place);
}

/** The match winner once someone reached the target: most points, then round wins, then kills. */
export function matchLeader(ids: readonly number[], points: ReadonlyMap<number, number>, roundWins: ReadonlyMap<number, number>, kills: ReadonlyMap<number, number>): number {
  return [...ids].sort((a, b) =>
    (points.get(b) ?? 0) - (points.get(a) ?? 0) || (roundWins.get(b) ?? 0) - (roundWins.get(a) ?? 0) || (kills.get(b) ?? 0) - (kills.get(a) ?? 0),
  )[0] ?? 0;
}

export function matchOver(points: ReadonlyMap<number, number>): boolean {
  for (const v of points.values()) if (v >= POINTS.toWin) return true;
  return false;
}
