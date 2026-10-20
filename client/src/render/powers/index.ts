// Visual registry: effect kind → drawer, projectile source → drawer. Adding a power's
// visuals = one file in this folder + its lines here. Anything unregistered falls back to
// a readable generic glow so nothing is ever invisible.

import type { EffectKind, NetEffect, NetProjectile, SourceId } from "@prism/shared";
import { GHOST } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import { colorHex } from "../palette";
import { drawPortal } from "./portal";
import { drawSingularity, drawSingularityOrb } from "./singularity";
import { drawEchoAura, drawHunterMark, drawOverdriveAura } from "./auras";
import { drawFinalStand } from "./final-stand";
import { drawMeteorWarn } from "./meteor-rain";
import { drawRift } from "./rift-collapse";
import { drawMolten } from "./molten";
import { drawGlaive } from "./glaive";
import { drawFlip, drawGravityOrb } from "./gravity";
import { drawBeacon } from "./bounty";
import { drawDecoy } from "./decoy";
import { drawShockwave } from "./slam";
import { drawVulture } from "./third-party";
import { drawRewindTrail } from "./chrono";
import { drawClone } from "./mirror";
import { drawTether, drawTetherBolt } from "./tether";
import { drawBubble } from "./bubble";
import { drawPrismAura } from "./prism";
import { drawPhantomDash, drawSigil } from "./phantom";
import { drawHexFlash } from "./hex";
import { drawMagnet } from "./magnet";
import { drawVoidBurst } from "./cloak";
import { drawBeam, drawMine, drawSlash, drawSmoke, drawSupply } from "../combat-fx";
import type { EffectDrawer, ProjectileDrawer, RenderCtx } from "./types";

export const EFFECT_DRAWERS: Partial<Record<EffectKind, EffectDrawer>> = {
  portal: drawPortal,
  singularity: drawSingularity,
  lava: drawLava,
  slowField: drawSlowField,
  flash: () => {},
  meteorWarn: drawMeteorWarn,
  rift: drawRift,
  finalStand: drawFinalStand,
  overdriveAura: drawOverdriveAura,
  echoAura: drawEchoAura,
  hunterMark: drawHunterMark,
  molten: drawMolten,
  glaive: drawGlaive,
  flip: drawFlip,
  beacon: drawBeacon,
  decoy: drawDecoy,
  shockwave: drawShockwave,
  vulture: drawVulture,
  rewindTrail: drawRewindTrail,
  clone: drawClone,
  tether: drawTether,
  bubble: drawBubble,
  prismAura: drawPrismAura,
  phantomDash: drawPhantomDash,
  sigil: drawSigil,
  hexFlash: drawHexFlash,
  magnet: drawMagnet,
  voidBurst: drawVoidBurst,
  smoke: drawSmoke,
  mine: drawMine,
  beam: drawBeam,
  slash: drawSlash,
  supplyDrop: drawSupply,
};

export const PROJECTILE_DRAWERS: Partial<Record<SourceId, ProjectileDrawer>> = {
  singularity: drawSingularityOrb,
  gravityFlip: drawGravityOrb,
  stormTether: drawTetherBolt,
};

/** Effects drawn under players (floor hazards) vs over them. */
export const FLOOR_EFFECTS: ReadonlySet<EffectKind> = new Set<EffectKind>(["lava", "slowField", "molten", "meteorWarn", "bubble", "rift", "rewindTrail", "mine"]);

/** Effects drawn over everything else (smoke hides what's inside it, supply drops fall from the sky). */
export const TOP_EFFECTS: ReadonlySet<EffectKind> = new Set<EffectKind>(["smoke", "supplyDrop"]);

export function drawEffect(rc: RenderCtx, e: NetEffect) {
  const d = EFFECT_DRAWERS[e.kind];
  if (d) d(rc, e);
  else genericEffect(rc, e);
}

export function drawProjectileCustom(rc: RenderCtx, p: NetProjectile): boolean {
  const d = PROJECTILE_DRAWERS[p.source];
  if (!d) return false;
  d(rc, p);
  return true;
}

function genericEffect(rc: RenderCtx, e: NetEffect) {
  const col = rc.color(e.owner);
  drawGlow(rc.ctx, e.x, e.y, Math.max(20, e.r * 1.6), col, 0.6);
  rc.ctx.strokeStyle = withAlpha(col, 0.8);
  rc.ctx.lineWidth = 2;
  rc.ctx.beginPath();
  rc.ctx.arc(e.x, e.y, Math.max(8, e.r), 0, Math.PI * 2);
  rc.ctx.stroke();
}

/** Ghost haunt label: who dropped it, in their color. */
function hauntTag(rc: RenderCtx, e: NetEffect) {
  if (e.source !== "haunt") return;
  const { ctx, invScale } = rc;
  const col = colorHex(Math.round(e.v));
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `700 ${13 * invScale}px Rajdhani, system-ui, sans-serif`;
  ctx.lineWidth = 3 * invScale;
  ctx.strokeStyle = "rgba(5,4,13,0.9)";
  const label = `👻 ${rc.playerName(e.owner)}`;
  ctx.strokeText(label, e.x, e.y - e.r - 8 * invScale);
  ctx.fillStyle = col;
  ctx.fillText(label, e.x, e.y - e.r - 8 * invScale);
  ctx.restore();
}

export function drawLava(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const t = Math.min(1, e.age / 0.2) * Math.min(1, (e.life - e.age) / 0.4);
  const r = e.r * t;
  const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
  g.addColorStop(0, "rgba(255,240,180,0.85)");
  g.addColorStop(0.35, "rgba(255,120,30,0.75)");
  g.addColorStop(0.8, "rgba(200,30,10,0.45)");
  g.addColorStop(1, "rgba(120,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const w = 1 + Math.sin(a * 3 + time * 3 + e.id) * 0.07;
    const x = e.x + Math.cos(a) * r * w;
    const y = e.y + Math.sin(a) * r * w;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.fill();
  if (e.source === "haunt") {
    ctx.strokeStyle = withAlpha(colorHex(Math.round(e.v)), 0.9);
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (Math.random() < 0.3) rc.fx.particles.spawn(e.x + (Math.random() - 0.5) * r, e.y + (Math.random() - 0.5) * r, 0, -40, 0.6, 5, "#ff9a3c");
  hauntTag(rc, e);
}

export function drawSlowField(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const t = Math.min(1, e.age / 0.2) * Math.min(1, (e.life - e.age) / 0.4);
  const r = e.r * t;
  ctx.save();
  ctx.fillStyle = "rgba(90,170,255,0.14)";
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = e.source === "haunt" ? withAlpha(colorHex(Math.round(e.v)), 0.9) : "rgba(140,210,255,0.8)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = time * 20;
  ctx.stroke();
  ctx.setLineDash([]);
  // Snowflake-ish ticks
  ctx.strokeStyle = "rgba(200,235,255,0.5)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + time * 0.3;
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(a) * r * 0.2, e.y + Math.sin(a) * r * 0.2);
    ctx.lineTo(e.x + Math.cos(a) * r * 0.6, e.y + Math.sin(a) * r * 0.6);
    ctx.stroke();
  }
  ctx.restore();
  hauntTag(rc, e);
}

export const GHOST_RADII = { lava: GHOST.lava.radius, slow: GHOST.slow.radius };
