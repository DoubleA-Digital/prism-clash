// Corner HUD pieces: the kill feed (top right) and the minimap (bottom right).

import { FX, hasStatusBit, isThrowableId, isWeaponId, PFLAG, type MapDef, type PowerId } from "@prism/shared";
import { drawShapeMarker } from "../render/core";
import { withAlpha } from "../render/glow";
import { itemIcon, weaponIcon } from "../render/items";
import { colorHex, PAL } from "../render/palette";
import { easeOut, font, panel, sourceGlyph, UIFONT } from "./hudKit";
import type { HudInput } from "./hudTypes";
import { iconCanvas } from "./icons";

const PLAIN_SOURCES = new Set(["zone", "wall", "haunt", "combo", "barrel"]);

function sourceLabel(s: string): string {
  if (s === "zone") return "THE ZONE";
  if (s === "haunt") return "A GHOST";
  if (s === "wall") return "A WALL";
  if (s === "barrel") return "A BARREL";
  return "???";
}

/** The kill-feed chip for whatever dealt the blow: weapon, grenade, power or a glyph. */
function drawSource(ctx: CanvasRenderingContext2D, source: string, x: number, y: number, size: number) {
  if (isWeaponId(source)) ctx.drawImage(weaponIcon(source, 0, Math.round(size * 1.6), Math.round(size)), x - size * 0.3, y - size / 2, size * 1.6, size);
  else if (isThrowableId(source)) ctx.drawImage(itemIcon("throwable", Math.round(size), source), x, y - size / 2, size, size);
  else if (!PLAIN_SOURCES.has(source)) ctx.drawImage(iconCanvas(source as PowerId, Math.round(size)), x, y - size / 2, size, size);
  else sourceGlyph(ctx, source, x + size / 2, y, size * 0.34, PAL.dim);
}

