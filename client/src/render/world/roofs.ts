// Rooftops: one cached sprite per building (gravel, tar or metal roofing, a parapet with a
// lit edge, AC units with fans, vents, skylights, solar panels, water tanks, and often a
// neon sign), drawn with a smooth fade while you're inside that building, plus a live
// flicker glow for the sign and a faint outline of the walls while the roof is hidden.

import { WORLD_ART, type MapDef, type Roof } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import { texture, type TextureId } from "./textures";
import { canvas, hash, intersects, Prng, type Bounds } from "./rand";

const SIGNS = ["NOODLES", "ARCADE", "24/7", "PRISM", "HOTEL", "RAMEN", "CYBER", "DINER", "CLUB", "OPEN", "GYM", "BAR", "VOID", "NEON"];
const SIGN_COLORS = ["#FF2E88", "#00F0FF", "#FFC83D", "#A970FF", "#9DFF3A", "#ff6b3d"];
const OVER = 6;

interface RoofSprite {
  c: HTMLCanvasElement;
  used: number;
  sign: { x: number; y: number; w: number; color: string } | null;
}

function acUnit(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.fillStyle = "rgba(0,0,10,0.45)";
  g.fillRect(x + 5, y + 7, w, h);
  g.fillStyle = "#3a3f72";
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(x, y, w, 3);
  g.fillStyle = "#1a1d40";
  const r = Math.min(w, h) * 0.36;
  g.beginPath();
  g.arc(x + w * 0.35, y + h / 2, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#565ca0";
  g.lineWidth = 2;
  g.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.4;
    g.moveTo(x + w * 0.35, y + h / 2);
    g.lineTo(x + w * 0.35 + Math.cos(a) * r * 0.9, y + h / 2 + Math.sin(a) * r * 0.9);
  }
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let k = 0; k < 4; k++) g.fillRect(x + w * 0.68, y + 6 + k * ((h - 12) / 4), w * 0.24, 2);
}

