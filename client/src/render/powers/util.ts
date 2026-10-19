// Helpers shared by power visuals: one-shot bursts keyed to effect state, owner-relative
// visibility (cloak), and lightning polylines.

import { hasStatusBit } from "@prism/shared";
import type { RenderCtx } from "./types";

const seen = new Map<string, { v: number; at: number }>();

/**
 * True the first frame a client sees `tag:id` (or when `value` changes). Visuals are pure
 * functions of networked state, so this is how a drawer fires a burst "on spawn".
 * Ignores effects first seen when already old (scrolled into view, late join).
 */
export function changed(rc: RenderCtx, tag: string, id: number, value: number, age = 0, maxAge = 0.35): boolean {
  const key = `${tag}:${id}`;
  const prev = seen.get(key);
  seen.set(key, { v: value, at: rc.time });
  if (seen.size > 600) {
    for (const [k, s] of seen) if (rc.time - s.at > 8) seen.delete(k);
  }
  if (!prev) return age <= maxAge;
  return prev.v !== value;
}

/** Where to draw something attached to a player (predicted for the local player). */
export function anchor(rc: RenderCtx, id: number): { x: number; y: number } | undefined {
  return rc.pos?.(id) ?? rc.player(id);
}

/** How visible a player's attachments are: cloaked enemies fade to a shimmer like their core. */
export function ownerAlpha(rc: RenderCtx, id: number): number {
  const p = rc.player(id);
  if (!p || !hasStatusBit(p.status, "cloaked")) return 1;
  if (id === rc.myId) return 0.45;
  return rc.seeCloaked ? 0.6 : 0.07;
}

/** A jagged lightning polyline from A to B (new shape each call). */
export function bolt(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, jag: number, step = 26) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.round(len / step));
  const nx = -dy / (len || 1);
  const ny = dx / (len || 1);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const off = (Math.random() - 0.5) * 2 * jag * Math.sin(t * Math.PI);
    ctx.lineTo(ax + dx * t + nx * off, ay + dy * t + ny * off);
  }
  ctx.lineTo(bx, by);
}

/** Eases 0→1 over `dur` seconds from the effect's birth, and 1→0 over its last `out` seconds. */
export function lifeFade(age: number, life: number, inDur = 0.15, out = 0.35): number {
  return Math.min(1, age / inDur) * Math.max(0, Math.min(1, (life - age) / out));
}
