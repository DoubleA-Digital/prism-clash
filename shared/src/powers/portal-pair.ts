// PORTAL PAIR: first cast drops an orange portal, recast drops the blue one. Anything that
// enters one exits the other with its momentum: players, every projectile, even tethers.

import { POWERS } from "../config";
import { dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect, Player, Projectile } from "../sim/types";
import { PF, PROJ } from "../sim/types";
import type { World } from "../sim/world";
import { triggerCombo } from "./combos";
import { circle, glow } from "./icon";

const C = POWERS.portalPair;
/** n: 0 = orange (first), 1 = blue (second). link = partner id once paired. */

function partner(w: World, e: Effect): Effect | null {
  const p = e.link ? w.effects.get(e.link) : undefined;
  return p && !p.dead ? p : null;
}

function exitPoint(e: Effect, vx: number, vy: number, clearance: number) {
  const l = Math.hypot(vx, vy);
  const dx = l > 1 ? vx / l : Math.cos(e.angle);
  const dy = l > 1 ? vy / l : Math.sin(e.angle);
  return { x: e.x + dx * clearance, y: e.y + dy * clearance };
}

export const portalPair = definePower({
  id: "portalPair",
  name: "Portal Pair",
  description: "Drop an orange portal, recast for blue. Players and shots pass through with their momentum. Portals last 10s.",
  color: "#FF8A2B",
  cooldown: C.cooldown,
  drawIcon(ctx, size) {
    const r = size * 0.22;
    glow(ctx, "#FF8A2B", size * 0.12, size * 0.08);
    ctx.save();
    ctx.scale(0.62, 1);
    circle(ctx, -size * 0.36, 0, r);
    ctx.restore();
    glow(ctx, "#3FA9FF", size * 0.12, size * 0.08);
    ctx.save();
    ctx.scale(0.62, 1);
    circle(ctx, size * 0.36, 0, r);
    ctx.restore();
    glow(ctx, "#ffffff", size * 0.05, size * 0.04);
    ctx.setLineDash([size * 0.05, size * 0.06]);
    ctx.beginPath();
    ctx.moveTo(-size * 0.1, 0);
    ctx.lineTo(size * 0.1, 0);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  onCast(w, p, slot) {
    w.spawnEffect({ kind: "portal", owner: p.id, source: "portalPair", x: p.x, y: p.y, r: C.radius, life: C.placeWindow + C.duration, n: 0, angle: p.aim });
    slot.recast = C.placeWindow;
    return true;
  },
  onRecast(w, p, slot) {
    slot.recast = 0;
    const orange = [...w.effects.values()].find((e) => e.kind === "portal" && e.owner === p.id && e.n === 0 && !e.link && !e.dead);
    if (!orange) return;
    if (dist2(orange.x, orange.y, p.x, p.y) < (C.radius * 3) ** 2) {
      // Too close to be useful: nudge the blue portal out along the aim.
      const ok = w.insideArena(p.x + Math.cos(p.aim) * C.radius * 3, p.y + Math.sin(p.aim) * C.radius * 3, C.radius);
      if (!ok) return;
    }
    const blue = w.spawnEffect({ kind: "portal", owner: p.id, source: "portalPair", x: p.x, y: p.y, r: C.radius, life: C.duration, n: 1, angle: p.aim, link: orange.id });
    orange.link = blue.id;
    orange.life = orange.age + C.duration;
    w.emit({ t: "cast", by: p.id, power: "portalPair", x: p.x, y: p.y, angle: p.aim });
  },
  onRecastExpire(w, p) {
    // No second portal placed in time: the lonely orange one fizzles.
    for (const e of w.effects.values()) if (e.kind === "portal" && e.owner === p.id && !e.link) e.dead = true;
  },
  effects: {
    portal: {
      affectPlayer(w, e, pl: Player) {
        const out = partner(w, e);
        if (!out) return;
        if ((pl.status.airborne ?? 0) > 0) return;
        if (dist2(pl.x, pl.y, e.x, e.y) > (e.r * 0.8) ** 2) return;
        e.hits ??= new Map();
        out.hits ??= new Map();
        const last = Math.max(e.hits.get(pl.id) ?? -99, out.hits.get(pl.id) ?? -99);
        if (w.time - last < C.exitCooldown) return;
        e.hits.set(pl.id, w.time);
        out.hits.set(pl.id, w.time);
        const vx = pl.vx + pl.px;
        const vy = pl.vy + pl.py;
        const exit = exitPoint(out, vx, vy, out.r + pl.r * 0.2);
        const from = { x: pl.x, y: pl.y };
        w.teleport(pl, exit.x, exit.y);
        w.emit({ t: "portal", x: from.x, y: from.y, x2: exit.x, y2: exit.y });
      },
      affectProjectile(w, e, pr: Projectile) {
        if (pr.portalCd > 0) return;
        const out = partner(w, e);
        if (!out) return;
        if (dist2(pr.x, pr.y, e.x, e.y) > (e.r + pr.r) ** 2) return;
        const exit = exitPoint(out, pr.vx, pr.vy, out.r + pr.r + 2);
        pr.x = exit.x;
        pr.y = exit.y;
        pr.portalCd = 0.3;
        pr.flags |= PF.portalled;
        pr.portalOwner = e.owner;
        w.emit({ t: "portal", x: e.x, y: e.y, x2: exit.x, y2: exit.y });
        if ((pr.flags & PF.ricochet) !== 0) triggerCombo(w, pr.owner, "prismPortal", exit.x, exit.y, [e.owner]);
        if (pr.kind === PROJ.tether) triggerCombo(w, pr.owner, "stormGate", exit.x, exit.y, [e.owner]);
      },
    },
  },
  bot: { role: "mobility" },
});
