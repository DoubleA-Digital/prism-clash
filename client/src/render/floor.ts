// The map floor: the static ground (streets, sidewalks, interiors, grass, ruins, river
// banks, bridges...) comes from pre-rendered chunk canvases (world/chunks.ts); on top, live
// and only where the camera looks: flowing water, streetlight glow pools, and ripple rings
// that light up a faint hex grid outward from explosions and impacts.

import { WORLD_ART, type MapDef } from "@prism/shared";
import { drawGlow, withAlpha } from "./glow";
import { colorHex, PAL } from "./palette";
import { GroundChunks } from "./world/chunks";
import { hash } from "./world/rand";
import { drawWaterLive, foamEdges, shoreline, type Edge } from "./world/water";

const HEX = 46;
const SQ3 = Math.sqrt(3);
const LIGHT_COLORS = ["#ffd9a0", "#ffd9a0", "#9ff4ff", "#ff9ad5"];

interface Ripple {
  x: number;
  y: number;
  age: number;
  life: number;
  speed: number;
  strength: number;
  color: string;
}

export class Floor {
  private ground: GroundChunks;
  private foam: Edge[];
  private ripples: Ripple[] = [];
  readonly map: MapDef;

  constructor(map: MapDef) {
    this.map = map;
    this.foam = foamEdges(map);
    this.ground = new GroundChunks(map, { shore: shoreline(map.water) });
  }

  /** Chunks painted so far (perf stats). */
  get chunksBuilt(): number {
    return this.ground.built;
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
    const t = ctx.getTransform();
    this.ground.draw(ctx, view, Math.hypot(t.a, t.b));
    drawWaterLive(ctx, this.map, this.foam, time, view);
    this.drawLights(ctx, time, view);
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

  /** Streetlight glow pools (a few flicker), additive over the ground. */
  private drawLights(ctx: CanvasRenderingContext2D, time: number, view: { x0: number; y0: number; x1: number; y1: number }) {
    const ls = this.map.lights;
    if (!ls.length) return;
    const cfg = WORLD_ART.streetlight;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (!l || l.x + l.r < view.x0 || l.x - l.r > view.x1 || l.y + l.r < view.y0 || l.y - l.r > view.y1) continue;
      const k = hash(l.x, l.y, 77);
      const col = LIGHT_COLORS[Math.floor(k * LIGHT_COLORS.length)] ?? "#ffd9a0";
      let a = 1;
      if (k < cfg.flickerChance * 4 && hash(l.y, l.x) < 0.25) {
        const f = Math.sin(time * 23 + i) + Math.sin(time * 7.3 + i * 3);
        a = f > 1.2 ? 0.25 : 1;
      }
      drawGlow(ctx, l.x, l.y + 10, l.r, col, 0.2 * a, 0.05);
      drawGlow(ctx, l.x, l.y, 30, col, 0.7 * a, 0.25);
    }
  }
}
