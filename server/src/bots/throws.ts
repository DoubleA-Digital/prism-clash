// When and where bots use throwables: frags at enemies hiding behind cover or bunched up,
// smoke to cover an escape or a heal, shock mines dropped behind them when chased or at a
// doorway they're holding.

import { BOTS, bulletBlocked, type Player, type World } from "@prism/shared";
import type { NavGrid } from "./nav";
import type { Contact } from "./perception";

const T = BOTS.throws;

export interface ThrowContext {
  w: World;
  me: Player;
  grid: NavGrid;
  visible: readonly Contact[];
  target: Contact | null;
  now: number;
  fleeing: boolean;
  healing: boolean;
  /** Holding a spot (ambush, waiting behind cover). */
  holding: boolean;
  skill: number;
  rand: () => number;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const aimAt = (me: Player, x: number, y: number) => Math.atan2(y - me.y, x - me.x);

/** Aim for a throw this think, or null to keep it. */
export function planThrow(c: ThrowContext): number | null {
  const { me, w } = c;
  const item = me.inv.throwable;
  if (!item || me.inv.throws <= 0 || me.throwCd > 0 || me.healKind) return null;
  if (c.rand() > T.chance * (0.4 + c.skill)) return null;
  const [lo, hi] = T.fragRange;
  if (item === "frag") {
    const t = c.target;
    if (t) {
      const d = dist(me, t);
      if (d >= lo && d <= hi) {
        // Behind cover we can't shoot through, or just ducked out of sight.
        if (!t.visible && c.now - t.seenAt < 2.5) return aimAt(me, t.x, t.y);
        if (t.visible && bulletBlocked(w.map, me.x, me.y, t.x, t.y)) return aimAt(me, t.x, t.y);
      }
    }
    for (let i = 0; i < c.visible.length; i++) {
      for (let j = i + 1; j < c.visible.length; j++) {
        const a = c.visible[i]!;
        const b = c.visible[j]!;
        if (dist(a, b) > T.clusterRadius) continue;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const d = Math.hypot(mx - me.x, my - me.y);
        if (d >= lo && d <= hi) return aimAt(me, mx, my);
      }
    }
    return null;
  }
  const threat = c.target ?? c.visible[0] ?? null;
  if (item === "smoke") {
    if (!(c.fleeing || c.healing) || !threat) return null;
    return dist(me, threat) < T.smokeRange ? aimAt(me, threat.x, threat.y) : null;
  }
  // Shock mine.
  if (c.fleeing && threat && threat.visible && dist(me, threat) < T.mineChaseRange) return aimAt(me, threat.x, threat.y);
  if (!c.holding && !c.healing) return null;
  const best = { d: Infinity, x: 0, y: 0 };
  c.grid.forCellsNear(me.x, me.y, T.mineChokeRange, (i, x, y) => {
    if (!c.grid.choke[i]) return;
    const d = Math.hypot(x - me.x, y - me.y);
    if (d < 90 || d >= best.d) return;
    for (const e of w.effects.values()) if (e.kind === "mine" && Math.hypot(e.x - x, e.y - y) < 160) return;
    best.d = d;
    best.x = x;
    best.y = y;
  });
  return Number.isFinite(best.d) ? aimAt(me, best.x, best.y) : null;
}
