// Corner HUD pieces: the kill feed (top right) and the minimap (bottom right).

import { FX, hasStatusBit, PFLAG, type PowerId } from "@prism/shared";
import { drawShapeMarker } from "../render/core";
import { withAlpha } from "../render/glow";
import { colorHex, PAL } from "../render/palette";
import { easeOut, font, panel, sourceGlyph, UIFONT } from "./hudKit";
import type { HudInput } from "./hudTypes";
import { iconCanvas } from "./icons";

const PLAIN_SOURCES = new Set(["shot", "zone", "wall", "haunt", "combo"]);

function sourceLabel(s: string): string {
  if (s === "zone") return "THE ZONE";
  if (s === "haunt") return "A GHOST";
  if (s === "wall") return "A WALL";
  return "???";
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
    if (!PLAIN_SOURCES.has(k.source)) ctx.drawImage(iconCanvas(k.source as PowerId, Math.round(iconW)), cx, y - iconW / 2, iconW, iconW);
    else sourceGlyph(ctx, k.source, cx + iconW / 2, y, iconW * 0.34, PAL.dim);
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

export function drawMinimap(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
  const g = h.g;
  if (!g) return;
  const size = 196 * u;
  const x0 = h.w - size - 24 * u;
  const y0 = h.h - size - 24 * u;
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const sc = (size / 2 - 8 * u) / h.arenaRadius;
  const warn = g.phase === "warn" && g.remaining < 5;

  ctx.save();
  // Frame glow + glass disc
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.shadowColor = warn ? withAlpha(PAL.zone, 0.7) : "rgba(0,240,255,0.25)";
  ctx.shadowBlur = 20;
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  bg.addColorStop(0, "rgba(14,12,42,0.84)");
  bg.addColorStop(1, "rgba(6,5,20,0.9)");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip();
  // Faint range rings: how far you can detect other players
  ctx.strokeStyle = "rgba(124,246,255,0.08)";
  ctx.lineWidth = 1;
  for (const f of [0.33, 0.66]) {
    ctx.beginPath();
    ctx.arc(cx, cy, (size / 2) * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - size / 2, cy);
  ctx.lineTo(cx + size / 2, cy);
  ctx.moveTo(cx, cy - size / 2);
  ctx.lineTo(cx, cy + size / 2);
  ctx.stroke();
  // Arena outline
  ctx.strokeStyle = "rgba(124,246,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const px = cx + Math.cos(a) * h.arenaRadius * sc;
    const py = cy + Math.sin(a) * h.arenaRadius * sc;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.stroke();
  // Danger area outside the zone, then the zone ring
  if (g.zr < 6000) {
    const zx = cx + g.zx * sc;
    const zy = cy + g.zy * sc;
    const zr = Math.max(1, g.zr * sc);
    ctx.beginPath();
    ctx.rect(x0, y0, size, size);
    ctx.arc(zx, zy, zr, 0, Math.PI * 2, true);
    ctx.fillStyle = `rgba(255,61,110,${warn ? 0.22 + 0.1 * Math.sin(h.time * 12) : 0.17})`;
    ctx.fill("evenodd");
    ctx.strokeStyle = PAL.zone;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = PAL.zone;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(zx, zy, zr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (g.phase === "warn") {
      ctx.strokeStyle = PAL.zoneSafe;
      ctx.lineWidth = 2;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.lineDashOffset = -h.time * 12;
      ctx.beginPath();
      ctx.arc(cx + g.tx * sc, cy + g.ty * sc, Math.max(1, g.tr * sc), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
    const px = cx + (me ? h.meX : p.x) * sc;
    const py = cy + (me ? h.meY : p.y) * sc;
    const col = colorHex(p.color);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = me ? 12 : 8;
    if (h.colorblind) drawShapeMarker(ctx, px, py, 5.5 * u, p.color);
    else {
      ctx.beginPath();
      ctx.arc(px, py, (me ? 5.5 : 4.5) * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (revealed && !me) {
      const t = (h.time * 1.6) % 1;
      ctx.strokeStyle = withAlpha(col, 1 - t);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, (5 + t * 10) * u, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (me) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 8.5 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Rim
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.strokeStyle = warn ? withAlpha(PAL.zone, 0.9) : "rgba(124,246,255,0.45)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}
