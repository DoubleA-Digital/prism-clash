// Split-second reactions layered on top of whatever the brain decided: sidestep (or dash
// away from) projectiles about to hit, and step out of hazards (lava, black holes, rifts,
// meteor warnings, mines that aren't ours). Skill-gated so easy bots get clipped more.

import type { Player, Projectile, Rng, World } from "@prism/shared";

export interface Threat {
  pr: Projectile;
  t: number;
}

export interface Reflex {
  x: number;
  y: number;
  dash: boolean;
}

/** Enemy projectiles that will pass within reach of us in the next 0.6 s. */
export function incoming(w: World, me: Player): Threat[] {
  const out: Threat[] = [];
  for (const pr of w.projectiles) {
    if (pr.owner === me.id || pr.dead) continue;
    const rx = me.x - pr.x;
    const ry = me.y - pr.y;
    if (rx * rx + ry * ry > 900 * 900) continue;
    const vv = pr.vx * pr.vx + pr.vy * pr.vy || 1;
    const tt = (rx * pr.vx + ry * pr.vy) / vv;
    if (tt < 0 || tt > 0.6) continue;
    const cx = pr.x + pr.vx * tt - me.x;
    const cy = pr.y + pr.vy * tt - me.y;
    if (cx * cx + cy * cy < (me.r + pr.r + 18) ** 2) out.push({ pr, t: tt });
  }
  return out;
}

/** Sidestep the most urgent projectile (perpendicular to its path), maybe with a dash. */
export function dodge(me: Player, threats: Threat[], skill: number, rng: Rng): Reflex {
  let urgent: Threat | null = null;
  for (const t of threats) if (!urgent || t.t < urgent.t) urgent = t;
  if (!urgent || rng.next() >= skill) return { x: 0, y: 0, dash: false };
  const pv = Math.hypot(urgent.pr.vx, urgent.pr.vy) || 1;
  let px = -urgent.pr.vy / pv;
  let py = urgent.pr.vx / pv;
  if (px * (me.x - urgent.pr.x) + py * (me.y - urgent.pr.y) < 0) {
    px = -px;
    py = -py;
  }
  const dash = urgent.t < 0.22 && me.dashCd <= 0 && rng.next() < skill * 0.7;
  return { x: px * 1.6, y: py * 1.6, dash };
}

/** Get out of lava, black holes, rifts, warning circles and enemy mines. */
export function avoidHazards(w: World, me: Player, skill: number, reaction: number): { x: number; y: number } {
  let mx = 0;
  let my = 0;
  for (const e of w.effects.values()) {
    if (e.owner === me.id || e.dead) continue;
    if (e.kind === "rift" || (e.kind === "singularity" && Math.hypot(me.x - e.x, me.y - e.y) < e.r)) {
      if (e.age < reaction + 0.3) continue;
      let hx = e.x;
      let hy = e.y;
      if (e.kind === "rift") {
        const dx = e.x2 - e.x;
        const dy = e.y2 - e.y;
        const l2 = dx * dx + dy * dy || 1;
        const k = Math.max(0, Math.min(1, ((me.x - e.x) * dx + (me.y - e.y) * dy) / l2));
        hx = e.x + dx * k;
        hy = e.y + dy * k;
        if (Math.hypot(me.x - hx, me.y - hy) > 320) continue;
      }
      const d = Math.hypot(me.x - hx, me.y - hy) || 1;
      mx += ((me.x - hx) / d) * 2.2 * skill;
      my += ((me.y - hy) / d) * 2.2 * skill;
      continue;
    }
    const ground = e.kind === "lava" || e.kind === "molten" || e.kind === "slowField" || e.kind === "meteorWarn" || e.kind === "bubble" || e.kind === "mine";
    if (ground || (e.kind === "shockwave" && e.n === 0)) {
      const dx = me.x - e.x;
      const dy = me.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < e.r + 40) {
        mx += (dx / (d || 1)) * 1.5;
        my += (dy / (d || 1)) * 1.5;
      }
    }
  }
  return { x: mx, y: my };
}
