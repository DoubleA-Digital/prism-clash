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

export function iconDataUrl(id: PowerId | UltId, size: number): string {
  return iconCanvas(id, size).toDataURL();
}

export function powerInfo(id: PowerId | UltId): { name: string; description: string; color: string; cooldown: number | null } {
  const p = powerDef(id as PowerId);
  if (p) return { name: p.name, description: p.description, color: p.color, cooldown: p.cooldown };
  const u = ultDef(id as UltId);
  if (u) return { name: u.name, description: u.description, color: u.color, cooldown: null };
  return { name: id, description: "", color: "#ffffff", cooldown: null };
}
