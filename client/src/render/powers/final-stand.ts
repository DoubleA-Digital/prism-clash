// Final Stand visuals. A gold sphere around the caster fills like a vessel with every point
// of damage it absorbs (with the shockwave's projected damage shown above it), while a dashed
// ring marks the blast radius and a sweep around it counts down the charge. Gold motes
// spiral in; the last moments go white-hot. The release is the shared "explode" event.

import type { NetEffect } from "@prism/shared";
import { ULTIMATES } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { envelope, neonStroke, once, perFrame } from "./ult-fx";

const C = ULTIMATES.finalStand;
const GOLD = "#FFD34D";
const DEEP = "#FF9F1C";
/** Absorbed damage at which the shockwave hits its cap: the sphere is full there. */
const FULL = (C.maxDamage - C.baseDamage) / C.absorbMult;
const SPHERE = 60;
/** Seconds before expiry that the client fires its release flash (the server blast is one tick later). */
const RELEASE_LEAD = 0.07;

export function drawFinalStand(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const pl = rc.pos?.(e.owner) ?? rc.player(e.owner);
  const x = pl?.x ?? e.x;
  const y = pl?.y ?? e.y;
  const p = Math.min(1, e.age / Math.max(0.01, e.life));
  const fill = Math.min(1, e.v / FULL);
  const a = envelope(e, 0.15, 0);
  const left = e.life - e.age;
  const hot = p > 0.82 ? (p - 0.82) / 0.18 : 0;
  const flick = 0.5 + 0.5 * Math.sin(time * (8 + 30 * hot));

  ctx.save();
  // Blast radius: dashed ring + countdown sweep.
  ctx.setLineDash([14, 12]);
  ctx.lineDashOffset = time * 40;
  ctx.beginPath();
  ctx.arc(x, y, e.r, 0, Math.PI * 2);
  neonStroke(ctx, GOLD, 3.5, (0.55 + 0.35 * hot * flick) * a, "#FFF3C4");
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, e.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  neonStroke(ctx, GOLD, 5, 0.85 * a, "#ffffff");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = withAlpha(GOLD, (0.04 + 0.08 * hot * flick) * a);
  ctx.beginPath();
  ctx.arc(x, y, e.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // The vessel: a dark glass sphere filling with molten gold from the bottom.
  const r = SPHERE * (1 + 0.06 * Math.sin(time * 6) + 0.12 * hot);
  drawGlow(ctx, x, y, r * (2.4 + fill * 1.6 + hot * 1.5), GOLD, (0.45 + 0.4 * fill) * a);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha("#5a3d00", 0.45 * a);
  ctx.fill();
  ctx.clip();
  const level = y + r - 2 * r * fill;
  const liquid = ctx.createLinearGradient(0, level, 0, y + r);
  liquid.addColorStop(0, withAlpha("#FFF3C4", 0.95));
  liquid.addColorStop(0.3, withAlpha(GOLD, 0.85));
  liquid.addColorStop(1, withAlpha(DEEP, 0.85));
  ctx.fillStyle = liquid;
  ctx.beginPath();
  ctx.moveTo(x - r, y + r);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    ctx.lineTo(x - r + 2 * r * t, level + Math.sin(t * Math.PI * 3 + time * 7) * 3 * (fill > 0.02 ? 1 : 0));
  }
  ctx.lineTo(x + r, y + r);
  ctx.closePath();
  ctx.fill();
  if (hot > 0) {
    ctx.fillStyle = withAlpha("#ffffff", 0.6 * hot * flick);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  // Rim and spinning gold bands.
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  neonStroke(ctx, GOLD, 5, a, "#ffffff");
  ctx.save();
  ctx.translate(x, y);
  for (let k = 0; k < 2; k++) {
    ctx.rotate(time * (k ? -1.6 : 2.1));
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.25, r * 0.38, 0, 0, Math.PI * 2);
    neonStroke(ctx, k ? DEEP : GOLD, 1.8, 0.7 * a, "#FFF3C4");
  }
  ctx.restore();

  // Projected shockwave damage.
  const dmg = Math.round(Math.min(C.maxDamage, C.baseDamage + C.absorbMult * e.v));
  ctx.textAlign = "center";
  ctx.font = `800 ${Math.round(18 + 10 * fill)}px Rajdhani, system-ui, sans-serif`;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(5,4,13,0.85)";
  const ty = y - r - 34;
  ctx.strokeText(String(dmg), x, ty);
  ctx.fillStyle = fill >= 1 ? "#ffffff" : GOLD;
  ctx.fillText(String(dmg), x, ty);
  ctx.restore();

  // The release: a gold flash ring ahead of the shockwave event, once.
  if (left <= RELEASE_LEAD && once(e, "release")) {
    rc.fx.ring(x, y, SPHERE, e.r * 1.15, 0.55, GOLD, 16);
    rc.fx.ring(x, y, SPHERE * 0.5, e.r * 0.8, 0.4, "#ffffff", 8);
    rc.fx.particles.burst(x, y, 90, GOLD, e.r * 2.6, 0.8, 11);
    const me = rc.pos?.(rc.myId) ?? rc.player(rc.myId);
    const d = me ? Math.hypot(me.x - x, me.y - y) : 9999;
    if (d < e.r * 1.6) rc.fx.screenFlash("#FFE9A8", 0.6 * (1 - d / (e.r * 1.6)) + 0.15);
  }

  // Motes spiralling in: more of them the more it has absorbed.
  for (let i = perFrame(30 + 90 * fill + 120 * hot, rc.dt); i > 0; i--) {
    const ang = Math.random() * Math.PI * 2;
    const d = r * 2 + Math.random() * 160;
    const sp = 240 + 200 * hot;
    rc.fx.particles.spawn(x + Math.cos(ang) * d, y + Math.sin(ang) * d, -Math.cos(ang) * sp - Math.sin(ang) * 120, -Math.sin(ang) * sp + Math.cos(ang) * 120, d / sp * 0.9, 4 + Math.random() * 4, Math.random() < 0.7 ? GOLD : "#ffffff", 0, 0.4);
  }
}
