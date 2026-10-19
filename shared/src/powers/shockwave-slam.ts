// SHOCKWAVE SLAM: leap into the air (airborne: immune to ground hazards and shots, can't
// shoot), then crash down. Everyone in the radius is hurt and blasted outward; anyone the
// blast drives into a wall or pillar takes bonus slam damage.
// Combo (Gravity Slam): blast an enemy into a Singularity's detonation zone and the black
// hole's detonation damage doubles.
//
// One "shockwave" effect (source "shockwaveSlam") carries both phases: n = 0 while the
// caster is airborne (it tracks the landing spot), n = 1 after the slam (it tracks who was
// knocked back, for the wall bonus and the combo, for comboWindow seconds).

import { ARENA, POWERS } from "../config";
import { dist2 } from "../math/vec";
import { definePower } from "../sim/hooks";
import type { Effect } from "../sim/types";
import type { World } from "../sim/world";
import { triggerCombo } from "./combos";
import { arc, glow, poly } from "./icon";

const C = POWERS.shockwaveSlam;
const SING = POWERS.singularity;
/** Values in the knocked-target map (Effect.hits). */
const PENDING = 1;
const DONE_WALL = 2;

function slam(w: World, e: Effect) {
  const owner = w.players.get(e.owner);
  if (!owner || !owner.alive) {
    e.dead = true;
    return;
  }
  e.x = owner.x;
  e.y = owner.y;
  const knocked = new Map<number, number>();
  for (const p of w.playersNear(e.x, e.y, C.radius, owner.id)) {
    if ((p.status.airborne ?? 0) > 0) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    const nx = d > 1 ? dx / d : Math.cos(owner.aim);
    const ny = d > 1 ? dy / d : Math.sin(owner.aim);
    const f = C.minKnock + (1 - C.minKnock) * Math.max(0, 1 - d / (C.radius + p.r));
    w.damage(p, C.damage, owner.id, "shockwaveSlam", { x: p.x, y: p.y });
    w.impulse(p, nx * C.knockback * f, ny * C.knockback * f);
    knocked.set(p.id, PENDING);
  }
  for (const pl of w.arena.pillars) {
    if (!pl.dead && dist2(e.x, e.y, pl.x, pl.y) < (C.radius * 0.6 + pl.r) ** 2) w.damagePillar(pl.id, 4, pl.x, pl.y);
  }
  w.emit({ t: "explode", x: e.x, y: e.y, r: C.radius, source: "shockwaveSlam", by: owner.id });
  e.n = 1;
  e.hits = knocked;
  e.life = e.age + C.comboWindow;
}

/** After the slam: wall bonus damage and the Gravity Slam combo for knocked targets. */
function aftermath(w: World, e: Effect) {
  if (!e.hits) return;
  const slams = new Set<number>();
  for (const ev of w.events) if (ev.t === "wallSlam") slams.add(ev.target);
  for (const [id, state] of e.hits) {
    const p = w.players.get(id);
    if (!p || !p.alive) continue;
    if (state === PENDING && slams.has(id)) {
      e.hits.set(id, DONE_WALL);
      w.damage(p, ARENA.wallSlamDamage * C.wallBonus, e.owner, "shockwaveSlam", { x: p.x, y: p.y });
    }
    for (const s of w.effects.values()) {
      if (s.kind !== "singularity" || s.dead || s.v >= 2) continue;
      if (dist2(p.x, p.y, s.x, s.y) > (SING.detonateRadius + p.r) ** 2) continue;
      s.v = 2;
      triggerCombo(w, e.owner, "gravitySlam", s.x, s.y, [s.owner]);
    }
  }
}

export const shockwaveSlam = definePower({
  id: "shockwaveSlam",
  name: "Shockwave Slam",
  description: "Leap into the air (immune to ground hazards), then slam down, blasting everyone nearby into walls for bonus damage.",
  color: "#3DE0FF",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    const k = (t * 1.2) % 1;
    glow(ctx, "#3DE0FF", size * 0.12, size * 0.06);
    ctx.save();
    ctx.scale(1, 0.45);
    arc(ctx, 0, size * 0.62, size * (0.22 + k * 0.24), 0, Math.PI * 2);
    ctx.globalAlpha = 0.5;
    arc(ctx, 0, size * 0.62, size * (0.1 + k * 0.12), 0, Math.PI * 2);
    ctx.restore();
    // Fist / arrow driving down
    glow(ctx, "#E6FBFF", size * 0.08, size * 0.08);
    poly(ctx, [[0, -size * 0.42], [0, size * 0.08]], false);
    ctx.fillStyle = "#3DE0FF";
    poly(ctx, [[-size * 0.16, -size * 0.02], [0, size * 0.2], [size * 0.16, -size * 0.02]], true, true);
    // Crack lines
    glow(ctx, "#3DE0FF", size * 0.05, size * 0.035);
    poly(ctx, [[-size * 0.06, size * 0.26], [-size * 0.2, size * 0.32], [-size * 0.3, size * 0.28]], false);
    poly(ctx, [[size * 0.06, size * 0.26], [size * 0.22, size * 0.33], [size * 0.32, size * 0.27]], false);
  },
  onCast(w, p) {
    w.addStatus(p, "airborne", C.airTime);
    w.spawnEffect({ kind: "shockwave", owner: p.id, source: "shockwaveSlam", x: p.x, y: p.y, r: C.radius, life: C.airTime + C.comboWindow, n: 0 });
    return true;
  },
  effects: {
    shockwave: {
      update(w, e) {
        if (e.source !== "shockwaveSlam") return;
        if (e.n === 0) {
          const owner = w.players.get(e.owner);
          if (!owner || !owner.alive) {
            e.dead = true;
            return;
          }
          e.x = owner.x;
          e.y = owner.y;
          if (e.age >= C.airTime) slam(w, e);
        } else aftermath(w, e);
      },
    },
  },
  bot: { role: "attack", range: 210 },
});
