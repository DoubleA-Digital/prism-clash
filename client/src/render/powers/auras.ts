// Ultimate auras that ride on their caster: Overdrive's crackling white-hot field, Echo
// Storm's trailing double image, and Hunter's Eye's red reticles (seen only by the hunter).

import type { NetEffect } from "@prism/shared";
import { PFLAG, PLAYER, ULTIMATES } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import type { RenderCtx } from "./types";
import { envelope, neonStroke, perFrame } from "./ult-fx";

// ---- Overdrive -------------------------------------------------------------------------------

export function drawOverdriveAura(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const pl = rc.player(e.owner);
  if (!pl) return;
  // Predicted position for the local player, so the aura never trails behind your core.
  const at = rc.pos?.(e.owner) ?? pl;
  const left = e.life - e.age;
  // Flickers out over the last second so everyone can see it's ending.
  const a = envelope(e, 0.12, 0) * (left < 1 ? 0.45 + 0.55 * Math.abs(Math.sin(time * 18)) : 1);
  const r = PLAYER.radius;
  const throb = 1 + 0.08 * Math.sin(time * 22);
  drawGlow(ctx, at.x, at.y, r * 5 * throb, "#7CF6FF", 0.55 * a);
  drawGlow(ctx, at.x, at.y, r * 2.6 * throb, "#ffffff", 0.75 * a, 0.35);
  ctx.save();
  // Three counter-rotating broken rings: white, cyan, gold.
  const rings: [string, number, number][] = [["#ffffff", 14, 7], ["#7CF6FF", 26, -5], [OD_GOLD, 38, 3.5]];
  for (const [col, off, spin] of rings) {
    const rot = time * spin;
    for (let s = 0; s < 3; s++) {
      const a0 = rot + (s * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r + off, a0, a0 + 1.25);
      neonStroke(ctx, col, 2.6, 0.85 * a, "#ffffff");
    }
  }
  // Arcs that jump out to the floor.
  for (let k = 0; k < 2; k++) {
    if (Math.random() > 0.7) continue;
    let ang = Math.random() * Math.PI * 2;
    let d = r + 8;
    ctx.beginPath();
    ctx.moveTo(at.x + Math.cos(ang) * d, at.y + Math.sin(ang) * d);
    for (let s = 0; s < 5; s++) {
      ang += (Math.random() - 0.5) * 0.6;
      d += 10 + Math.random() * 16;
      ctx.lineTo(at.x + Math.cos(ang) * d, at.y + Math.sin(ang) * d);
    }
    neonStroke(ctx, "#9fe8ff", 2, a, "#ffffff");
  }
  ctx.restore();
  for (let i = perFrame(90, rc.dt); i > 0; i--) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 200 + Math.random() * 260;
    rc.fx.particles.spawn(at.x + Math.cos(ang) * r, at.y + Math.sin(ang) * r, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.3, 5, Math.random() < 0.6 ? "#ffffff" : "#7CF6FF", 1, 4);
  }
}

// ---- Echo Storm ------------------------------------------------------------------------------

interface Trail {
  seen: number;
  pts: { t: number; x: number; y: number }[];
}
const trails = new Map<number, Trail>();
const ECHO_CYAN = "#5CF2FF";
const ECHO_PINK = "#FF7BF2";
const OD_GOLD = "#FFD34D";

function pastPos(tr: Trail, t: number): { x: number; y: number } | null {
  let best: { t: number; x: number; y: number } | null = null;
  for (const p of tr.pts) {
    if (p.t <= t) best = p;
    else break;
  }
  return best ?? tr.pts[0] ?? null;
}

