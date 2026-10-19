// The arena floor: a faint hex grid clipped to the arena, pre-rendered once per round,
// plus ripple rings that light up hex outlines outward from explosions and impacts.

import type { ArenaDef } from "@prism/shared";
import { PAL, colorHex } from "./palette";
import { withAlpha } from "./glow";

const HEX = 44;
const SQ3 = Math.sqrt(3);
const RES = 0.5; // floor texture pixels per world unit

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
  private tex: HTMLCanvasElement;
  private centers: Float32Array;
  private ripples: Ripple[] = [];
  private hexPath: Path2D;
  readonly arena: ArenaDef;

  constructor(arena: ArenaDef) {
    this.arena = arena;
    const R = arena.radius;
    const size = Math.ceil(R * 2 * RES) + 8;
    this.tex = document.createElement("canvas");
    this.tex.width = this.tex.height = size;
    const g = this.tex.getContext("2d");
    const pts: number[] = [];
    // Unit hex outline (pointy-top) reused for every cell.
    this.hexPath = new Path2D();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const x = Math.cos(a) * HEX * 0.98;
      const y = Math.sin(a) * HEX * 0.98;
      if (i) this.hexPath.lineTo(x, y);
      else this.hexPath.moveTo(x, y);
    }
    this.hexPath.closePath();
    if (g) {
      g.translate(size / 2, size / 2);
      g.scale(RES, RES);
      // Clip to the arena polygon.
      g.beginPath();
      arena.verts.forEach((v, i) => (i ? g.lineTo(v.x, v.y) : g.moveTo(v.x, v.y)));
      g.closePath();
      const floorGrad = g.createRadialGradient(0, 0, 0, 0, 0, R);
      floorGrad.addColorStop(0, "#141a48");
      floorGrad.addColorStop(0.7, "#0d1236");
      floorGrad.addColorStop(1, "#090b26");
      g.fillStyle = floorGrad;
      g.fill();
      g.save();
      g.clip();
      g.lineWidth = 1.6 / RES;
      const w = SQ3 * HEX;
      const h = 1.5 * HEX;
      for (let row = -Math.ceil(R / h) - 1; row <= Math.ceil(R / h) + 1; row++) {
        for (let col = -Math.ceil(R / w) - 1; col <= Math.ceil(R / w) + 1; col++) {
          const cx = col * w + (row & 1 ? w / 2 : 0);
          const cy = row * h;
          const d = Math.hypot(cx, cy);
          if (d > R + HEX) continue;
          pts.push(cx, cy);
          const a = 0.1 + 0.08 * Math.max(0, 1 - d / R);
          g.strokeStyle = withAlpha(PAL.grid, a);
          g.save();
          g.translate(cx, cy);
          g.stroke(this.hexPath);
          g.restore();
        }
      }
      // Nebula patches: soft colored clouds you can hide in.
      for (const n of arena.nebulas) {
        const ng = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        ng.addColorStop(0, "rgba(160,70,255,0.30)");
        ng.addColorStop(0.65, "rgba(90,40,200,0.20)");
        ng.addColorStop(1, "rgba(60,20,160,0)");
        g.fillStyle = ng;
        g.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
      }
      g.restore();
    }
    this.centers = new Float32Array(pts);
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
    const R = this.arena.radius;
    const size = this.tex.width;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tex, -size / 2 / RES, -size / 2 / RES, size / RES, size / RES);

    // A slow breathing sweep across the grid.
    const sweep = ((time * 120) % (R * 2.6)) - R * 1.3;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 2;
    const c = this.centers;
    if (this.ripples.length) {
      for (const r of this.ripples) {
        const rad = r.age * r.speed;
        const band = 70;
        const fade = (1 - r.age / r.life) * Math.min(1, r.strength);
        if (fade <= 0.02) continue;
        ctx.strokeStyle = withAlpha(r.color, 0.55 * fade);
        ctx.beginPath();
        for (let i = 0; i < c.length; i += 2) {
          const x = c[i] ?? 0;
          const y = c[i + 1] ?? 0;
          if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
          const d = Math.hypot(x - r.x, y - r.y);
          if (Math.abs(d - rad) > band) continue;
          // Add this hex to the batch path.
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            const px = x + Math.cos(a) * HEX * 0.94;
            const py = y + Math.sin(a) * HEX * 0.94;
            if (k) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.closePath();
        }
        ctx.stroke();
      }
    }
    // Faint diagonal shimmer line.
    ctx.strokeStyle = withAlpha(PAL.grid, 0.12);
    ctx.lineWidth = 60;
    ctx.beginPath();
    ctx.moveTo(sweep - R, -R);
    ctx.lineTo(sweep + R, R);
    ctx.stroke();
    ctx.restore();
  }

  /** Glowing arena edge (world space). */
  drawEdge(ctx: CanvasRenderingContext2D, time: number) {
    const v = this.arena.verts;
    const path = new Path2D();
    v.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
    ctx.save();
    // Darken outside the arena.
    ctx.fillStyle = "rgba(2,2,10,0.55)";
    const big = new Path2D();
    big.rect(-1e5, -1e5, 2e5, 2e5);
    big.addPath(path);
    ctx.fill(big, "evenodd");
    ctx.globalCompositeOperation = "lighter";
    const pulse = 0.75 + 0.25 * Math.sin(time * 2);
    ctx.strokeStyle = withAlpha(PAL.edge, 0.08 * pulse);
    ctx.lineWidth = 46;
    ctx.stroke(path);
    ctx.strokeStyle = withAlpha(PAL.edge, 0.18 * pulse);
    ctx.lineWidth = 18;
    ctx.stroke(path);
    ctx.strokeStyle = withAlpha("#d9fdff", 0.9);
    ctx.lineWidth = 3;
    ctx.stroke(path);
    // Corner nodes
    for (const p of v) {
      ctx.fillStyle = withAlpha("#ffffff", 0.9);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
