// BOUNTY BEACON: put a price on the match leader's head. They glow gold for everyone for 6s,
// can't hide in bushes, and anyone who damages them gains ultimate charge (world.damage
// handles the charge). A "beacon" effect follows each target to draw the column of light.
// LOS exception, on purpose: a bountied target is shown to everyone in view range even behind
// walls (world.visibleTo); a price on your head is the point. Marking itself ignores walls too.

import { POWERS } from "../config";
import { dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Player } from "../sim/types";
import type { World } from "../sim/world";
import { circle, glow, poly } from "./icon";

const C = POWERS.bountyBeacon;

/**
 * Who gets marked: the alive player(s) with the most match points. If that's only the
 * caster, the next-highest enemies instead (so it's never wasted). If nobody has points
 * yet, the nearest enemy.
 */
export function bountyTargets(w: World, caster: Player): Player[] {
  const enemies = w.enemiesOf(caster);
  if (!enemies.length) return [];
  const pts = (p: Player) => w.points.get(p.id) ?? 0;
  const top = Math.max(...enemies.map(pts));
  if (top <= 0) {
    // Nobody to hunt by score (the caster may lead, but no enemy has points): nearest enemy.
    let best = enemies[0] as Player;
    for (const e of enemies) if (dist2(e.x, e.y, caster.x, caster.y) < dist2(best.x, best.y, caster.x, caster.y)) best = e;
    return [best];
  }
  // Marks the highest-scoring enemies: they're the leaders (tied or alone), or, if the caster
  // leads alone, the runners-up.
  return enemies.filter((e) => pts(e) === top);
}

export const bountyBeacon = definePower({
  id: "bountyBeacon",
  name: "Bounty Beacon",
  description: "Mark the match leader: they glow gold for everyone for 6s, and anyone who damages them gains ultimate charge.",
  color: "#FFD34D",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    const pulse = 1 + Math.sin(t * 4) * 0.05;
    glow(ctx, "#FFD34D", size * 0.14, size * 0.06);
    circle(ctx, 0, 0, size * 0.36 * pulse);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      poly(ctx, [[Math.cos(a) * size * 0.26, Math.sin(a) * size * 0.26], [Math.cos(a) * size * 0.47, Math.sin(a) * size * 0.47]], false);
    }
    // Crown
    ctx.fillStyle = "#FFD34D";
    poly(ctx, [
      [-size * 0.17, size * 0.1], [-size * 0.19, -size * 0.1], [-size * 0.08, -size * 0.01], [0, -size * 0.15],
      [size * 0.08, -size * 0.01], [size * 0.19, -size * 0.1], [size * 0.17, size * 0.1],
    ], true, true);
    ctx.fillStyle = "#FFF4C8";
    ctx.shadowBlur = 0;
    circle(ctx, 0, size * 0.03, size * 0.035, true);
  },
  onCast(w, p) {
    const targets = bountyTargets(w, p);
    if (!targets.length) return false;
    for (const t of targets) {
      w.addStatus(t, "bountied", C.duration);
      // Already marked (by anyone): refresh that beacon rather than stacking a second one.
      const existing = [...w.effects.values()].find((e) => e.kind === "beacon" && e.link === t.id && !e.dead);
      if (existing) existing.life = Math.max(existing.life, existing.age + C.duration);
      else w.spawnEffect({ kind: "beacon", owner: p.id, source: "bountyBeacon", x: t.x, y: t.y, r: t.r, life: C.duration, link: t.id, n: w.points.get(t.id) ?? 0 });
    }
    return true;
  },
  effects: {
    beacon: {
      update(w, e) {
        const t = w.players.get(e.link);
        if (!t || !t.alive) {
          e.dead = true;
          return;
        }
        e.x = t.x;
        e.y = t.y;
      },
    },
  },
  bot: { role: "buff" },
});
