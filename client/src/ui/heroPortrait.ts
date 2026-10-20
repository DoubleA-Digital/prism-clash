// Small hero portraits for the lobby roster, results podium, scoreboard and spectate label.
// Each (hero, color, pixel size) is painted once into a cached bitmap; DOM callers get a fresh
// canvas element copied from it, canvas callers draw the bitmap directly.

import type { HeroId } from "@prism/shared";
import { drawHeroPortrait } from "../render/chibi";

const cache = new Map<string, HTMLCanvasElement>();
const MAX_CACHED = 96;

/** Cached portrait bitmap `px` device pixels square. */
export function portraitImage(hero: HeroId, color: string, px: number): HTMLCanvasElement {
  const size = Math.max(8, Math.round(px));
  const key = `${hero}|${color}|${size}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) drawHeroPortrait(g, hero, color, size);
  if (cache.size >= MAX_CACHED) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, c);
  return c;
}

/** A new DOM canvas showing the portrait at `cssSize` CSS pixels (crisp on high-DPI screens). */
export function portraitCanvas(hero: HeroId, color: string, cssSize: number, className = "hero-mini"): HTMLCanvasElement {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const src = portraitImage(hero, color, cssSize * dpr);
  const c = document.createElement("canvas");
  c.className = className;
  c.width = c.height = src.width;
  c.style.width = c.style.height = `${cssSize}px`;
  c.setAttribute("aria-hidden", "true");
  c.getContext("2d")?.drawImage(src, 0, 0);
  return c;
}
