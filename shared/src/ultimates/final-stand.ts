// FINAL STAND: for 3s you can't be hurt. Every hit is absorbed (world.damage adds it to
// p.absorbed while the `finalStand` status is on) and visibly fills a gold sphere. Then it
// all comes back out as one shockwave: base + 0.8 × absorbed, capped, with big knockback.
// Decision: while charging you can't shoot (fire cooldown held) and you move slowed, so the
// counterplay is clear: stop shooting it and get out of the marked blast radius.

import { ULTIMATES } from "../config";
import { defineUlt } from "../sim/hooks";
import type { Player } from "../sim/types";
import { circle, glow, ngon, poly } from "../powers/icon";
import { followOwner } from "./follow";
import { ultFrame } from "./ult-icon";

const C = ULTIMATES.finalStand;
/** Fire cooldown held while charging; comfortably longer than a tick so prediction sees it too. */
const HOLD_FIRE = 0.25;

export function finalStandDamage(absorbed: number): number {
  return Math.min(C.maxDamage, C.baseDamage + C.absorbMult * absorbed);
}

export const finalStand = defineUlt({
  id: "finalStand",
  name: "Final Stand",
  description: "Invulnerable for 3s while charging (no shooting, slowed). Then a huge shockwave: 20 damage plus 80% of everything you absorbed.",
  color: "#FFD34D",
  drawIcon(ctx, size) {
    ultFrame(ctx, size, "#4a3600");
    const s = size;
    // Shield with a blazing core and shockwave arcs.
    const shield: [number, number][] = [[0, -0.27], [0.2, -0.17], [0.17, 0.1], [0, 0.27], [-0.17, 0.1], [-0.2, -0.17]];
    glow(ctx, "#FFD34D", s * 0.12, s * 0.045);
    poly(ctx, shield.map(([x, y]) => [x * s, y * s] as [number, number]));
    glow(ctx, "#ffffff", s * 0.12, 1);
    circle(ctx, 0, 0, s * 0.075, true);
    glow(ctx, "#FFF3C4", s * 0.05, s * 0.02);
    poly(ctx, ngon(8, s * 0.12, Math.PI / 8));
  },
  onCast(w, p) {
    p.absorbed = 0;
    w.addStatus(p, "finalStand", C.charge + 1.5 * w.dt);
    w.addStatus(p, "slowed", C.charge);
    p.fireCd = Math.max(p.fireCd, HOLD_FIRE);
    w.spawnEffect({ kind: "finalStand", owner: p.id, source: "finalStand", x: p.x, y: p.y, r: C.radius, life: C.charge, v: 0 });
    return true;
  },
  effects: {
    finalStand: {
      update(w, e) {
        const p = followOwner(w, e);
        if (!p) return;
        e.v = p.absorbed;
        p.fireCd = Math.max(p.fireCd, HOLD_FIRE);
      },
      onExpire(w, e) {
        const p: Player | undefined = w.players.get(e.owner);
        if (!p || !p.alive) return;
        delete p.status.finalStand;
        const dmg = finalStandDamage(p.absorbed);
        p.absorbed = 0;
        w.explode(p.x, p.y, C.radius, dmg, p.id, "finalStand", { knock: C.knockback });
      },
    },
  },
  bot: { minTargets: 2, hpBelow: 40 },
});
