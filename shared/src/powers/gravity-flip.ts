// GRAVITY FLIP: a swirling orb. Whoever it hits has their movement inverted for 2.5s
// (movement.ts reads the "inverted" status). A "flip" effect follows the victim for the
// duration so everyone can see who's scrambled. The orb is a projectile: walls and cover stop
// it, and Magnetar, portals and Singularities affect it like any shot.

import { POWERS } from "../config";
import { definePower } from "../sim/hooks";
import { PROJ } from "../sim/types";
import { arc, glow, poly } from "./icon";

const C = POWERS.gravityFlip;

export const gravityFlip = definePower({
  id: "gravityFlip",
  name: "Gravity Flip",
  description: "Fire a swirling orb. Any enemy it hits has inverted movement for 2.5s.",
  color: "#7BFF6B",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    glow(ctx, "#7BFF6B", size * 0.12, size * 0.07);
    const a = t * 2.5;
    arc(ctx, 0, 0, size * 0.36, a, a + Math.PI * 0.75);
    arc(ctx, 0, 0, size * 0.36, a + Math.PI, a + Math.PI * 1.75);
    ctx.fillStyle = "#7BFF6B";
    const head = (ang: number) => {
      const x = Math.cos(ang) * size * 0.36;
      const y = Math.sin(ang) * size * 0.36;
      const tx = -Math.sin(ang);
      const ty = Math.cos(ang);
      poly(ctx, [[x + tx * size * 0.12, y + ty * size * 0.12], [x - ty * size * 0.1, y + tx * size * 0.1], [x + ty * size * 0.1, y - tx * size * 0.1]], true, true);
    };
    head(a + Math.PI * 0.75);
    head(a + Math.PI * 1.75);
    // Up/down arrows swapped in the middle
    glow(ctx, "#E9FFE4", size * 0.06, size * 0.06);
    poly(ctx, [[-size * 0.1, -size * 0.04], [-size * 0.1, size * 0.18]], false);
    poly(ctx, [[-size * 0.17, size * 0.1], [-size * 0.1, size * 0.18], [-size * 0.03, size * 0.1]], false);
    poly(ctx, [[size * 0.1, size * 0.04], [size * 0.1, -size * 0.18]], false);
    poly(ctx, [[size * 0.03, -size * 0.1], [size * 0.1, -size * 0.18], [size * 0.17, -size * 0.1]], false);
  },
  onCast(w, p) {
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    w.spawnProjectile({
      owner: p.id, kind: PROJ.gravity, source: "gravityFlip", x: p.x + cos * 32, y: p.y + sin * 32,
      vx: cos * C.speed, vy: sin * C.speed, r: C.radius, damage: C.damage, life: C.range / C.speed,
    });
    return true;
  },
  onHit(w, pr, target, x, y) {
    const dealt = w.damage(target, C.damage, pr.owner, "gravityFlip", { x, y });
    // Invulnerable (dash i-frames, Final Stand) targets shrug it off entirely.
    if (dealt <= 0 && (target.status.invulnerable ?? 0) > 0) return;
    w.stat(pr.owner).hits++;
    w.addStatus(target, "inverted", C.duration);
    // Clear any older flip on this target so there's one marker.
    for (const e of w.effects.values()) if (e.kind === "flip" && e.link === target.id) e.dead = true;
    w.spawnEffect({ kind: "flip", owner: pr.owner, source: "gravityFlip", x: target.x, y: target.y, r: target.r, life: C.duration, link: target.id });
  },
  effects: {
    flip: {
      update(w, e) {
        const t = w.players.get(e.link);
        if (!t || !t.alive || (t.status.inverted ?? 0) <= 0) {
          e.dead = true;
          return;
        }
        e.x = t.x;
        e.y = t.y;
      },
    },
  },
  bot: { role: "attack", range: 640 },
});
