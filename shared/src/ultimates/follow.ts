// Ultimate auras ride on effects that stick to their caster and vanish when the caster dies.

import type { Effect, Player } from "../sim/types";
import type { World } from "../sim/world";

/** Moves the effect onto its owner. Returns the owner, or null (and kills the effect) if gone. */
export function followOwner(w: World, e: Effect): Player | null {
  const p = w.players.get(e.owner);
  if (!p || !p.alive) {
    e.dead = true;
    return null;
  }
  e.x = p.x;
  e.y = p.y;
  return p;
}
