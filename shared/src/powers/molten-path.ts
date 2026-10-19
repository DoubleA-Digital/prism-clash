// MOLTEN PATH: for 4s you bleed lava. Every drop is a capsule back to the previous one, so
// the trail is one solid ribbon that burns anyone on the ground for 3s. Airborne players
// (Shockwave Slam) are immune. Hex Swap looks for these (kind "molten", owner = caster).

import { HAZARD_TICK, NET, POWERS } from "../config";
import { dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect, Player } from "../sim/types";
import type { World } from "../sim/world";
import { glow, poly } from "./icon";

const C = POWERS.moltenPath;
const BURN_EVERY = Math.max(1, Math.round(HAZARD_TICK * NET.tickRate));

/** Last drop per player per world: where it was, when, and its effect id. */
const lastDrop = new WeakMap<World, Map<number, { x: number; y: number; t: number }>>();
/** Tick each (owner, victim) pair was last burned, so overlapping drops burn once per tick. */
const burned = new WeakMap<World, Map<string, number>>();

function drops(w: World) {
  let m = lastDrop.get(w);
  if (!m) {
    m = new Map();
    lastDrop.set(w, m);
  }
  return m;
}

/** Squared distance from a point to the segment a→b. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return dist2(px, py, ax + dx * t, ay + dy * t);
}

/** Is the player standing on this lava drop (its capsule from x2,y2 to x,y)? */
export function onMolten(e: Effect, p: Player): boolean {
  const reach = e.r + p.r * 0.4;
  if (e.n === 1) return segDist2(p.x, p.y, e.x2, e.y2, e.x, e.y) <= reach * reach;
  return dist2(p.x, p.y, e.x, e.y) <= reach * reach;
}

function dropLava(w: World, p: Player) {
  const m = drops(w);
  const prev = m.get(p.id);
  const linked = !!prev && dist2(prev.x, prev.y, p.x, p.y) < (C.radius * 3) ** 2;
  w.spawnEffect({
    kind: "molten", owner: p.id, source: "moltenPath", x: p.x, y: p.y, r: C.radius, life: C.trailLife,
    // n = 1: capsule joined to the previous drop at (x2, y2).
    n: linked ? 1 : 0, x2: linked && prev ? prev.x : p.x, y2: linked && prev ? prev.y : p.y,
  });
  m.set(p.id, { x: p.x, y: p.y, t: w.time });
}

export const moltenPath = definePower({
  id: "moltenPath",
  name: "Molten Path",
  description: "For 4s you leave a lava trail that burns enemies on the ground. The lava lingers for 3s.",
  color: "#FF6A1A",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    // A footprint trail of lava blobs with a flame on top.
    glow(ctx, "#FF6A1A", size * 0.14, size * 0.09);
    ctx.beginPath();
    ctx.moveTo(-size * 0.38, size * 0.3);
    ctx.quadraticCurveTo(-size * 0.05, size * 0.38, size * 0.05, size * 0.12);
    ctx.quadraticCurveTo(size * 0.12, -size * 0.04, size * 0.34, -size * 0.06);
    ctx.stroke();
    glow(ctx, "#FFD27A", size * 0.08, size * 0.04);
    ctx.beginPath();
    ctx.moveTo(-size * 0.38, size * 0.3);
    ctx.quadraticCurveTo(-size * 0.05, size * 0.38, size * 0.05, size * 0.12);
    ctx.quadraticCurveTo(size * 0.12, -size * 0.04, size * 0.34, -size * 0.06);
    ctx.stroke();
    const f = 1 + Math.sin(t * 9) * 0.06;
    glow(ctx, "#FF3B12", size * 0.16, size * 0.06);
    ctx.fillStyle = "#FF6A1A";
    poly(ctx, [
      [size * 0.34, -size * 0.12], [size * 0.48, -size * 0.3 * f], [size * 0.4, -size * 0.36 * f], [size * 0.34, -size * 0.46 * f],
      [size * 0.26, -size * 0.34 * f], [size * 0.2, -size * 0.3 * f],
    ], true, true);
    ctx.fillStyle = "#FFE7A3";
    ctx.shadowBlur = 0;
    poly(ctx, [[size * 0.34, -size * 0.14], [size * 0.4, -size * 0.26 * f], [size * 0.34, -size * 0.32 * f], [size * 0.28, -size * 0.24 * f]], true, true);
  },
  onCast(w, p) {
    w.addStatus(p, "molten", C.duration);
    drops(w).delete(p.id);
    dropLava(w, p);
    return true;
  },
  onPlayerTick(w, p) {
    if ((p.status.molten ?? 0) <= 0 || !p.alive) return;
    const prev = drops(w).get(p.id);
    if (!prev) return dropLava(w, p);
    const since = w.time - prev.t;
    const moved = dist2(prev.x, prev.y, p.x, p.y) >= C.minSpacing * C.minSpacing;
    if ((moved && since >= C.dropEvery - 1e-6) || since >= C.idleDropEvery) dropLava(w, p);
  },
  effects: {
    molten: {
      affectPlayer(w, e, p) {
        if (e.source !== "moltenPath" || p.id === e.owner) return;
        if (w.tick % BURN_EVERY !== 0 || (p.status.airborne ?? 0) > 0) return;
        if (!onMolten(e, p)) return;
        let b = burned.get(w);
        if (!b) {
          b = new Map();
          burned.set(w, b);
        }
        const key = `${e.owner}:${p.id}`;
        if (b.get(key) === w.tick) return;
        b.set(key, w.tick);
        w.damage(p, C.dps * HAZARD_TICK, e.owner, "moltenPath", { ground: true });
      },
    },
  },
  bot: { role: "zone" },
});
