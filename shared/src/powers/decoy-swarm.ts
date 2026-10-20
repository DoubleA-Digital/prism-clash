// DECOY SWARM: five small holographic copies of you burst outward, then wander. Each one
// soaks up a single hit (the world routes projectiles into decoys) and pops into blinding
// sparks: enemies close to the pop are blinded. The pop rides on a "shockwave" effect with
// source "decoySwarm" (r = flash radius, life = blind time) so every client sees the flash.
// Decoys walk into walls and cover like players do (sliding, wandering off), never through
// them, and a pop only blinds enemies who can actually see it (no flash through walls or smoke).

import { POWERS } from "../config";
import { definePower } from "../sim/hooks";
import type { Effect } from "../sim/types";
import type { World } from "../sim/world";
import { inSight, moveBody } from "./geometry";
import { circle, glow } from "./icon";

const C = POWERS.decoySwarm;

/** Pops a decoy: blinding flash for every enemy of its owner within flashRadius. */
export function popDecoy(w: World, d: Effect) {
  if (d.dead) return;
  d.dead = true;
  w.spawnEffect({ kind: "shockwave", owner: d.owner, source: "decoySwarm", x: d.x, y: d.y, r: C.flashRadius, life: C.flashBlind });
  for (const p of w.playersNear(d.x, d.y, C.flashRadius, d.owner)) {
    if (inSight(w, d.x, d.y, p.x, p.y)) w.addStatus(p, "blinded", C.flashBlind);
  }
  w.emit({ t: "impact", x: d.x, y: d.y, color: w.colorOf(d.owner), size: 2 });
}

function wander(w: World, e: Effect, dt: number) {
  e.angle += (w.rng.next() - 0.5) * 2 * C.wanderTurn * dt;
  const k = 1 - Math.exp(-C.drag * dt);
  e.vx += (Math.cos(e.angle) * C.wanderSpeed - e.vx) * k;
  e.vy += (Math.sin(e.angle) * C.wanderSpeed - e.vy) * k;
  // Bump off walls and cover, wandering away from them: the new heading is the way the wall
  // pushed it, plus a little randomness.
  const body = { x: e.x, y: e.y, vx: e.vx, vy: e.vy };
  const wantX = e.x + e.vx * dt;
  const wantY = e.y + e.vy * dt;
  if (moveBody(w, body, e.vx * dt, e.vy * dt, e.r)) {
    const px = body.x - wantX;
    const py = body.y - wantY;
    if (px * px + py * py > 1e-6) e.angle = Math.atan2(py, px) + (w.rng.next() - 0.5) * 1.2;
    e.vx = body.vx;
    e.vy = body.vy;
  }
  e.x = body.x;
  e.y = body.y;
}

export const decoySwarm = definePower({
  id: "decoySwarm",
  name: "Decoy Swarm",
  description: "Release 5 holographic copies of yourself that scatter, soak one hit each and pop into blinding sparks.",
  color: "#8FE9FF",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    const pts: [number, number, number][] = [[0, 0, 0.2], [-0.3, -0.22, 0.12], [0.3, -0.22, 0.12], [-0.3, 0.24, 0.12], [0.3, 0.24, 0.12]];
    pts.forEach(([x, y, r], i) => {
      const flick = i === 0 ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(t * 5 + i * 1.7));
      glow(ctx, i === 0 ? "#ffffff" : "#8FE9FF", size * 0.1, size * 0.045);
      ctx.globalAlpha = flick;
      circle(ctx, x * size, y * size, r * size);
      ctx.fillStyle = i === 0 ? "#8FE9FF" : "rgba(143,233,255,0.35)";
      circle(ctx, x * size, y * size, r * size * 0.45, true);
      if (i) {
        // Hologram scanlines
        ctx.lineWidth = size * 0.012;
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.moveTo((x - r * 0.8) * size, (y + k * r * 0.4) * size);
          ctx.lineTo((x + r * 0.8) * size, (y + k * r * 0.4) * size);
          ctx.stroke();
        }
      }
    });
    ctx.globalAlpha = 1;
  },
  onCast(w, p) {
    for (let i = 0; i < C.count; i++) {
      const a = p.aim + (i / C.count) * Math.PI * 2 + (w.rng.next() - 0.5) * 0.5;
      const sp = C.speed * (0.85 + w.rng.next() * 0.3);
      const start = { x: p.x, y: p.y, vx: 0, vy: 0 };
      moveBody(w, start, Math.cos(a) * p.r * 0.5, Math.sin(a) * p.r * 0.5, C.radius);
      w.spawnEffect({
        kind: "decoy", owner: p.id, source: "decoySwarm", x: start.x, y: start.y,
        r: C.radius, life: C.life * (0.9 + w.rng.next() * 0.2), angle: a, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      });
    }
    return true;
  },
  effects: {
    decoy: {
      update(w, e, dt) {
        if (e.source !== "decoySwarm") return;
        const owner = w.players.get(e.owner);
        if (!owner || !owner.alive) {
          e.dead = true;
          return;
        }
        wander(w, e, dt);
      },
      onProjectileHit(w, e) {
        if (e.source === "decoySwarm") popDecoy(w, e);
      },
    },
  },
  bot: { role: "defend", hpBelow: 60 },
});
