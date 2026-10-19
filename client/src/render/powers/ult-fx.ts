// Small helpers shared by the ultimate visuals: fades, one-shot triggers, glowing strokes.

import type { NetEffect } from "@prism/shared";
import { withAlpha } from "../glow";

/** 0→1 over `fadeIn` seconds after spawn, 1→0 over the last `fadeOut` seconds. */
export function envelope(e: NetEffect, fadeIn: number, fadeOut: number): number {
  const a = fadeIn > 0 ? Math.min(1, e.age / fadeIn) : 1;
  const b = fadeOut > 0 ? Math.min(1, Math.max(0, (e.life - e.age) / fadeOut)) : 1;
  return Math.max(0, Math.min(a, b));
}

const fired = new Set<string>();
/** True exactly once per (effect, tag): for flashes that must not repeat every frame. */
export function once(e: NetEffect, tag: string): boolean {
  const key = `${e.id}|${tag}`;
  if (fired.has(key)) return false;
  fired.add(key);
  if (fired.size > 400) {
    const first = fired.values().next().value;
    if (first !== undefined) fired.delete(first);
  }
  return true;
}

/** Strokes the current path several times, wide and faint to thin and bright: a cheap neon glow. */
export function neonStroke(ctx: CanvasRenderingContext2D, color: string, width: number, alpha: number, core = "#ffffff") {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const layers: [number, number][] = [[4, 0.12], [2.2, 0.25], [1, 0.8]];
  for (const [wm, am] of layers) {
    ctx.strokeStyle = withAlpha(color, Math.min(1, alpha * am));
    ctx.lineWidth = width * wm;
    ctx.stroke();
  }
  ctx.strokeStyle = withAlpha(core, Math.min(1, alpha * 0.9));
  ctx.lineWidth = Math.max(1, width * 0.35);
  ctx.stroke();
  ctx.globalCompositeOperation = prev;
}

/** Deterministic pseudo-noise in [-1, 1] (stable per seed, animates with t). */
export function wobble(seed: number, t: number): number {
  return Math.sin(seed * 12.9898 + t * 7.3) * 0.6 + Math.sin(seed * 4.1414 - t * 13.7) * 0.4;
}

/** Particles per frame for a rate per second, frame-rate independent. */
export function perFrame(rate: number, dt: number): number {
  const n = rate * dt;
  const whole = Math.floor(n);
  return whole + (Math.random() < n - whole ? 1 : 0);
}
