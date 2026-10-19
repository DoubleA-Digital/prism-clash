// CHRONO REWIND: snap back to where you were 2.5s ago and undo the damage taken since.
// Everyone sees a chain of ghostly afterimages replaying your path backwards.

import { POWERS } from "../config";
import { definePower } from "../sim/hooks";
import type { Player } from "../sim/types";
import type { World } from "../sim/world";
import { arc, circle, glow, poly } from "./icon";

const C = POWERS.chronoRewind;
const COLOR = "#3DFFB4";

/**
 * rewindTrail: one segment of the rewind path, (x, y) → (x2, y2). n = segment index from the
 * present (0) back to the past, v = segment count, so clients stagger the afterimages.
 */
function spawnTrail(w: World, p: Player, path: readonly { x: number; y: number }[]) {
  // Present first, then back in time.
  const pts = [{ x: p.x, y: p.y }, ...[...path].reverse()];
  const want = Math.min(C.trailPoints, pts.length);
  if (want < 2) return;
  const picked: { x: number; y: number }[] = [];
  for (let i = 0; i < want; i++) {
    const pt = pts[Math.round((i / (want - 1)) * (pts.length - 1))];
    if (pt) picked.push(pt);
  }
  const segs = picked.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = picked[i];
    const b = picked[i + 1];
    if (!a || !b) continue;
    w.spawnEffect({ kind: "rewindTrail", owner: p.id, source: "chronoRewind", x: a.x, y: a.y, x2: b.x, y2: b.y, r: p.r, n: i, v: segs, life: C.trailLife });
  }
}

export const chronoRewind = definePower({
  id: "chronoRewind",
  name: "Chrono Rewind",
  description: "Snap back to where you were 2.5s ago and undo the damage you took since. Everyone sees your ghostly path.",
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    const r = size * 0.32;
    glow(ctx, COLOR, size * 0.12, size * 0.075);
    // Clock face with a gap, and an arrowhead sweeping counter-clockwise.
    arc(ctx, 0, 0, r, -Math.PI * 0.25, Math.PI * 1.45);
    const ax = Math.cos(-Math.PI * 0.25) * r;
    const ay = Math.sin(-Math.PI * 0.25) * r;
    poly(ctx, [[ax - size * 0.13, ay - size * 0.02], [ax, ay], [ax + size * 0.02, ay - size * 0.14]], false);
    // Hands spinning backwards.
    glow(ctx, "#ffffff", size * 0.06, size * 0.06);
    const h = -t * 2.5;
    poly(ctx, [[0, 0], [Math.cos(h) * r * 0.62, Math.sin(h) * r * 0.62]], false);
    poly(ctx, [[0, 0], [Math.cos(h * 0.3 - 1.4) * r * 0.42, Math.sin(h * 0.3 - 1.4) * r * 0.42]], false);
    circle(ctx, 0, 0, size * 0.035, true);
  },
  onCast(w, p) {
    const past = w.pastState(p, C.window);
    if (!past) return false;
    spawnTrail(w, p, w.historyPath(p, C.window));
    // Only damage taken inside the window comes back; heal() caps at max HP.
    const lost = past.hp - p.hp;
    if (lost > 0) w.heal(p, lost);
    p.vx = 0;
    p.vy = 0;
    p.px = 0;
    p.py = 0;
    p.dashT = 0;
    w.teleport(p, past.x, past.y);
    w.addStatus(p, "invulnerable", C.arriveInvuln);
    return true;
  },
  effects: {
    rewindTrail: {},
  },
  bot: { role: "defend", hpBelow: 50 },
});
