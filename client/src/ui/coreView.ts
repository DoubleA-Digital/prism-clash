// Small live canvases that draw a player's real glowing core (the same drawCore the arena uses).
// One shared animation loop redraws every attached canvas and drops the ones that left the DOM.

import { PLAYER, PLAYER_COLORS } from "@prism/shared";
import { drawCore } from "../render/core";

export interface CoreViewOpts {
  /** Health 0..100: lower values crack the shell (used for flavor on the results screen). */
  hp?: number;
  ultReady?: boolean;
  /** Draw dim and without spin, e.g. an empty slot silhouette. */
  ghost?: boolean;
  /** Aim the little pointer toward this angle (radians). */
  aim?: number;
}

interface Live {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
  colorIndex: number;
  opts: CoreViewOpts;
  born: number;
  seen: boolean;
}

/** Canvas side as a multiple of the core diameter (room for the aura). */
const BLEED = 2.5;
const live = new Set<Live>();
let raf = 0;
const reduce = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

function frame(now: number) {
  raf = 0;
  const t = reduce?.matches ? 0 : now / 1000;
  for (const l of live) {
    if (l.canvas.isConnected) l.seen = true;
    else if (l.seen || now - l.born > 3000) {
      live.delete(l);
      continue;
    }
    paint(l, t);
  }
  if (live.size) raf = requestAnimationFrame(frame);
}

function paint(l: Live, t: number) {
  const { ctx, size } = l;
  const dpr = l.canvas.width / size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  // The aura reaches about 2.6 radii; fit that into the canvas.
  const k = size / (PLAYER.radius * 2.1 * BLEED);
  ctx.translate(size / 2, size / 2);
  ctx.scale(k, k);
  const o = l.opts;
  drawCore(ctx, {
    x: 0, y: 0, color: PLAYER_COLORS[l.colorIndex]?.hex ?? "#ffffff", colorIndex: l.colorIndex, hp: o.hp ?? 100,
    aim: o.aim ?? -0.6 + Math.sin(t * 0.8 + l.colorIndex) * 0.4, time: o.ghost ? 0 : t, name: "", isMe: false, alpha: o.ghost ? 0.28 : 1,
    dashing: false, ultReady: o.ultReady ?? false, bountied: false, slowed: false, inverted: false, airborne: 0, invulnerable: false,
    disconnected: false, colorblind: false, invScale: 1, showBar: false,
  });
}

export function coreCanvas(colorIndex: number, size: number, opts: CoreViewOpts = {}): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // `size` is the core's own diameter; the canvas is larger so the aura has room, and negative margins keep layout tight.
  const side = Math.round(size * BLEED);
  canvas.width = canvas.height = Math.round(side * dpr);
  canvas.style.width = canvas.style.height = `${side}px`;
  canvas.style.margin = `${-(side - size) / 2}px`;
  canvas.className = "core";
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const l: Live = { canvas, ctx, size: side, colorIndex, opts, born: performance.now(), seen: false };
  live.add(l);
  paint(l, 0);
  if (!raf) raf = requestAnimationFrame(frame);
  return canvas;
}
