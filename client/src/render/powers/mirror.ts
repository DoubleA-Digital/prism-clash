// Mirror Self visuals: the clone is drawn exactly like a real player (the same hero body with
// the owner's gun in hand, name, health bar from the owner's HP) so enemies can't tell them
// apart, and like a real player it's hidden when it's out of your line of sight. Only the
// owner sees a faint mirror ring marking which one is the copy.

import { PFLAG, PLAYER, type NetEffect } from "@prism/shared";
import { PSHAPE } from "../../fx/particles";
import { withAlpha } from "../glow";
import { drawLookalike } from "./lookalike";
import type { RenderCtx } from "./types";
import { anchor, changed, ownerAlpha } from "./util";

const SILVER = "#D7E1FF";

/** Motion trails per clone, the same shape the renderer gives real players. */
const trails = new Map<number, { pts: number[]; at: number }>();

function trailOf(id: number, x: number, y: number, max: number, now: number): number[] {
  let t = trails.get(id);
  if (!t) {
    t = { pts: [], at: now };
    trails.set(id, t);
    for (const [k, o] of trails) if (now - o.at > 5) trails.delete(k);
  }
  t.at = now;
  const p = t.pts;
  const lx = p[p.length - 2];
  const ly = p[p.length - 1];
  if (lx === undefined || ly === undefined || Math.hypot(x - lx, y - ly) > 3) {
    p.push(x, y);
    while (p.length > max * 2) p.splice(0, 2);
  }
  return p;
}

function drawTrail(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string, width: number, alpha: number) {
  const n = pts.length / 2;
  if (n < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 1; i < n; i++) {
    const t = i / (n - 1);
    ctx.strokeStyle = withAlpha(color, alpha * t * t);
    ctx.lineWidth = width * (0.25 + 0.75 * t);
    ctx.beginPath();
    ctx.moveTo(pts[(i - 1) * 2] ?? 0, pts[(i - 1) * 2 + 1] ?? 0);
    ctx.lineTo(pts[i * 2] ?? 0, pts[i * 2 + 1] ?? 0);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawClone(rc: RenderCtx, e: NetEffect) {
  const { ctx, time } = rc;
  const owner = rc.player(e.owner);
  const col = rc.color(e.owner);
  const mine = e.owner === rc.myId;
  // Same sight rule as real fighters: a clone behind a wall stays hidden (your own is always shown).
  if (!mine && rc.canSee && !rc.canSee(e.x, e.y)) return;
  const dashing = owner ? (owner.flags & PFLAG.dashing) !== 0 : false;
  const alpha = ownerAlpha(rc, e.owner) * (mine ? 0.7 : 1);

  if (changed(rc, "cloneBorn", e.id, 0, e.age)) {
    rc.fx.particles.burst(e.x, e.y, 18, SILVER, 300, 0.45, 7, PSHAPE.shard);
    rc.fx.ring(e.x, e.y, 10, 70, 0.3, SILVER, 3);
  }
  if (e.n > 0 && changed(rc, "cloneSwap", e.id, e.n)) {
    const me = anchor(rc, e.owner);
    for (const pt of me ? [e, me] : [e]) {
      rc.fx.particles.burst(pt.x, pt.y, 16, SILVER, 340, 0.4, 7, PSHAPE.shard);
      rc.fx.ring(pt.x, pt.y, 60, 8, 0.28, SILVER, 4);
    }
  }

  const pts = trailOf(e.id, e.x, e.y, dashing ? 14 : 10, time);
  drawTrail(ctx, pts, col, dashing ? 30 : 18, (dashing ? 0.7 : 0.35) * alpha);
  if (dashing && Math.random() < 0.8) rc.fx.particles.spawn(e.x, e.y, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.35, 10, col);
  if (alpha < 0.1 && Math.random() < 0.15) rc.fx.particles.spawn(e.x + (Math.random() - 0.5) * 30, e.y + (Math.random() - 0.5) * 30, 0, -20, 0.5, 4, "#ffffff");

  drawLookalike(rc, e.owner, { x: e.x, y: e.y, aim: e.angle, alpha, speed: Math.hypot(e.vx, e.vy), showBar: true });

  if (mine) {
    // Only you see which one is the reflection, and how long it has left.
    const left = Math.max(0, 1 - e.age / e.life);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = withAlpha(SILVER, 0.7);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath();
    ctx.arc(e.x, e.y, PLAYER.radius * 1.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, PLAYER.radius * 2.15, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
