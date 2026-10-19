// Animated backdrop behind the menus: the starfield, a slowly turning arena outline,
// and five player cores chasing each other and trading shots.

import { PLAYER_COLORS } from "@prism/shared";
import { Background } from "./background";
import { drawCore } from "./core";
import { drawGlow, withAlpha } from "./glow";

interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export class MenuScene {
  private bg = new Background();
  private bolts: Bolt[] = [];
  private fireT = 0;

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, time: number, dt: number) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#05040d";
    ctx.fillRect(0, 0, w, h);
    this.bg.draw(ctx, w, h, time * 30, time * 12, time, 0.4);
    const cw = w / dpr;
    const ch = h / dpr;
    const s = Math.min(cw, ch) / 900;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, w / 2, h / 2 + ch * dpr * 0.06);
    // Rotating arena outline
    ctx.save();
    ctx.rotate(time * 0.05);
    ctx.globalCompositeOperation = "lighter";
    for (const [r, a] of [[430, 0.5], [445, 0.15]] as const) {
      ctx.strokeStyle = withAlpha("#7cf6ff", a);
      ctx.lineWidth = r === 430 ? 2.5 : 18;
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        if (i) ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        else ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
      }
      ctx.stroke();
    }
    ctx.restore();
    // Cores orbiting
    const pos = PLAYER_COLORS.map((c, i) => {
      const a = time * (0.35 + i * 0.04) + (i / 5) * Math.PI * 2;
      const r = 220 + Math.sin(time * 0.7 + i * 1.3) * 90;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75, c };
    });
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = 0.25 + Math.random() * 0.35;
      const i = Math.floor(Math.random() * 5);
      const j = (i + 1 + Math.floor(Math.random() * 4)) % 5;
      const a = pos[i];
      const b = pos[j];
      if (a && b) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.bolts.push({ x: a.x, y: a.y, vx: Math.cos(ang) * 700, vy: Math.sin(ang) * 700, life: 0.6, color: a.c.hex });
      }
    }
    for (const b of this.bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      drawGlow(ctx, b.x, b.y, 22, b.color, Math.min(1, b.life * 3));
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
    pos.forEach((p, i) => {
      const target = pos[(i + 2) % 5];
      const aim = target ? Math.atan2(target.y - p.y, target.x - p.x) : 0;
      drawCore(ctx, {
        x: p.x, y: p.y, color: p.c.hex, colorIndex: i, hp: 100, aim, time, name: "", isMe: false, alpha: 0.95, dashing: false,
        ultReady: i === Math.floor(time / 3) % 5, bountied: false, slowed: false, inverted: false, airborne: 0, invulnerable: false,
        disconnected: false, colorblind: false, invScale: 1, showBar: false,
      });
    });
  }
}
