// VOID CLOAK: fold into the void for 3s, a faint shimmer that's hidden from the minimap. Your
// first shot out of cloak is a guaranteed crit; taking damage tears the cloak away.
// (fireShot spends the crit; damage() breaks the cloak.)

import { POWERS } from "../config";
import { definePower } from "../sim/hooks";
import type { Player } from "../sim/types";
import { arc, circle, glow } from "./icon";

const C = POWERS.voidCloak;
const COLOR = "#8E9BFF";

/** voidBurst: n = 0 where you vanished (implosion), n = 1 where you reappeared (tear). */

/** Last known cloak state per player, to catch the moment it ends. */
const wasCloaked = new WeakMap<Player, boolean>();
/** When a cloak ended without a shot: the crit stays ready a little longer, then fades. */
const critUntil = new WeakMap<Player, number>();

export const voidCloak = definePower({
  id: "voidCloak",
  name: "Void Cloak",
  description: "Turn nearly invisible for 3s and vanish from the minimap. Your first shot out of cloak is a guaranteed crit. Taking damage breaks it.",
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    // A half-dissolved core: solid arc on one side, scattering dots on the other.
    glow(ctx, COLOR, size * 0.12, size * 0.07);
    arc(ctx, 0, 0, size * 0.3, Math.PI * 0.5, Math.PI * 1.5);
    circle(ctx, -size * 0.04, 0, size * 0.09, true);
    glow(ctx, "#ffffff", size * 0.08, size * 0.04);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.5 + (i / 6) * Math.PI;
      const r = size * (0.3 + 0.06 * Math.sin(t * 3 + i * 1.7));
      ctx.globalAlpha *= 1 - i * 0.1;
      circle(ctx, Math.cos(a) * r + size * 0.04 * i * 0.3, Math.sin(a) * r, size * (0.045 - i * 0.004), true);
      ctx.globalAlpha /= 1 - i * 0.1;
    }
  },
  onCast(w, p) {
    w.addStatus(p, "cloaked", C.duration);
    p.cloakCrit = true;
    wasCloaked.set(p, true);
    critUntil.delete(p);
    w.spawnEffect({ kind: "voidBurst", owner: p.id, source: "voidCloak", x: p.x, y: p.y, r: p.r * 3, n: 0, life: C.burstLife });
    return true;
  },
  onPlayerTick(w, p) {
    const now = (p.status.cloaked ?? 0) > 0;
    if (wasCloaked.get(p) && !now && p.alive) {
      // The reveal: shot fired, hit taken, or time ran out.
      w.spawnEffect({ kind: "voidBurst", owner: p.id, source: "voidCloak", x: p.x, y: p.y, r: p.r * 3, n: 1, life: C.burstLife });
      if (p.cloakCrit) critUntil.set(p, w.time + C.critGrace);
    }
    wasCloaked.set(p, now);
    const until = critUntil.get(p);
    if (until !== undefined && (w.time > until || !p.cloakCrit)) {
      p.cloakCrit = false;
      critUntil.delete(p);
    }
  },
  effects: {
    voidBurst: {},
  },
  bot: { role: "defend", hpBelow: 45 },
});
