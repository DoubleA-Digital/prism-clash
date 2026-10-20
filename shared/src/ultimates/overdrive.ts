// OVERDRIVE: 6s of white-hot fury with whatever gun you hold. Faster fire rate (and a faster
// Prism Lance charge and Energy Blade swing), shots cost no ammo, a reload in progress
// finishes at once, and every power cooldown snaps back to ready. Decision on ammo: free shots
// (no magazine drain at all), since 6s of uninterrupted fire is the fantasy; the fire-rate
// boost is 1.6x rather than 2x so rockets and the sniper stay sane. actFrame reads the status.

import { ULTIMATES } from "../config";
import { defineUlt } from "../sim/hooks";
import { glow, poly } from "../powers/icon";
import { followOwner } from "./follow";
import { ultFrame } from "./ult-icon";

const C = ULTIMATES.overdrive;

export const overdrive = defineUlt({
  id: "overdrive",
  name: "Overdrive",
  description: `For ${C.duration}s with any gun: ${C.fireRateMult}x fire rate, shots cost no ammo, reloads finish at once, and all your power cooldowns reset instantly.`,
  color: "#F4F8FF",
  drawIcon(ctx, size) {
    ultFrame(ctx, size, "#1d2a4a");
    // A fat lightning bolt with a white-hot core.
    const s = size;
    const bolt: [number, number][] = [[0.07, -0.33], [-0.17, 0.04], [-0.01, 0.04], [-0.08, 0.33], [0.18, -0.07], [0.02, -0.07], [0.1, -0.33]];
    const pts = bolt.map(([x, y]) => [x * s, y * s] as [number, number]);
    glow(ctx, "#7CF6FF", s * 0.16, s * 0.05);
    poly(ctx, pts);
    glow(ctx, "#ffffff", s * 0.08, 1);
    poly(ctx, pts, true, true);
    // Speed chevrons either side.
    glow(ctx, "#FFD34D", s * 0.05, s * 0.03);
    for (const d of [-1, 1]) {
      poly(ctx, [[d * 0.22 * s, -0.1 * s], [d * 0.3 * s, 0], [d * 0.22 * s, 0.1 * s]], false);
    }
  },
  onCast(w, p) {
    w.addStatus(p, "overdrive", C.duration);
    for (const s of p.slots) if (s) s.cd = 0;
    // A reload in progress finishes instantly: Overdrive is about firing, now.
    if (p.reloadT > 0) p.reloadT = 0.01;
    w.spawnEffect({ kind: "overdriveAura", owner: p.id, source: "overdrive", x: p.x, y: p.y, r: p.r, life: C.duration });
    return true;
  },
  effects: {
    overdriveAura: {
      update(w, e) {
        followOwner(w, e);
      },
    },
  },
  bot: { minTargets: 1 },
});
