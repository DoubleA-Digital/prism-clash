// Power and ultimate icons, drawn once by each definition's drawIcon and cached.

import { powerDef, ultDef, type PowerId, type UltId } from "@prism/shared";

const cache = new Map<string, HTMLCanvasElement>();

export function iconCanvas(id: PowerId | UltId, size: number): HTMLCanvasElement {
  const key = `${id}|${size}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = Math.round(size * dpr);
  const g = c.getContext("2d");
  const def = powerDef(id as PowerId) ?? ultDef(id as UltId);
  if (g && def) {
    g.scale(dpr, dpr);
    g.translate(size / 2, size / 2);
    def.drawIcon(g, size, 0.6);
  }
  cache.set(key, c);
  return c;
}

const urlCache = new Map<string, string>();

/**
 * The icon as a data URL for <img>. Drawn on its own CPU-backed canvas: toDataURL on a
 * GPU canvas waits for the GPU to drain, which stalled the pick screens for seconds
 * while a match was rendering underneath.
 */
export function iconDataUrl(id: PowerId | UltId, size: number): string {
  const key = `${id}|${size}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = Math.round(size * dpr);
  const g = c.getContext("2d", { willReadFrequently: true });
  const def = powerDef(id as PowerId) ?? ultDef(id as UltId);
  if (g && def) {
    g.scale(dpr, dpr);
    g.translate(size / 2, size / 2);
    def.drawIcon(g, size, 0.6);
  }
  const url = c.toDataURL();
  urlCache.set(key, url);
  return url;
}

export function powerInfo(id: PowerId | UltId): { name: string; description: string; color: string; cooldown: number | null } {
  const p = powerDef(id as PowerId);
  if (p) return { name: p.name, description: p.description, color: p.color, cooldown: p.cooldown };
  const u = ultDef(id as UltId);
  if (u) return { name: u.name, description: u.description, color: u.color, cooldown: null };
  return { name: id, description: "", color: "#ffffff", cooldown: null };
}
