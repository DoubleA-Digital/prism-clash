// Importing an ultimate file registers it (defineUlt). To add one: create its file,
// then add one import line here.

import { defineEffects } from "../sim/hooks";
import { POWER_IDS } from "../sim/types";

// Echo Storm's delayed second cast rides on a short "flash" effect (v = -1, n = power index).
defineEffects({
  flash: {
    onExpire(w, e) {
      if (e.v !== -1) return;
      const p = w.players.get(e.owner);
      const id = POWER_IDS[e.n];
      if (p && id) w.echoCast(p, id);
    },
  },
});

export { allUlts, ultDef } from "../sim/hooks";
