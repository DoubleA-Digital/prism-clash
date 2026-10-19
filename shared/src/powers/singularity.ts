// SINGULARITY: a slow orb that collapses into a black hole after 0.8s (or on contact),
// dragging players and projectiles in for 2.5s, bending bullet paths, then detonating.

import { POWERS } from "../config";
import { dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect } from "../sim/types";
import { PROJ } from "../sim/types";
import type { World } from "../sim/world";
import { arc, circle, glow } from "./icon";

const C = POWERS.singularity;

function collapse(w: World, owner: number, x: number, y: number) {
  w.spawnEffect({ kind: "singularity", owner, source: "singularity", x, y, r: C.radius, life: C.duration });
}

export const singularity = definePower({
  id: "singularity",
  name: "Singularity",
  description: "Throw an orb that becomes a black hole, pulling players and shots in for 2.5s before detonating for 25.",
  color: "#9B5CFF",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    glow(ctx, "#9B5CFF", size * 0.14, size * 0.07);
    for (let i = 0; i < 3; i++) {
      const a = t * 2 + (i * Math.PI * 2) / 3;
      arc(ctx, 0, 0, size * (0.18 + i * 0.09), a, a + Math.PI * 1.1);
    }
    ctx.fillStyle = "#05010c";
    ctx.shadowBlur = 0;
    circle(ctx, 0, 0, size * 0.12, true);
    glow(ctx, "#E7D6FF", size * 0.1, size * 0.03);
    circle(ctx, 0, 0, size * 0.12);
  },
  onCast(w, p) {
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    w.spawnProjectile({
      owner: p.id, kind: PROJ.singularityOrb, source: "singularity", x: p.x + cos * 34, y: p.y + sin * 34,
      vx: cos * C.speed, vy: sin * C.speed, r: 16, damage: 0, life: C.fuse,
    });
    return true;
  },
  onProjectileExpire(w, pr) {
    collapse(w, pr.owner, pr.x, pr.y);
  },
  onHit(w, pr, _target, x, y) {
    collapse(w, pr.owner, x, y);
  },
  effects: {
    singularity: {
      affectPlayer(_w, e: Effect, p) {
        if ((p.status.airborne ?? 0) > 0) return;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > e.r * e.r || d2 < 1) return;
        const d = Math.sqrt(d2);
        // Stronger near the core, gentler at the edge; the caster feels a weaker pull.
        const k = (1 - d / e.r) * (p.id === e.owner ? 0.45 : 1) * (1 / 30);
        p.px += (dx / d) * C.pull * k * 0.9;
        p.py += (dy / d) * C.pull * k * 0.9;
      },
      affectProjectile(_w, e, pr, dt) {
        if (pr.kind === PROJ.singularityOrb) return;
        const dx = e.x - pr.x;
        const dy = e.y - pr.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > e.r * e.r || d2 < 1) return;
        const d = Math.sqrt(d2);
        const k = (1 - d / e.r) * C.projectilePull * dt;
        pr.vx += (dx / d) * k;
        pr.vy += (dy / d) * k;
        // Keep speed so shots curve rather than stall.
        const sp = Math.hypot(pr.vx, pr.vy);
        if (sp > 1400) {
          pr.vx *= 1400 / sp;
          pr.vy *= 1400 / sp;
        }
        // Shots that reach the core are swallowed.
        if (d < C.coreRadius * 0.45) pr.dead = true;
      },
      onExpire(w, e) {
        // v = 2 when a Shockwave Slam knocked an enemy into it (Gravity Slam combo).
        const mult = e.v >= 2 ? 2 : 1;
        w.explode(e.x, e.y, C.detonateRadius, C.damage * mult, e.owner, "singularity", { knock: 600, hitOwner: false });
        for (const pl of w.players.values()) {
          if (pl.alive && pl.id !== e.owner && dist2(pl.x, pl.y, e.x, e.y) < (C.detonateRadius + pl.r) ** 2) pl.status.slowed = Math.max(pl.status.slowed ?? 0, 0.6);
        }
      },
    },
  },
  bot: { role: "attack", range: 520 },
});
