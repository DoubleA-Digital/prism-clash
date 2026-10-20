// Putting a power into a slot mid-match (Prism Shard drafts). The new power arrives ready to
// cast. If it replaces one, the outgoing power is wound down the way it would have ended on its
// own: an open recast window expires (a lonely portal fizzles), and its passive leftovers are
// cleared (onUnequip), so nothing keeps running for a power the player no longer holds. Live
// effects already in the world (a clone, a field, lava) simply play out their lifetime.

import { powerDef } from "../sim/hooks";
import type { Player, PowerId, PowerSlot } from "../sim/types";
import type { World } from "../sim/world";

export function equipPower(w: World, p: Player, index: number, id: PowerId): PowerSlot {
  const old = p.slots[index];
  if (old && old.id !== id) {
    const def = powerDef(old.id);
    if (old.recast > 0) {
      old.recast = 0;
      def?.onRecastExpire?.(w, p, old);
    }
    def?.onUnequip?.(w, p);
  }
  if (old && old.id === id) return old;
  const slot: PowerSlot = { id, cd: 0, recast: 0 };
  p.slots[index] = slot;
  return slot;
}
