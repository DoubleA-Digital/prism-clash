// UI-side store of finished rounds, built from the session's roundEnd messages. The session only
// keeps the latest round, but the Tab scoreboard and standings want placements for every round.

import type { Placement } from "@prism/shared";
import { session } from "../net/session";

export interface RoundRecord {
  round: number;
  placements: Placement[];
  winnerId: number;
}

class RoundHistory {
  rounds: RoundRecord[] = [];
  private dmg = new Map<number, number>();

  install() {
    // Match damage per player, accumulated from hit events as they play out.
    session.onGameEvent((e) => {
      if (e.t === "hit" && e.by > 0 && e.by !== e.target) this.dmg.set(e.by, (this.dmg.get(e.by) ?? 0) + e.amount);
    });
    session.subscribe(() => {
      const re = session.roundEnd;
      if (re && !this.rounds.some((r) => r.round === re.round)) this.rounds.push({ round: re.round, placements: re.placements, winnerId: re.winnerId });
      if (session.phase === "lobby" || session.phase === "ultSelect" || session.phase === "menu") {
        this.rounds = [];
        this.dmg.clear();
      }
    });
  }

  damage(playerId: number): number {
    return Math.round(this.dmg.get(playerId) ?? 0);
  }

  kills(playerId: number): number {
    let k = 0;
    for (const r of this.rounds) k += r.placements.find((p) => p.playerId === playerId)?.kills ?? 0;
    return k;
  }

  /** Placement (1-based) per finished round, or null when the player was not in that round. */
  places(playerId: number): (number | null)[] {
    return this.rounds.map((r) => r.placements.find((p) => p.playerId === playerId)?.place ?? null);
  }

  wins(playerId: number): number {
    return this.rounds.filter((r) => r.winnerId === playerId).length;
  }
}

export const history = new RoundHistory();
