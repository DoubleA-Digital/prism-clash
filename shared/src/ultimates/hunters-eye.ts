// HUNTER'S EYE: for 8s you see every enemy (minimap, nebulas, Void Cloak) and your shots
// curve toward the nearest one. The `hunter` status drives the gameplay (world.hiddenFrom,
// fireShot's homing flag, steerHoming). One hunterMark effect per enemy carries the
// caster→target link so the caster's client can draw a reticle on each; the effect itself
// sits on the caster so it never leaks a hidden target's position to anyone else.

import { ULTIMATES } from "../config";
import { defineUlt } from "../sim/hooks";
import { circle, glow } from "../powers/icon";
import { followOwner } from "./follow";
import { ultFrame } from "./ult-icon";

const C = ULTIMATES.huntersEye;

export const huntersEye = defineUlt({
  id: "huntersEye",
  name: "Hunter's Eye",
  description: "For 8s see every enemy on the minimap and through Void Cloak and nebulas, and your shots home toward the nearest enemy.",
  color: "#FF3B4E",
  drawIcon(ctx, size) {
    ultFrame(ctx, size, "#4a0710");
    const s = size;
    // Eye outline
    glow(ctx, "#FF3B4E", s * 0.12, s * 0.04);
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, 0);
    ctx.quadraticCurveTo(0, -s * 0.26, s * 0.3, 0);
    ctx.quadraticCurveTo(0, s * 0.26, -s * 0.3, 0);
    ctx.closePath();
    ctx.stroke();
    // Reticle iris
    glow(ctx, "#FFD34D", s * 0.06, s * 0.025);
    circle(ctx, 0, 0, s * 0.1);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.13, Math.sin(a) * s * 0.13);
      ctx.lineTo(Math.cos(a) * s * 0.2, Math.sin(a) * s * 0.2);
      ctx.stroke();
    }
    glow(ctx, "#ffffff", s * 0.06, 1);
    circle(ctx, 0, 0, s * 0.035, true);
  },
  onCast(w, p) {
    w.addStatus(p, "hunter", C.duration);
    for (const o of w.enemiesOf(p)) {
      w.spawnEffect({ kind: "hunterMark", owner: p.id, source: "huntersEye", x: p.x, y: p.y, r: o.r, life: C.duration, link: o.id });
    }
    return true;
  },
  effects: {
    hunterMark: {
      update(w, e) {
        if (!followOwner(w, e)) return;
        const target = w.players.get(e.link);
        if (!target || !target.alive) e.dead = true;
      },
    },
  },
  bot: { minTargets: 1 },
});
