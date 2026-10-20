// HEX SWAP: trade places with the nearest enemy in your aim cone that you can see (walls and
// smoke block the hex). Enemy shots about to hit you curve onto them instead. Swapping someone
// onto a molten trail locks them in the lava. Both ends of a swap are spots a fighter was just
// standing on, and each is still checked against the map, so nobody lands inside geometry.

import { POWERS } from "../config";
import { angleDiff, dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Player, Projectile } from "../sim/types";
import { PF } from "../sim/types";
import type { World } from "../sim/world";
import { triggerCombo } from "./combos";
import { clearSpot, inSight } from "./geometry";
import { glow, ngon, poly } from "./icon";

const C = POWERS.hexSwap;
const COLOR = "#E2FF4F";
const CONE = (C.coneDeg * Math.PI) / 180;

/** hexFlash: (x, y) = where the caster landed, (x2, y2) = where the enemy landed, link = enemy. */

function findTarget(w: World, p: Player): Player | null {
  let best: Player | null = null;
  let bd = C.range * C.range;
  for (const o of w.enemiesOf(p)) {
    const d = dist2(p.x, p.y, o.x, o.y);
    if (d > bd) continue;
    if (Math.abs(angleDiff(p.aim, Math.atan2(o.y - p.y, o.x - p.x))) > CONE) continue;
    if (!inSight(w, p.x, p.y, o.x, o.y)) continue;
    bd = d;
    best = o;
  }
  return best;
}

/** Enemy shots that would reach (x, y) within the window, before anyone moves. */
function incoming(w: World, p: Player, swappedWith: Player) {
  const out: Projectile[] = [];
  for (const pr of w.projectiles) {
    if (pr.dead || pr.owner === p.id || pr.owner === swappedWith.id || (pr.flags & PF.captured) !== 0) continue;
    const sp2 = pr.vx * pr.vx + pr.vy * pr.vy;
    if (sp2 < 1) continue;
    const rx = p.x - pr.x;
    const ry = p.y - pr.y;
    const t = (rx * pr.vx + ry * pr.vy) / sp2;
    if (t < 0 || t > C.retargetWithin) continue;
    const cx = rx - pr.vx * t;
    const cy = ry - pr.vy * t;
    const reach = p.r + pr.r + C.retargetPad;
    if (cx * cx + cy * cy <= reach * reach) out.push(pr);
  }
  return out;
}

export const hexSwap = definePower({
  id: "hexSwap",
  name: "Hex Swap",
  description: "Swap places with the nearest enemy you're aiming at and can see. Shots about to hit you curve onto them instead.",
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size) {
    // Two hexagons with crossing swap arrows.
    glow(ctx, COLOR, size * 0.12, size * 0.06);
    ctx.save();
    ctx.translate(-size * 0.24, size * 0.16);
    poly(ctx, ngon(6, size * 0.17, Math.PI / 6));
    ctx.restore();
    ctx.save();
    ctx.translate(size * 0.24, -size * 0.16);
    poly(ctx, ngon(6, size * 0.17, Math.PI / 6));
    ctx.restore();
    glow(ctx, "#ffffff", size * 0.08, size * 0.055);
    poly(ctx, [[-size * 0.12, -size * 0.3], [size * 0.06, -size * 0.38], [size * 0.03, -size * 0.2]], false);
    poly(ctx, [[size * 0.12, size * 0.3], [-size * 0.06, size * 0.38], [-size * 0.03, size * 0.2]], false);
  },
  onCast(w, p) {
    const t = findTarget(w, p);
    if (!t) return false;
    const threats = incoming(w, p, t);
    const ax = p.x;
    const ay = p.y;
    const toCaster = clearSpot(w, t.x, t.y, p.r, t.x, t.y);
    const toTarget = clearSpot(w, ax, ay, t.r, ax, ay);
    w.teleport(p, toCaster.x, toCaster.y);
    w.teleport(t, toTarget.x, toTarget.y);
    p.px = 0;
    p.py = 0;
    t.px = 0;
    t.py = 0;
    // Shots that were about to hit the caster now hunt the swapped enemy, same speed.
    for (const pr of threats) {
      const sp = Math.hypot(pr.vx, pr.vy);
      const a = Math.atan2(t.y - pr.y, t.x - pr.x);
      pr.vx = Math.cos(a) * sp;
      pr.vy = Math.sin(a) * sp;
      pr.flags |= PF.retargeted;
    }
    w.spawnEffect({ kind: "hexFlash", owner: p.id, link: t.id, source: "hexSwap", x: p.x, y: p.y, x2: t.x, y2: t.y, r: p.r * 2, life: C.flashLife });
    // Lava Lock: the enemy landed on a molten trail.
    for (const m of w.effects.values()) {
      if (m.kind !== "molten" || m.dead) continue;
      if (dist2(t.x, t.y, m.x, m.y) > (m.r + t.r * 0.5) ** 2) continue;
      triggerCombo(w, p.id, "lavaLock", t.x, t.y, [m.owner]);
      w.addStatus(t, "slowed", C.lavaLockSlow);
      t.vx = 0;
      t.vy = 0;
      break;
    }
    return true;
  },
  effects: {
    hexFlash: {},
  },
  bot: { role: "attack", range: 600 },
});
