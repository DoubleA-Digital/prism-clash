// Neutral floor hazards dropped by ghosts (Ghost Haunt): a lava puddle that burns and a
// slowing field. They hurt anyone on the ground, credit no one, and never touch the airborne.

import { GHOST, HAZARD_TICK, NET } from "../config";
import { dist2 } from "../math/vec";
import { defineEffects } from "../sim/hooks";

const every = Math.max(1, Math.round(HAZARD_TICK * NET.tickRate));

defineEffects({
  lava: {
    affectPlayer(w, e, p) {
      if (e.source !== "haunt") return;
      if ((p.status.airborne ?? 0) > 0) return;
      if (dist2(p.x, p.y, e.x, e.y) > (e.r + p.r * 0.5) ** 2) return;
      if (w.tick % every === 0) w.damage(p, GHOST.lava.dps * HAZARD_TICK, 0, "haunt", { ground: true, noCharge: true });
    },
  },
  slowField: {
    affectPlayer(w, e, p) {
      if ((p.status.airborne ?? 0) > 0) return;
      if (dist2(p.x, p.y, e.x, e.y) > (e.r + p.r * 0.5) ** 2) return;
      w.addStatus(p, "slowed", 0.15);
    },
  },
});
