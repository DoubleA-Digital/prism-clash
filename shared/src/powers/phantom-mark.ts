// PHANTOM MARK: a fast untouchable dash along your aim. Every enemy the dash passes through
// gets a sigil that detonates 1.5s later for 20, or double that if you land a basic shot on
// them before it pops (world.hitPlayer flags the sigil when that happens).

import { PLAYER, POWERS } from "../config";
import { pointSegment } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect, Player } from "../sim/types";
import type { World } from "../sim/world";
import { glow, ngon, poly } from "./icon";

const C = POWERS.phantomMark;
const COLOR = "#C06BFF";

/**
 * phantomDash: (x, y) where the dash began, (x2, y2) where the dasher is now; lingers briefly
 * as a streak. hits = ids already marked by this dash.
 * sigil: link = the marked player, follows them. n = 1 once the caster shot them (doubled).
 */

function mark(w: World, by: Player, target: Player) {
  for (const s of w.effects.values()) if (s.kind === "sigil" && s.owner === by.id && s.link === target.id) s.dead = true;
  w.spawnEffect({ kind: "sigil", owner: by.id, link: target.id, source: "phantomMark", x: target.x, y: target.y, r: 40, life: C.fuse });
  w.addStatus(target, "marked", C.fuse);
}

function sweep(w: World, e: Effect, p: Player) {
  e.hits ??= new Map();
  for (const o of w.enemiesOf(p)) {
    if (e.hits.has(o.id)) continue;
    const hit = pointSegment(o.x, o.y, e.x, e.y, e.x2, e.y2);
    if (hit.d <= o.r + p.r * 0.5 + C.markPad) {
      e.hits.set(o.id, w.time);
      mark(w, p, o);
    }
  }
}

export const phantomMark = definePower({
  id: "phantomMark",
  name: "Phantom Mark",
  description: "Dash through enemies, untouchable. Each one you pass gets a sigil that explodes for 20 after 1.5s, doubled if you shoot them first.",
  color: COLOR,
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    // A sigil (rotating hexagram) with a dash streak through it.
    glow(ctx, COLOR, size * 0.12, size * 0.06);
    poly(ctx, ngon(3, size * 0.3, t * 0.8 - Math.PI / 2));
    poly(ctx, ngon(3, size * 0.3, t * 0.8 + Math.PI / 2));
    glow(ctx, "#ffffff", size * 0.1, size * 0.07);
    poly(ctx, [[-size * 0.48, size * 0.16], [size * 0.48, -size * 0.16]], false);
    ctx.globalAlpha *= 0.5;
    poly(ctx, [[-size * 0.46, size * 0.3], [-size * 0.1, size * 0.18]], false);
    ctx.globalAlpha /= 0.5;
  },
  onCast(w, p) {
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    const sp = PLAYER.speed * C.dashSpeedMult;
    p.dashT = 0;
    p.vx = cos * sp;
    p.vy = sin * sp;
    p.px = 0;
    p.py = 0;
    w.addStatus(p, "dashing", C.dashDuration);
    w.addStatus(p, "invulnerable", C.dashDuration + C.iframePad);
    w.spawnEffect({ kind: "phantomDash", owner: p.id, source: "phantomMark", x: p.x, y: p.y, x2: p.x, y2: p.y, angle: p.aim, r: p.r, life: C.dashDuration + C.streakLinger });
    return true;
  },
  effects: {
    phantomDash: {
      update(w, e, dt) {
        const p = w.players.get(e.owner);
        if (!p || !p.alive) {
          e.dead = true;
          return;
        }
        if (e.age > C.dashDuration + dt) return;
        e.x2 = p.x;
        e.y2 = p.y;
        sweep(w, e, p);
        if ((p.status.dashing ?? 0) <= 0) {
          // Leave the dash with a little momentum instead of a dead stop.
          p.vx *= 0.3;
          p.vy *= 0.3;
          e.life = Math.min(e.life, e.age + C.streakLinger);
        }
      },
    },
    sigil: {
      update(w, e) {
        const t = w.players.get(e.link);
        if (!t || !t.alive) {
          e.dead = true;
          return;
        }
        e.x = t.x;
        e.y = t.y;
      },
      onExpire(w, e) {
        const t = w.players.get(e.link);
        if (!t || !t.alive) return;
        const doubled = e.n === 1;
        w.damage(t, C.damage * (doubled ? C.shotMult : 1), e.owner, "phantomMark", { crit: doubled, x: t.x, y: t.y });
        w.emit({ t: "explode", x: t.x, y: t.y, r: C.burstRadius * (doubled ? 1.4 : 1), source: "phantomMark", by: e.owner });
      },
    },
  },
  bot: { role: "attack", range: 280 },
});