function paintRoof(g: CanvasRenderingContext2D, r: Roof, seed: number): RoofSprite["sign"] {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const rnd = new Prng(hash(r.x0, r.y0, seed) * 1e9);
  const mat: TextureId = r.variant < 0.33 ? "gravel" : r.variant < 0.66 ? "tarRoof" : "metalRoof";
  g.translate(OVER, OVER);
  g.fillStyle = "rgba(0,0,10,0.5)";
  g.fillRect(-OVER + 4, -OVER + 8, w + OVER * 2, h + OVER * 2);
  g.fillStyle = texture(mat);
  g.fillRect(-OVER, -OVER, w + OVER * 2, h + OVER * 2);
  g.fillStyle = r.variant > 0.5 ? "rgba(255,46,136,0.05)" : "rgba(0,240,255,0.04)";
  g.fillRect(-OVER, -OVER, w + OVER * 2, h + OVER * 2);
  // Details.
  const free: { x: number; y: number; w: number; h: number }[] = [];
  const place = (pw: number, ph: number): { x: number; y: number } | null => {
    for (let k = 0; k < 12; k++) {
      const x = rnd.range(30, w - 30 - pw);
      const y = rnd.range(30, h - 30 - ph);
      if (free.every((f) => x > f.x + f.w + 14 || x + pw < f.x - 14 || y > f.y + f.h + 14 || y + ph < f.y - 14)) {
        free.push({ x, y, w: pw, h: ph });
        return { x, y };
      }
    }
    return null;
  };
  let sign: RoofSprite["sign"] = null;
  if (hash(r.x0, r.y1, seed) < WORLD_ART.roof.signChance && w > 220) {
    const text = SIGNS[Math.floor(hash(r.x1, r.y0, seed) * SIGNS.length)] ?? "NEON";
    const color = SIGN_COLORS[Math.floor(hash(r.y0, r.x1, seed) * SIGN_COLORS.length)] ?? "#FF2E88";
    const size = Math.min(64, (w - 80) / Math.max(3, text.length * 0.72));
    const sx = w / 2;
    const sy = hash(r.x0, r.x1, seed) < 0.5 ? 26 + size * 0.55 : h - 26 - size * 0.55;
    g.font = `900 ${size}px Orbitron, Rajdhani, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const tw = g.measureText(text).width;
    free.push({ x: sx - tw / 2 - 20, y: sy - size * 0.7, w: tw + 40, h: size * 1.4 });
    g.fillStyle = "rgba(8,6,20,0.85)";
    g.beginPath();
    g.roundRect(sx - tw / 2 - 16, sy - size * 0.62, tw + 32, size * 1.24, 8);
    g.fill();
    g.strokeStyle = withAlpha(color, 0.35);
    g.lineWidth = 2;
    g.stroke();
    g.shadowColor = color;
    g.shadowBlur = 22;
    g.fillStyle = color;
    g.fillText(text, sx, sy);
    g.shadowBlur = 8;
    g.fillText(text, sx, sy);
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.font = `900 ${size * 0.92}px Orbitron, Rajdhani, system-ui, sans-serif`;
    g.globalAlpha = 0.55;
    g.fillText(text, sx, sy);
    g.globalAlpha = 1;
    sign = { x: sx, y: sy, w: tw, color };
  }
  const acs = 1 + Math.floor(rnd.next() * Math.min(3, (w * h) / 60000));
  for (let k = 0; k < acs; k++) {
    const p = place(66, 46);
    if (p) acUnit(g, p.x, p.y, 66, 46);
  }
  if (w * h > 120000 && rnd.next() < 0.6) {
    const pw = Math.min(220, w * 0.4);
    const ph = 70;
    const p = place(pw, ph);
    if (p) {
      for (let x = 0; x < pw - 4; x += 36) {
        for (let y = 0; y < ph - 4; y += 35) {
          g.fillStyle = "#16245a";
          g.fillRect(p.x + x, p.y + y, 32, 31);
          g.fillStyle = "rgba(124,180,255,0.18)";
          g.fillRect(p.x + x + 2, p.y + y + 2, 12, 2);
          g.strokeStyle = "rgba(124,246,255,0.18)";
          g.lineWidth = 1;
          g.strokeRect(p.x + x + 0.5, p.y + y + 0.5, 31, 30);
        }
      }
    }
  }
  if (rnd.next() < 0.7) {
    const p = place(90, 60);
    if (p) {
      g.fillStyle = "#1e2350";
      g.fillRect(p.x, p.y, 90, 60);
      g.fillStyle = "rgba(124,246,255,0.16)";
      g.fillRect(p.x + 6, p.y + 6, 78, 48);
      g.strokeStyle = "rgba(255,255,255,0.12)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(p.x + 45, p.y + 6);
      g.lineTo(p.x + 45, p.y + 54);
      g.moveTo(p.x + 6, p.y + 30);
      g.lineTo(p.x + 84, p.y + 30);
      g.stroke();
    }
  }
  if (rnd.next() < 0.45) {
    const p = place(64, 64);
    if (p) {
      g.fillStyle = "rgba(0,0,10,0.45)";
      g.beginPath();
      g.arc(p.x + 37, p.y + 39, 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#3a3060";
      g.beginPath();
      g.arc(p.x + 32, p.y + 32, 30, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.1)";
      g.lineWidth = 2;
      for (const rr of [24, 16]) {
        g.beginPath();
        g.arc(p.x + 32, p.y + 32, rr, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  for (let k = 0; k < 3; k++) {
    const p = place(18, 18);
    if (!p) continue;
    g.fillStyle = "#2c3064";
    g.beginPath();
    g.arc(p.x + 9, p.y + 9, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0c0e24";
    g.beginPath();
    g.arc(p.x + 9, p.y + 9, 5, 0, Math.PI * 2);
    g.fill();
  }
  // Parapet: a raised rim with a lit top edge.
  g.strokeStyle = "#2b2e66";
  g.lineWidth = 14;
  g.strokeRect(-OVER + 7, -OVER + 7, w + OVER * 2 - 14, h + OVER * 2 - 14);
  g.strokeStyle = "rgba(0,0,10,0.4)";
  g.lineWidth = 6;
  g.strokeRect(-OVER + 17, -OVER + 17, w + OVER * 2 - 34, h + OVER * 2 - 34);
  g.fillStyle = "rgba(220,230,255,0.2)";
  g.fillRect(-OVER, -OVER, w + OVER * 2, 2.5);
  g.fillRect(-OVER, -OVER, 2.5, h + OVER * 2);
  g.strokeStyle = withAlpha(r.variant > 0.5 ? "#FF2E88" : "#7CF6FF", 0.75);
  g.lineWidth = 3;
  g.strokeRect(-OVER + 1.5, -OVER + 1.5, w + OVER * 2 - 3, h + OVER * 2 - 3);
  return sign;
}

export class Roofs {
  private alpha: number[];
  private sprites = new Map<number, RoofSprite>();
  private frame = 0;

  constructor(private map: MapDef) {
    this.alpha = map.roofs.map(() => 1);
  }

  private sprite(i: number, r: Roof): RoofSprite {
    let s = this.sprites.get(i);
    if (!s) {
      const res = WORLD_ART.roof.res;
      const w = r.x1 - r.x0 + OVER * 2;
      const h = r.y1 - r.y0 + OVER * 2;
      const [c, g] = canvas(w * res, h * res);
      g.scale(res, res);
      const sign = paintRoof(g, r, this.map.seed);
      s = { c, used: this.frame, sign };
      this.sprites.set(i, s);
      if (this.sprites.size > WORLD_ART.roof.cache) {
        const old = [...this.sprites.entries()].sort((a, b) => a[1].used - b[1].used)[0];
        if (old) this.sprites.delete(old[0]);
      }
    }
    s.used = this.frame;
    return s;
  }

  /** Roofs: opaque from outside, fading away while `inside` is that building. */
  draw(ctx: CanvasRenderingContext2D, view: Bounds, inside: number, dt: number, time: number) {
    this.frame++;
    const cfg = WORLD_ART.roof;
    this.map.roofs.forEach((r, i) => {
      const target = i === inside ? cfg.insideAlpha : 1;
      const cur = this.alpha[i] ?? 1;
      const next = cur + (target - cur) * Math.min(1, dt * cfg.fadeSpeed);
      this.alpha[i] = next;
      if (!intersects(r, view, 40)) return;
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      if (next > 0.02) {
        const s = this.sprite(i, r);
        ctx.save();
        ctx.globalAlpha = next;
        ctx.drawImage(s.c, r.x0 - OVER, r.y0 - OVER, w + OVER * 2, h + OVER * 2);
        ctx.restore();
        if (s.sign && next > 0.3) {
          const flick = hash(i, Math.floor(time * 8)) < 0.04 ? 0.3 : 1;
          drawGlow(ctx, r.x0 + s.sign.x, r.y0 + s.sign.y, s.sign.w * 0.8 + 60, s.sign.color, (0.16 + 0.05 * Math.sin(time * 2 + i)) * next * flick, 0.05);
        }
      }
      if (next < 0.9) {
        // The building outline while you're inside.
        ctx.save();
        ctx.globalAlpha = (1 - next) * 0.6;
        ctx.strokeStyle = r.variant > 0.5 ? "#FF2E88" : "#7CF6FF";
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -time * 20;
        ctx.strokeRect(r.x0 - 4, r.y0 - 4, w + 8, h + 8);
        ctx.restore();
      }
    });
  }
}
