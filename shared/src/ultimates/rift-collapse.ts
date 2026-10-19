// RIFT COLLAPSE: tear a glowing rift across the map along your aim (a segment through
// you, clipped to the walls). For 3s it drags everyone but you toward it, then slams shut:
// heavy damage to anyone within closeRadius of the line. The rift is drawn for its whole
// life with a danger band and a quickening pulse, so the slam is always readable.
// Effect: (x, y)–(x2, y2) are the endpoints; n = 0 while pulling, 1 after the slam.

import { ULTIMATES } from "../config";
import { pointSegment } from "../math/vec";
import { defineUlt } from "../sim/hooks";
import type { Effect } from "../sim/types";
import type { World } from "../sim/world";
import { glow, poly } from "../powers/icon";
import { ultFrame } from "./ult-icon";

const C = ULTIMATES.riftCollapse;
export const RIFT_PULLING = 0;
export const RIFT_CLOSED = 1;

/** Distance from (x, y) along (dx, dy) to the map edge (minus a margin), capped at max.
 *  The rift tears straight through buildings. */
function reachWall(w: World, x: number, y: number, dx: number, dy: number, max: number): number {
  const h = w.map.half - 10;
  let t = max;
  if (dx > 1e-6) t = Math.min(t, (h - x) / dx);
  if (dx < -1e-6) t = Math.min(t, (-h - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (h - y) / dy);
  if (dy < -1e-6) t = Math.min(t, (-h - y) / dy);
  return Math.max(0, t);
}

/** Endpoints of the rift for a caster at (x, y) aiming `aim`. */
export function riftSegment(w: World, x: number, y: number, aim: number) {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  const fwd = reachWall(w, x, y, dx, dy, C.halfLength);
  const back = reachWall(w, x, y, -dx, -dy, C.halfLength);
  return { x: x - dx * back, y: y - dy * back, x2: x + dx * fwd, y2: y + dy * fwd };
}

function slam(w: World, e: Effect) {
  e.n = RIFT_CLOSED;
  for (const p of w.players.values()) {
    if (!p.alive || p.id === e.owner) continue;
    const s = pointSegment(p.x, p.y, e.x, e.y, e.x2, e.y2);
    if (s.d > C.closeRadius + p.r) continue;
    w.damage(p, C.closeDamage, e.owner, "riftCollapse", { x: p.x, y: p.y });
    // Thrown clear of the seam, away from the line.
    const ox = p.x - s.cx;
    const oy = p.y - s.cy;
    const l = Math.hypot(ox, oy);
    const nx = l > 1 ? ox / l : -(e.y2 - e.y) / (Math.hypot(e.x2 - e.x, e.y2 - e.y) || 1);
    const ny = l > 1 ? oy / l : (e.x2 - e.x) / (Math.hypot(e.x2 - e.x, e.y2 - e.y) || 1);
    w.impulse(p, nx * C.closeKnock, ny * C.closeKnock);
  }
  // Blasts strung along the seam: the client turns each into a burst, a floor ripple and shake.
  const len = Math.hypot(e.x2 - e.x, e.y2 - e.y);
  const n = Math.max(2, Math.ceil(len / (C.closeRadius * 2.2)) + 1);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    w.emit({ t: "explode", x: e.x + (e.x2 - e.x) * t, y: e.y + (e.y2 - e.y) * t, r: C.closeRadius, source: "riftCollapse", by: e.owner });
  }
}

export const riftCollapse = defineUlt({
  id: "riftCollapse",
  name: "Rift Collapse",
  description: "Tear a rift across the map along your aim. It drags enemies toward it for 3s, then slams shut for 45 to anyone near it.",
  color: "#FF3DF0",
  drawIcon(ctx, size) {
    ultFrame(ctx, size, "#47063f");
    const s = size;
    // A jagged tear with inward arrows on both sides.
    const tear: [number, number][] = [[-0.3, 0.22], [-0.12, 0.06], [-0.06, 0.12], [0.08, -0.04], [0.12, 0.02], [0.3, -0.2]];
    const pts = tear.map(([x, y]) => [x * s, y * s] as [number, number]);
    glow(ctx, "#FF3DF0", s * 0.16, s * 0.07);
    poly(ctx, pts, false);
    glow(ctx, "#ffffff", s * 0.06, s * 0.025);
    poly(ctx, pts, false);
    glow(ctx, "#FFD34D", s * 0.05, s * 0.03);
    for (const d of [-1, 1]) {
      const cx = d * 0.13 * s;
      const cy = d * 0.17 * s;
      poly(ctx, [[cx - 0.06 * s * d, cy], [cx, cy - 0.07 * s * d], [cx + 0.06 * s * d, cy]], false);
    }
  },
  onCast(w, p) {
    const seg = riftSegment(w, p.x, p.y, p.aim);
    w.spawnEffect({ kind: "rift", owner: p.id, source: "riftCollapse", ...seg, r: C.closeRadius, life: C.pullTime + C.afterglow, n: RIFT_PULLING, angle: p.aim });
    return true;
  },
  effects: {
    rift: {
      update(w, e) {
        if (e.n === RIFT_PULLING && e.age >= C.pullTime) slam(w, e);
      },
      affectPlayer(w, e, p, dt) {
        if (e.n !== RIFT_PULLING || p.id === e.owner || (p.status.airborne ?? 0) > 0) return;
        const s = pointSegment(p.x, p.y, e.x, e.y, e.x2, e.y2);
        if (s.d < 6) return;
        const k = C.pull * dt * (C.nearMult + (C.farMult - C.nearMult) * Math.min(1, s.d / C.farRange));
        w.impulse(p, ((s.cx - p.x) / s.d) * k, ((s.cy - p.y) / s.d) * k);
      },
    },
  },
  bot: { minTargets: 2 },
});
