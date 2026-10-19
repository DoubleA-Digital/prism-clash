// RICOCHET PRISM: for 6s your shots bounce off walls and pillars up to 4 times, growing
// stronger and shifting color each bounce (rainbow on the last). The bounce itself lives in
// world.stepProjectile; this power grants the status and a prism aura everyone can see.

import { POWERS } from "../config";
import { definePower } from "../sim/hooks";
import { glow, poly } from "./icon";

const C = POWERS.ricochetPrism;
const COLOR = "#FF7BF2";

/** prismAura: follows its owner for the duration (the client orbits prism shards around them). */

export const ricochetPrism = definePower({
  id: "ricochetPrism",
  name: "Ricochet Prism",
  description: "For 6s your shots bounce off walls and pillars up to 4 times, gaining damage and color each bounce. Rainbow on the last.",
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size) {
    // A prism with a beam zig-zagging out of it in shifting colors.
    glow(ctx, "#ffffff", size * 0.12, size * 0.07);
    poly(ctx, [[-size * 0.36, size * 0.3], [-size * 0.08, -size * 0.3], [size * 0.2, size * 0.3]]);
    const cols = ["#7cf6ff", "#ff7bf2", "#ffd34d", "#9dff3a"];
    const pts: [number, number][] = [[-size * 0.06, size * 0.02], [size * 0.18, -size * 0.2], [size * 0.3, size * 0.06], [size * 0.42, -size * 0.18], [size * 0.48, size * 0.02]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) continue;
      glow(ctx, cols[i] ?? COLOR, size * 0.1, size * 0.06);
      poly(ctx, [a, b], false);
    }
  },
  onCast(w, p) {
    w.addStatus(p, "ricochet", C.duration);
    for (const e of w.effects.values()) if (e.kind === "prismAura" && e.owner === p.id) e.dead = true;
    w.spawnEffect({ kind: "prismAura", owner: p.id, source: "ricochetPrism", x: p.x, y: p.y, r: p.r * 2, life: C.duration });
    return true;
  },
  effects: {
    prismAura: {
      update(w, e) {
        const p = w.players.get(e.owner);
        if (!p || !p.alive || (p.status.ricochet ?? 0) <= 0) {
          e.dead = true;
          return;
        }
        e.x = p.x;
        e.y = p.y;
      },
    },
  },
  bot: { role: "buff" },
});