export function drawEchoAura(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const pl = rc.player(e.owner);
  if (!pl) return;
  // Predicted position for the local player, so the aura never trails behind your core.
  const at = rc.pos?.(e.owner) ?? pl;
  let tr = trails.get(e.id);
  if (!tr) {
    tr = { seen: time, pts: [] };
    trails.set(e.id, tr);
    for (const [id, old] of trails) if (time - old.seen > 2) trails.delete(id);
  }
  tr.seen = time;
  tr.pts.push({ t: time, x: at.x, y: at.y });
  const delay = ULTIMATES.echoStorm.echoDelay;
  while (tr.pts.length > 2 && (tr.pts[0]?.t ?? time) < time - delay * 3) tr.pts.shift();
  const left = e.life - e.age;
  const a = envelope(e, 0.2, 0) * (left < 1 ? 0.45 + 0.55 * Math.abs(Math.sin(time * 14)) : 1);
  const r = PLAYER.radius;
  ctx.save();
  // Echo images: where you were one and two echo-delays ago, split cyan/pink like a glitch.
  for (let k = 2; k >= 1; k--) {
    const p = pastPos(tr, time - delay * k);
    if (!p) continue;
    const ga = (k === 1 ? 0.75 : 0.4) * a;
    // Ghosts drift around you even when you stand still, so the double image always reads.
    const orb = time * 2.4 + k * Math.PI;
    const gx = p.x + Math.cos(orb) * 12 * k;
    const gy = p.y + Math.sin(orb) * 12 * k;
    const jx = Math.sin(time * 23 + k) * 3;
    ctx.fillStyle = withAlpha(ECHO_CYAN, 0.12 * ga);
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
    for (const [col, off] of [[ECHO_CYAN, -5], [ECHO_PINK, 5]] as const) {
      ctx.beginPath();
      ctx.arc(gx + off + jx, gy, r, 0, Math.PI * 2);
      neonStroke(ctx, col, 3, ga, "#ffffff");
    }
    drawGlow(ctx, gx, gy, r * 2.2, ECHO_CYAN, ga * 0.7);
  }
  // Sound waves rolling off the caster.
  for (let i = 0; i < 3; i++) {
    const ph = (time * 1.1 + i / 3) % 1;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r + 8 + ph * 110, 0, Math.PI * 2);
    neonStroke(ctx, i % 2 ? ECHO_PINK : ECHO_CYAN, 2.5, (1 - ph) * 0.7 * a, "#ffffff");
  }
  ctx.restore();
}

// ---- Hunter's Eye ----------------------------------------------------------------------------

const HUNT = "#FF3B4E";

export function drawHunterMark(rc: RenderCtx, e: NetEffect) {
  if (e.owner !== rc.myId) return;
  const target = rc.player(e.link);
  const me = rc.player(e.owner);
  if (!target || !me || !(target.flags & PFLAG.alive) || !(me.flags & PFLAG.alive)) return;
  const { ctx, time } = rc;
  const mePos = rc.pos?.(e.owner) ?? me;
  const lock = Math.min(1, e.age / 0.35);
  const ease = 1 - (1 - lock) ** 3;
  const left = e.life - e.age;
  const a = left < 1 ? 0.4 + 0.6 * Math.abs(Math.sin(time * 12)) : 1;
  const inRange = Math.hypot(target.x - mePos.x, target.y - mePos.y) < ULTIMATES.huntersEye.homingRange;
  const r = PLAYER.radius + 20 + (1 - ease) * 140;
  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(time * 1.4 + (1 - ease) * 2);
  // Four corner brackets closing in.
  const b = r * 0.45;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(r - b, -r);
    ctx.lineTo(r, -r);
    ctx.lineTo(r, -r + b);
    neonStroke(ctx, HUNT, inRange ? 4.5 : 3, (inRange ? 1 : 0.7) * a * ease, "#ffd0d4");
  }
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
  neonStroke(ctx, HUNT, 1.6, 0.6 * a * ease, "#ffd0d4");
  ctx.setLineDash([]);
  ctx.restore();
  ctx.save();
  // Crosshair ticks and center pip (not rotating, easier to read).
  ctx.beginPath();
  const rr = PLAYER.radius + 4;
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    ctx.moveTo(target.x + Math.cos(ang) * rr, target.y + Math.sin(ang) * rr);
    ctx.lineTo(target.x + Math.cos(ang) * (rr + 12), target.y + Math.sin(ang) * (rr + 12));
  }
  neonStroke(ctx, HUNT, 2, 0.8 * a * ease, "#ffffff");
  drawGlow(ctx, target.x, target.y, 70 + 10 * Math.sin(time * 9), HUNT, (inRange ? 0.5 : 0.25) * a);
  // Distance tag.
  ctx.textAlign = "center";
  ctx.font = `700 ${13 * rc.invScale}px Rajdhani, system-ui, sans-serif`;
  ctx.lineWidth = 3 * rc.invScale;
  ctx.strokeStyle = "rgba(5,4,13,0.9)";
  const label = `${Math.round(Math.hypot(target.x - mePos.x, target.y - mePos.y) / 10)}m`;
  const ly = target.y + r + 18 * rc.invScale;
  ctx.globalAlpha = ease * a;
  ctx.strokeText(label, target.x, ly);
  ctx.fillStyle = withAlpha(HUNT, 1);
  ctx.fillText(label, target.x, ly);
  ctx.restore();
}
