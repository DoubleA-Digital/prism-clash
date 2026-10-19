// ECHO STORM: for 8s every power you cast happens twice. The world (handleCasts) spots the
// `echo` status after a successful cast or recast and schedules a short "flash" effect
// (v = ECHO_CAST or ECHO_RECAST, n = power index); when it expires the power fires again
// from where you are, at your current aim. Echoes never echo themselves: the replay calls
// the power directly and never goes through handleCasts.

import { ULTIMATES } from "../config";
import { defineUlt, powerDef } from "../sim/hooks";
import { POWER_IDS } from "../sim/types";
import { circle, glow, ngon, poly } from "../powers/icon";
import { followOwner } from "./follow";
import { ultFrame } from "./ult-icon";

const C = ULTIMATES.echoStorm;
export const ECHO_CAST = -1;
export const ECHO_RECAST = -2;

export const echoStorm = defineUlt({
  id: "echoStorm",
  name: "Echo Storm",
  description: "For 8s every power you cast is cast twice: a second copy fires a moment later, recasts included.",
  color: "#5CF2FF",
  drawIcon(ctx, size) {
    ultFrame(ctx, size, "#06363d");
    // Two offset diamonds: the power and its echo.
    const d = ngon(4, size * 0.17, 0);
    ctx.save();
    ctx.translate(size * 0.08, -size * 0.06);
    ctx.globalAlpha = 0.5;
    glow(ctx, "#5CF2FF", size * 0.1, size * 0.035);
    poly(ctx, d);
    ctx.restore();
    ctx.save();
    ctx.translate(-size * 0.06, size * 0.05);
    glow(ctx, "#ffffff", size * 0.12, size * 0.045);
    poly(ctx, d);
    ctx.restore();
    // Sound-wave arcs.
    glow(ctx, "#FFD34D", size * 0.05, size * 0.025);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(-size * 0.06, size * 0.05, size * (0.24 + i * 0.07), -Math.PI * 0.95, -Math.PI * 0.55);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 0;
    circle(ctx, -size * 0.06, size * 0.05, size * 0.035, true);
  },
  onCast(w, p) {
    w.addStatus(p, "echo", C.duration);
    w.spawnEffect({ kind: "echoAura", owner: p.id, source: "echoStorm", x: p.x, y: p.y, r: p.r, life: C.duration });
    return true;
  },
  effects: {
    echoAura: {
      update(w, e) {
        followOwner(w, e);
      },
    },
    flash: {
      onExpire(w, e) {
        if (e.v !== ECHO_CAST && e.v !== ECHO_RECAST) return;
        const p = w.players.get(e.owner);
        const id = POWER_IDS[e.n];
        if (!p || !p.alive || !id) return;
        if (e.v === ECHO_CAST) {
          w.echoCast(p, id);
          return;
        }
        const def = powerDef(id);
        if (!def?.onRecast) return;
        def.onRecast(w, p, { id, cd: 0, recast: 1 });
      },
    },
  },
  bot: { minTargets: 1 },
});
