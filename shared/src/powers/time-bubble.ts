// TIME BUBBLE: a dome where everyone but the caster runs at 25% speed, enemy shots included.
// The caster's own shots leaving the dome are flung out faster and harder.
// (The world already slows players inside a bubble; this file handles projectiles.)

import { POWERS } from "../config";
import { dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import { PF } from "../sim/types";
import { arc, circle, glow, poly } from "./icon";

const C = POWERS.timeBubble;
const COLOR = "#FFD166";

/** bubble: r = radius. hits = ids of the caster's projectiles currently inside (for the exit boost). */

export const timeBubble = definePower({
  id: "timeBubble",
  name: "Time Bubble",
  description: "Drop a dome where everything except you moves at 25% speed, enemy shots included. Your shots leaving it fly faster and hit harder.",
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    glow(ctx, COLOR, size * 0.14, size * 0.07);
    circle(ctx, 0, 0, size * 0.36);
    // Clock ticks around the dome.
    glow(ctx, COLOR, size * 0.04, size * 0.045);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = size * (i % 3 === 0 ? 0.24 : 0.29);
      poly(ctx, [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * size * 0.33, Math.sin(a) * size * 0.33]], false);
    }
    glow(ctx, "#ffffff", size * 0.06, size * 0.06);
    const h = t * 0.4 - Math.PI / 2;
    poly(ctx, [[0, 0], [Math.cos(h) * size * 0.2, Math.sin(h) * size * 0.2]], false);
    arc(ctx, 0, 0, size * 0.44, -Math.PI * 0.8, -Math.PI * 0.2);
  },
  onCast(w, p) {
    w.spawnEffect({ kind: "bubble", owner: p.id, source: "timeBubble", x: p.x, y: p.y, r: C.radius, life: C.duration });
    return true;
  },
  effects: {
    bubble: {
      affectProjectile(w, e, pr) {
        if (e.dead) return;
        const inside = dist2(pr.x, pr.y, e.x, e.y) < e.r * e.r;
        if (pr.owner !== e.owner) return inside ? C.slow : undefined;
        // Caster's shots: remember the ones inside; boost each once as it leaves.
        e.hits ??= new Map();
        if (inside) {
          e.hits.set(pr.id, 1);
          return;
        }
        if (!e.hits.has(pr.id)) return;
        e.hits.delete(pr.id);
        if ((pr.flags & PF.bubbleBoost) !== 0) return;
        pr.flags |= PF.bubbleBoost;
        pr.vx *= C.exitSpeedMult;
        pr.vy *= C.exitSpeedMult;
        pr.damage *= C.exitDamageMult;
        w.emit({ t: "impact", x: pr.x, y: pr.y, color: w.colorOf(pr.owner), size: 2 });
      },
    },
  },
  bot: { role: "zone" },
});
