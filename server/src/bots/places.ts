// Where to go when there's nothing urgent: waiting spots beside a falling supply drop, bushes
// to ambush from inside the safe area, and loot spots to roam to (spread out per bot).

import { BOTS, type Player, type Rng, type World } from "@prism/shared";
import type { Spot } from "./combat";
import type { NavGrid } from "./nav";
import type { ZoneInfo } from "./utility";

/** A supply drop still falling (once it lands, its gear is ordinary loot). */
export function supplySpot(w: World, me: Player): Spot | null {
  for (const e of w.effects.values()) {
    if (e.kind !== "supplyDrop" || e.dead || e.n !== 0) continue;
    // Wait beside the landing spot, not under it (landing shoves people away).
    const d = Math.hypot(me.x - e.x, me.y - e.y) || 1;
    return { x: e.x + ((me.x - e.x) / d) * 130, y: e.y + ((me.y - e.y) / d) * 130 };
  }
  return null;
}

/** A bush near us inside the safe area to lie in wait (`hash` spreads bots over different bushes). */
export function findAmbush(grid: NavGrid, me: Player, zi: ZoneInfo, hash: (i: number) => number): Spot | null {
  const best = { d: Infinity, x: 0, y: 0 };
  grid.forCellsNear(me.x, me.y, BOTS.ambush.search, (i, x, y) => {
    if (!grid.bush[i] || !zi.safe(x, y)) return;
    const d = Math.hypot(x - me.x, y - me.y) + hash(i) * 120;
    if (d < best.d) {
      best.d = d;
      best.x = x;
      best.y = y;
    }
  });
  return Number.isFinite(best.d) ? { x: best.x, y: best.y } : null;
}

/** Somewhere worth walking to inside the safe area: a random nearby loot spot, else a point in the circle. */
export function pickRoam(w: World, me: Player, zi: ZoneInfo, rng: Rng, looter: boolean): Spot {
  const spots = w.map.lootSpots;
  let best: Spot | null = null;
  let bs = Infinity;
  for (let k = 0; k < 10 && spots.length; k++) {
    const s = spots[rng.int(spots.length)]!;
    if (!zi.safe(s.x, s.y)) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d < 250) continue;
    const score = d * (looter ? 0.6 : 1) + rng.next() * 500;
    if (score < bs) {
      bs = score;
      best = { x: s.x, y: s.y };
    }
  }
  if (best) return best;
  const z = w.zone;
  const known = z.phase === "warn" || z.phase === "shrink";
  const cx = known ? z.toX : z.stage < 0 ? 0 : z.x;
  const cy = known ? z.toY : z.stage < 0 ? 0 : z.y;
  const r = Math.min(known ? z.toR : z.r, w.map.half) * 0.6;
  const a = rng.range(0, Math.PI * 2);
  const d = r * Math.sqrt(rng.next());
  return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d };
}
