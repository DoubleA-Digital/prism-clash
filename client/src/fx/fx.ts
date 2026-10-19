// Client-only "juice": damage numbers, shockwave rings, floating labels, hit-stop, and the
// chromatic flash. None of this touches the simulation; it only changes what you see.

import { FX } from "@prism/shared";
import { withAlpha } from "../render/glow";
import { Particles } from "./particles";

interface Num {
  x: number;
  y: number;
  vx: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  age: number;
  life: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  age: number;
  life: number;
  color: string;
  width: number;
}

interface Label {
  x: number;
  y: number;
  text: string;
  sub: string;
  color: string;
  age: number;
  life: number;
  big: boolean;
}

export class Fx {
  particles = new Particles();
  private nums: Num[] = [];
  private rings: Ring[] = [];
  private labels: Label[] = [];
  /** Seconds of render freeze left (hit-stop). */
  hitStop = 0;
  /** 0..1 chromatic aberration strength. */
  chroma = 0;
  /** Full-screen color flash (0..1) and its color. */
  flash = 0;
  flashColor = "#ffffff";
  /** Slow-motion multiplier (replays). */
  timeScale = 1;

  damage(x: number, y: number, amount: number, crit: boolean, color: string) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
    const sp = crit ? 260 : 200;
    this.nums.push({
      x: x + (Math.random() - 0.5) * 16, y: y - 20, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, text: String(Math.max(1, Math.round(amount))),
      color: crit ? "#ffd34d" : color, size: crit ? 34 : Math.min(30, 19 + amount * 0.3), age: 0, life: crit ? 1.05 : 0.8,
    });
    if (this.nums.length > 60) this.nums.shift();
  }

  ring(x: number, y: number, r0: number, r1: number, life: number, color: string, width = 4) {
    this.rings.push({ x, y, r0, r1, age: 0, life, color, width });
    if (this.rings.length > 80) this.rings.shift();
  }

  label(x: number, y: number, text: string, sub: string, color: string, big = false) {
    this.labels.push({ x, y, text, sub, color, age: 0, life: big ? 1.8 : 1.4, big });
  }

  stop(seconds: number) {
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  aberrate(strength = 1) {
    this.chroma = Math.max(this.chroma, strength);
  }

  screenFlash(color: string, strength: number) {
    this.flashColor = color;
    this.flash = Math.max(this.flash, strength);
  }

  update(dt: number) {
    this.particles.update(dt);
    for (const n of this.nums) {
      n.age += dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.vy += 620 * dt;
      n.vx *= Math.exp(-3 * dt);
    }
    this.nums = this.nums.filter((n) => n.age < n.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const l of this.labels) {
      l.age += dt;
      l.y -= 26 * dt;
    }
    this.labels = this.labels.filter((l) => l.age < l.life);
    this.chroma = Math.max(0, this.chroma - dt / (FX.chromaticMs / 1000));
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  /** World-space layer drawn above entities. */
  drawWorld(ctx: CanvasRenderingContext2D, bounds: { x0: number; y0: number; x1: number; y1: number }, invScale: number) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const r of this.rings) {
      const t = r.age / r.life;
      const e = 1 - (1 - t) * (1 - t);
      ctx.strokeStyle = withAlpha(r.color, (1 - t) * 0.9);
      ctx.lineWidth = r.width * (1 - t * 0.7);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    this.particles.draw(ctx, bounds);

    // Text is sized in screen pixels so it stays readable at any zoom.
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const n of this.nums) {
      const t = n.age / n.life;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.7 : 1.3 - Math.min(0.3, (t - 0.12) * 1.2);
      const s = n.size * pop * invScale;
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      ctx.font = `900 ${s}px Orbitron, system-ui, sans-serif`;
      ctx.lineWidth = s * 0.18;
      ctx.strokeStyle = "rgba(5,4,13,0.85)";
      ctx.strokeText(n.text, n.x, n.y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, n.x, n.y);
    }
    for (const l of this.labels) {
      const t = l.age / l.life;
      const sc = (t < 0.1 ? 0.5 + t * 6 : 1.1 - Math.min(0.1, t * 0.1)) * invScale;
      ctx.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
      const size = (l.big ? 34 : 24) * sc;
      ctx.font = `900 ${size}px Orbitron, system-ui, sans-serif`;
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = "rgba(5,4,13,0.9)";
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
      if (l.sub) {
        ctx.font = `700 ${size * 0.5}px Rajdhani, system-ui, sans-serif`;
        ctx.lineWidth = size * 0.1;
        ctx.strokeText(l.sub, l.x, l.y + size * 0.85);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(l.sub, l.x, l.y + size * 0.85);
      }
    }
    ctx.restore();
  }

  clear() {
    this.particles.clear();
    this.nums = [];
    this.rings = [];
    this.labels = [];
    this.hitStop = 0;
    this.chroma = 0;
    this.flash = 0;
  }
}