export function drawFeed(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
  const now = performance.now();
  let y = 34 * u;
  const right = h.w - 20 * u;
  ctx.textBaseline = "middle";
  for (const k of h.killFeed) {
    const age = (now - k.at) / 1000;
    if (age > 7) continue;
    const a = age > 6 ? 7 - age : 1;
    const slide = 1 - easeOut(age / 0.28);
    const mine = h.myId === k.killer || h.myId === k.victim;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(slide * 90 * u, 0);
    ctx.font = font(700, 16 * u, UIFONT);
    const killer = k.killer ? h.names(k.killer) : sourceLabel(k.source);
    const victim = h.names(k.victim);
    const kc = k.killer ? colorHex(h.colors(k.killer)) : PAL.zone;
    const vc = colorHex(h.colors(k.victim));
    const wk = ctx.measureText(killer).width;
    const wv = ctx.measureText(victim).width;
    const mk = h.colorblind ? 16 * u : 0;
    const iconW = 26 * u;
    const total = wk + wv + iconW + 66 * u + mk * (k.killer ? 2 : 1);
    const x = right - total;
    panel(ctx, x, y - 15 * u, total, 30 * u, 10 * u, {
      border: mine ? "rgba(255,255,255,0.85)" : "rgba(124,246,255,0.18)",
      glow: mine ? withAlpha(k.killer === h.myId ? PAL.gold : PAL.danger, 0.55) : undefined,
      fill: mine ? "rgba(30,26,72,0.92)" : undefined,
    });
    let cx = x + 12 * u;
    ctx.textAlign = "left";
    if (k.killer) {
      if (h.colorblind) {
        drawShapeMarker(ctx, cx + 6 * u, y, 5 * u, h.colors(k.killer));
        cx += mk;
      }
      ctx.fillStyle = kc;
      ctx.fillText(killer, cx, y + 1);
    } else {
      ctx.fillStyle = kc;
      ctx.fillText(killer, cx, y + 1);
    }
    cx += wk + 10 * u;
    // Source icon in a small round chip
    ctx.beginPath();
    ctx.arc(cx + iconW / 2, y, iconW / 2 + 1 * u, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(5,4,13,0.8)";
    ctx.fill();
    drawSource(ctx, k.source, cx, y, iconW);
    cx += iconW + 10 * u;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = font(800, 14 * u, UIFONT);
    ctx.fillText("⟶", cx, y + 1);
    cx += 22 * u;
    ctx.font = font(700, 16 * u, UIFONT);
    if (h.colorblind) {
      drawShapeMarker(ctx, cx + 6 * u, y, 5 * u, h.colors(k.victim));
      cx += mk;
    }
    ctx.fillStyle = vc;
    ctx.fillText(victim, cx, y + 1);
    ctx.restore();
    y += 38 * u;
  }
}

const mapCache = new Map<string, HTMLCanvasElement>();

/** The map at minimap scale: ground, water, roofs/walls and bushes, drawn once per match. */
function minimapImage(map: MapDef, px: number): HTMLCanvasElement {
  const key = `${map.id}|${map.seed}|${px}`;
  let c = mapCache.get(key);
  if (c) return c;
  mapCache.clear();
  c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  if (g) {
    const sc = px / (map.half * 2);
    g.scale(sc, sc);
    g.translate(map.half, map.half);
    g.fillStyle = map.theme === "wilds" ? "#0a2026" : "#0d1030";
    g.fillRect(-map.half, -map.half, map.half * 2, map.half * 2);
    g.fillStyle = "rgba(124,246,255,0.06)";
    for (const d of map.decor) if (d.kind === "sidewalk" || d.kind === "plaza") g.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    g.fillStyle = "rgba(93,255,157,0.1)";
    for (const d of map.decor) if (d.kind === "grass") g.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    g.fillStyle = "#1a5aa8";
    for (const w of map.water) g.fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
    g.fillStyle = "#3b2c52";
    for (const b of map.bridges) g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    g.fillStyle = "rgba(43,180,140,0.55)";
    for (const b of map.bushes) {
      g.beginPath();
      g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(60,64,140,0.9)";
    for (const r of map.roofs) g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    g.fillStyle = "rgba(160,190,255,0.75)";
    for (const s of map.solids) {
      if (!s.vision || s.x1 - s.x0 > map.half) continue;
      g.fillRect(s.x0, s.y0, Math.max(30, s.x1 - s.x0), Math.max(30, s.y1 - s.y0));
    }
  }
  mapCache.set(key, c);
  return c;
}

export function drawMinimap(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
  const g = h.g;
  if (!g) return;
  const size = 196 * u;
  const x0 = h.w - size - 24 * u;
  const y0 = h.h - size - 24 * u;
  const map = h.map;
  const sc = size / (map.half * 2);
  const mx = (x: number) => x0 + (x + map.half) * sc;
  const my = (y: number) => y0 + (y + map.half) * sc;
  const warn = g.phase === "warn" && g.remaining < 5;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, y0, size, size, 14 * u);
  ctx.shadowColor = warn ? withAlpha(PAL.zone, 0.7) : "rgba(0,240,255,0.25)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "rgba(6,5,20,0.9)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(minimapImage(map, Math.round(size * h.dpr)), x0, y0, size, size);
  ctx.globalAlpha = 1;
  // Danger area outside the zone, then the zone ring and the next circle.
  const zx = mx(g.zx);
  const zy = my(g.zy);
  const zr = Math.max(1, g.zr * sc);
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.arc(zx, zy, zr, 0, Math.PI * 2, true);
  ctx.fillStyle = `rgba(255,61,110,${warn ? 0.26 + 0.1 * Math.sin(h.time * 12) : 0.2})`;
  ctx.fill("evenodd");
  ctx.strokeStyle = PAL.zone;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(zx, zy, zr, 0, Math.PI * 2);
  ctx.stroke();
  if (g.phase === "warn" || g.phase === "shrink") {
    ctx.strokeStyle = PAL.zoneSafe;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5 * u, 4 * u]);
    ctx.lineDashOffset = -h.time * 12;
    ctx.beginPath();
    ctx.arc(mx(g.tx), my(g.ty), Math.max(1, g.tr * sc), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Supply drops: a pulsing gold marker (falling) or a solid one (landed).
  for (const e of h.effects) {
    if (e.kind !== "supplyDrop") continue;
    const px = mx(e.x);
    const py = my(e.y);
    const t = (h.time * 1.4) % 1;
    ctx.strokeStyle = withAlpha(PAL.gold, e.n === 0 ? 1 - t : 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, (4 + (e.n === 0 ? t * 9 : 3)) * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(px - 3 * u, py - 3 * u, 6 * u, 6 * u);
  }
  // Players: within range, fired recently, or everyone with Hunter's Eye.
  for (const p of h.players) {
    if (!(p.flags & PFLAG.alive)) continue;
    const me = p.id === h.myId;
    const d = Math.hypot(p.x - h.meX, p.y - h.meY);
    const cloaked = hasStatusBit(p.status, "cloaked");
    const revealed = h.revealed.has(p.id);
    const visible = me || h.huntersEye || ((d < FX.minimapRange || revealed) && !cloaked);
    if (!visible) continue;
    const px = mx(me ? h.meX : p.x);
    const py = my(me ? h.meY : p.y);
    const col = colorHex(p.color);
    ctx.fillStyle = col;
    if (h.colorblind) drawShapeMarker(ctx, px, py, 4.5 * u, p.color);
    else {
      ctx.beginPath();
      ctx.arc(px, py, (me ? 4.5 : 3.5) * u, 0, Math.PI * 2);
      ctx.fill();
    }
    if (revealed && !me) {
      const t = (h.time * 1.6) % 1;
      ctx.strokeStyle = withAlpha(col, 1 - t);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, (4 + t * 8) * u, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (me) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 7.5 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(x0, y0, size, size, 14 * u);
  ctx.strokeStyle = warn ? withAlpha(PAL.zone, 0.9) : "rgba(124,246,255,0.45)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}
