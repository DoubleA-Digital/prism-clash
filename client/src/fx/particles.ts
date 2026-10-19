// Particle pool: struct-of-arrays in typed arrays, no allocation per particle. Every
// particle is a cached glow sprite drawn additively (or a short streak for sparks).

import { FX } from "@prism/shared";
import { glowSprite } from "../render/glow";

const N = FX.maxParticles;

export const PSHAPE = { glow: 0, spark: 1, shard: 2, ring: 3 } as const;

export class Particles {
  private x = new Float32Array(N);
  private y = new Float32Array(N);
  private vx = new Float32Array(N);
  private vy = new Float32Array(N);
  private life = new Float32Array(N);
  private max = new Float32Array(N);
  private size = new Float32Array(N);
  private drag = new Float32Array(N);
  private grav = new Float32Array(N);
  private shape = new Uint8Array(N);
  private rot = new Float32Array(N);
  private spin = new Float32Array(N);
  private color: string[] = new Array<string>(N).fill("#ffffff");
  private head = 0;
  count = 0;

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, shape: number = PSHAPE.glow, drag = 2.5, grav = 0) {
    const i = this.head;
    this.head = (this.head + 1) % N;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.shape[i] = shape;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 12;
    this.color[i] = color;
  }

  /** A radial burst. */
  burst(x: number, y: number, n: number, color: string, speed: number, life: number, size: number, shape: number = PSHAPE.glow) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, shape);
    }
  }

  /** A cone of sparks around angle `dir`. */
  cone(x: number, y: number, n: number, dir: number, spread: number, color: string, speed: number, life: number, size: number) {
    for (let k = 0; k < n; k++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size, color, PSHAPE.spark, 3.5);
    }
  }

  update(dt: number) {
    let c = 0;
    for (let i = 0; i < N; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const d = Math.exp(-this.drag[i]! * dt);
      this.vx[i]! *= d;
      this.vy[i]! *= d;
      this.vy[i]! += this.grav[i]! * dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.spin[i]! * dt;
      c++;
    }
    this.count = c;
  }

  draw(ctx: CanvasRenderingContext2D, bounds: { x0: number; y0: number; x1: number; y1: number }) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < N; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      const x = this.x[i]!;
      const y = this.y[i]!;
      if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) continue;
      const t = life / this.max[i]!;
      const s = this.size[i]! * (0.4 + 0.6 * t);
      const col = this.color[i]!;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      const shape = this.shape[i]!;
      if (shape === PSHAPE.spark) {
        const vx = this.vx[i]!;
        const vy = this.vy[i]!;
        const l = Math.hypot(vx, vy) * 0.035 + s;
        const nx = vx / (Math.hypot(vx, vy) || 1);
        const ny = vy / (Math.hypot(vx, vy) || 1);
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, s * 0.5);
        ctx.beginPath();
        ctx.moveTo(x - nx * l, y - ny * l);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (shape === PSHAPE.shard) {
        ctx.fillStyle = col;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(this.rot[i]!);
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.45, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.45, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (shape === PSHAPE.ring) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, s * (1.6 - t), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const g = glowSprite(col, s);
        ctx.drawImage(g, x - s, y - s, s * 2, s * 2);
      }
    }
    ctx.restore();
  }

  clear() {
    this.life.fill(0);
  }
}
