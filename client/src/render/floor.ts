// The map floor: ground, streets, sidewalks, plazas, building floors, grass, sand, bridges
// and water, pre-rendered once per match into a texture (it never changes). Ripple rings
// light up a faint hex grid outward from explosions and impacts, drawn live and only where
// the camera looks.

import type { DecorKind, MapDef } from "@prism/shared";
import { withAlpha } from "./glow";
import { colorHex, PAL } from "./palette";

const RES = 0.3; // floor texture pixels per world unit
const HEX = 46;
const SQ3 = Math.sqrt(3);

interface Ripple {
  x: number;
  y: number;
  age: number;
  life: number;
  speed: number;
  strength: number;
  color: string;
}

const THEMES = {
  city: { ground: "#0b0d24", speck: "rgba(120,140,255,0.05)" },
  wilds: { ground: "#08191d", speck: "rgba(90,255,200,0.05)" },
  yard: { ground: "#0d1236", speck: "rgba(120,140,255,0.05)" },
} as const;

const DECOR: Record<DecorKind, { fill: string; line?: string }> = {
  road: { fill: "#0b0d24" },
  sidewalk: { fill: "#141a3e", line: "rgba(124,246,255,0.14)" },
  plaza: { fill: "#161b46", line: "rgba(169,112,255,0.18)" },
  lot: { fill: "#0f1331", line: "rgba(255,211,77,0.16)" },
  floor: { fill: "#1b1a44", line: "rgba(255,255,255,0.05)" },
  grass: { fill: "#0c2a2c", line: "rgba(93,255,157,0.08)" },
  moss: { fill: "#0c2725" },
  sand: { fill: "#231f30" },
  tile: { fill: "#1a1d44", line: "rgba(43,255,200,0.12)" },
  bridge: { fill: "#2a2142", line: "rgba(255,138,43,0.25)" },
  lane: { fill: "rgba(255,211,77,0.35)" },
};

export class Floor {
  private tex: HTMLCanvasElement;
  private ripples: Ripple[] = [];
  readonly map: MapDef;
  private size: number;

  constructor(map: MapDef) {
    this.map = map;
    this.size = map.half * 2;
    this.tex = document.createElement("canvas");
    this.tex.width = this.tex.height = Math.ceil(this.size * RES);
    const g = this.tex.getContext("2d");
    if (g) this.paint(g);
  }

  private paint(g: CanvasRenderingContext2D) {
    const m = this.map;
    const th = THEMES[m.theme];
    g.scale(RES, RES);
    g.translate(m.half, m.half);
    g.fillStyle = th.ground;
    g.fillRect(-m.half, -m.half, this.size, this.size);
    // Speckle so big empty areas aren't flat.
    let seed = m.seed >>> 0 || 1;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    g.fillStyle = th.speck;
    for (let i = 0; i < 2600; i++) g.fillRect(rnd() * this.size - m.half, rnd() * this.size - m.half, 6 + rnd() * 18, 6 + rnd() * 18);
    // Decor, in the order the generator laid it down (lanes last, they're on top).
    const order: DecorKind[] = ["moss", "sand", "sidewalk", "plaza", "lot", "grass", "tile", "floor", "bridge", "lane"];
    for (const k of order) {
      const st = DECOR[k];
      for (const d of m.decor) {
        if (d.kind !== k) continue;
        const w = d.x1 - d.x0;
        const h = d.y1 - d.y0;
        g.fillStyle = st.fill;
        if (k === "moss" || k === "sand") {
          g.beginPath();
          g.ellipse(d.x0 + w / 2, d.y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          g.fill();
          continue;
        }
        g.fillRect(d.x0, d.y0, w, h);
        if (!st.line) continue;
        g.strokeStyle = st.line;
        g.lineWidth = 4;
        if (k === "floor" || k === "tile" || k === "plaza") {
          const step = k === "plaza" ? 120 : 60;
          g.beginPath();
          for (let x = d.x0 + step; x < d.x1; x += step) {
            g.moveTo(x, d.y0);
            g.lineTo(x, d.y1);
          }
          for (let y = d.y0 + step; y < d.y1; y += step) {
            g.moveTo(d.x0, y);
            g.lineTo(d.x1, y);
          }
          g.stroke();
        } else if (k === "lot") {
          g.beginPath();
          for (let x = d.x0 + 60; x < d.x1 - 30; x += 120) {
            g.moveTo(x, d.y0 + 30);
            g.lineTo(x, d.y0 + 100);
            g.moveTo(x, d.y1 - 100);
            g.lineTo(x, d.y1 - 30);
          }
          g.stroke();
        } else if (k === "bridge") {
          g.beginPath();
          for (let x = d.x0 + 20; x < d.x1; x += 34) {
            g.moveTo(x, d.y0 + 14);
            g.lineTo(x, d.y1 - 14);
          }
          g.stroke();
        }
        g.lineWidth = 6;
        g.strokeRect(d.x0 + 3, d.y0 + 3, w - 6, h - 6);
      }
    }
    // Water under the shimmer layer: deep blue with a bright bank line.
    for (const wtr of m.water) {
      g.fillStyle = "#06264d";
      g.fillRect(wtr.x0, wtr.y0, wtr.x1 - wtr.x0, wtr.y1 - wtr.y0);
    }
    g.strokeStyle = "rgba(95,208,255,0.35)";
    g.lineWidth = 8;
    for (const wtr of m.water) {
      g.beginPath();
      g.moveTo(wtr.x0, wtr.y0);
      g.lineTo(wtr.x0, wtr.y1);
      g.moveTo(wtr.x1, wtr.y0);
      g.lineTo(wtr.x1, wtr.y1);
      g.stroke();
    }
    for (const b of m.bridges) {
      g.fillStyle = DECOR.bridge.fill;
      g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.strokeStyle = DECOR.bridge.line ?? "";
      g.lineWidth = 4;
      g.beginPath();
      for (let x = b.x0 + 20; x < b.x1; x += 34) {
        g.moveTo(x, b.y0 + 14);
        g.lineTo(x, b.y1 - 14);
      }
      g.stroke();
    }
  }

  ripple(x: number, y: number, strength: number, color: string = PAL.edge) {
    if (this.ripples.length > 16) this.ripples.shift();
    this.ripples.push({ x, y, age: 0, life: 0.9 + strength * 0.4, speed: 700 + strength * 300, strength, color });
  }

  ripplePlayer(x: number, y: number, color: number, strength: number) {
    this.ripple(x, y, strength, colorHex(color));
  }

  update(dt: number) {
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < r.life);
  }

