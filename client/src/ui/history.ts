// UI-side tally of the current match for the Tab scoreboard: kills and damage per player,
// accumulated from game events as they play out, plus who has been eliminated (and when).

import { session } from "../net/session";

class MatchTally {
  private dmg = new Map<number, number>();
  private kill = new Map<number, number>();
  private out = new Map<number, number>();

  install() {
    session.onGameEvent((e) => {
      if (e.t === "hit" && e.by > 0 && e.by !== e.target) this.dmg.set(e.by, (this.dmg.get(e.by) ?? 0) + e.amount);
      if (e.t === "kill") {
        if (e.killer) this.kill.set(e.killer, (this.kill.get(e.killer) ?? 0) + 1);
        this.out.set(e.victim, this.out.size + 1);
      }
    });
    session.subscribe(() => {
      if (session.phase === "lobby" || session.phase === "ultSelect" || session.phase === "menu") this.reset();
    });
  }

  reset() {
    this.dmg.clear();
    this.kill.clear();
    this.out.clear();
  }

  damage(playerId: number): number {
    return Math.round(this.dmg.get(playerId) ?? 0);
  }

  kills(playerId: number): number {
    return this.kill.get(playerId) ?? 0;
  }

  /** Order of elimination (1 = first out), or 0 if still in. */
  eliminated(playerId: number): number {
    return this.out.get(playerId) ?? 0;
  }
}

export const history = new MatchTally();