  /** World-space draw (camera transform already applied). */
  draw(ctx: CanvasRenderingContext2D, time: number, view: { x0: number; y0: number; x1: number; y1: number }) {
    const m = this.map;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tex, -m.half, -m.half, this.size, this.size);
    this.drawWater(ctx, time, view);
    if (!this.ripples.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 2;
    const w = SQ3 * HEX;
    const h = 1.5 * HEX;
    for (const r of this.ripples) {
      const rad = r.age * r.speed;
      const band = 70;
      const fade = (1 - r.age / r.life) * Math.min(1, r.strength);
      if (fade <= 0.02) continue;
      ctx.strokeStyle = withAlpha(r.color, 0.5 * fade);
      ctx.beginPath();
      const x0 = Math.max(view.x0, r.x - rad - band);
      const x1 = Math.min(view.x1, r.x + rad + band);
      const y0 = Math.max(view.y0, r.y - rad - band);
      const y1 = Math.min(view.y1, r.y + rad + band);
      for (let row = Math.floor(y0 / h); row <= Math.ceil(y1 / h); row++) {
        for (let col = Math.floor(x0 / w) - 1; col <= Math.ceil(x1 / w); col++) {
          const cx = col * w + (row & 1 ? w / 2 : 0);
          const cy = row * h;
          const d = Math.hypot(cx - r.x, cy - r.y);
          if (Math.abs(d - rad) > band) continue;
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            const px = cx + Math.cos(a) * HEX * 0.94;
            const py = cy + Math.sin(a) * HEX * 0.94;
            if (k) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.closePath();
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Animated shimmer lines on water in view. */
  private drawWater(ctx: CanvasRenderingContext2D, time: number, view: { x0: number; y0: number; x1: number; y1: number }) {
    const m = this.map;
    if (!m.water.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 3;
    for (const wtr of m.water) {
      if (wtr.x1 < view.x0 || wtr.x0 > view.x1 || wtr.y1 < view.y0 || wtr.y0 > view.y1) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(wtr.x0, wtr.y0, wtr.x1 - wtr.x0, wtr.y1 - wtr.y0);
      ctx.clip();
      for (let y = wtr.y0 + 20; y < wtr.y1; y += 46) {
        const a = 0.12 + 0.1 * Math.sin(time * 1.7 + y * 0.05);
        ctx.strokeStyle = `rgba(120,220,255,${a})`;
        ctx.beginPath();
        for (let x = wtr.x0; x <= wtr.x1; x += 30) {
          const yy = y + Math.sin(x * 0.03 + time * 2.4 + y) * 5;
          if (x === wtr.x0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
}
