// The in-match HUD, drawn on the canvas in screen space. Everything hugs the edges so the
// middle of the screen (the fight) stays clear. Pieces live in hudVitals.ts and hudMap.ts.

import { withAlpha } from "../render/glow";
import { PAL } from "../render/palette";
import { session } from "../net/session";
import { clamp01, DISPLAY, easeBack, easeOut, font, MONO, outlined, panel, UIFONT } from "./hudKit";
import { drawFeed, drawMinimap } from "./hudMap";
import type { HudInput } from "./hudTypes";
import { Vitals } from "./hudVitals";

export type { HudInput } from "./hudTypes";

interface Banner {
  text: string;
  sub: string;
  color: string;
  age: number;
}

const BANNER_LIFE = 2.4;

export class Hud {
  private vitals = new Vitals();
  private hurtFlash = 0;
  private banners: Banner[] = [];
  countdown: { n: number; age: number } | null = null;

  banner(text: string, sub: string, color: string) {
    this.banners.push({ text, sub, color, age: 0 });
    if (this.banners.length > 2) this.banners.shift();
  }

  selfHit() {
    this.hurtFlash = 1;
  }

  reset() {
    this.banners = [];
    this.vitals.reset();
  }

  draw(ctx: CanvasRenderingContext2D, h: HudInput) {
    ctx.save();
    ctx.setTransform(h.dpr, 0, 0, h.dpr, 0, 0);
    ctx.textBaseline = "middle";
    const W = h.w;
    const H = h.h;
    const u = Math.max(0.75, Math.min(1.3, Math.min(W / 1600, H / 900) * 1.1));

    this.drawEdges(ctx, h, W, H);
    if (h.self && h.self.alive) this.vitals.draw(ctx, h, u);
    if (h.g) this.drawTop(ctx, h, u);
    drawFeed(ctx, h, u);
    if (h.g) drawMinimap(ctx, h, u);
    this.drawBanners(ctx, h, u);
    this.drawCountdown(ctx, h, u);
    this.drawStats(ctx, h, u);
    ctx.restore();
  }

  /** Damage-taken flash plus the low-health heartbeat, both as screen-edge vignettes. */
  private drawEdges(ctx: CanvasRenderingContext2D, h: HudInput, W: number, H: number) {
    const low = h.self?.alive ? this.vitals.lowHpAmount() : 0;
    const beat = low > 0 ? low * (0.5 + 0.5 * Math.sin(h.time * (7 + low * 5))) * 0.4 : 0;
    const a = Math.max(beat, this.hurtFlash * 0.5);
    if (a > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.68);
      g.addColorStop(0, "rgba(255,0,40,0)");
      g.addColorStop(1, `rgba(255,0,40,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.hurtFlash > 0) {
      // Crisp border flash so a hit reads even in a busy fight.
      ctx.strokeStyle = `rgba(255,60,80,${this.hurtFlash * 0.7})`;
      ctx.lineWidth = 6 * this.hurtFlash;
      ctx.strokeRect(0, 0, W, H);
      this.hurtFlash = Math.max(0, this.hurtFlash - h.dt * 2.6);
    }
  }

  /** Zone timer + alive count (top center), round tag hanging below, urgent styling before a shrink. */
  private drawTop(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const g = h.g;
    if (!g) return;
    const cx = h.w / 2;
    const y = 14 * u;
    const w = 330 * u;
    const ph = 62 * u;
    const warn = g.phase === "warn" && g.remaining < 5;
    const closing = g.phase === "shrink";
    const flash = 0.5 + 0.5 * Math.sin(h.time * 12);
    const hot = warn || closing;
    // Round tab hanging under the panel
    ctx.font = font(800, 12 * u, DISPLAY);
    const rt = `ROUND ${h.round}`;
    const rw = ctx.measureText(rt).width + 28 * u;
    ctx.beginPath();
    ctx.roundRect(cx - rw / 2, y + ph - 6 * u, rw, 26 * u, [0, 0, 10 * u, 10 * u]);
    ctx.fillStyle = "rgba(10,9,30,0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(124,246,255,0.22)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = withAlpha(PAL.edge, 0.9);
    ctx.fillText(rt, cx, y + ph + 11 * u);

    panel(ctx, cx - w / 2, y, w, ph, 16 * u, {
      border: hot ? withAlpha(PAL.zone, 0.55 + 0.45 * flash) : "rgba(124,246,255,0.25)",
      glow: hot ? withAlpha(PAL.zone, 0.55 * (warn ? flash : 0.6)) : undefined,
    });
    // Divider
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(cx + 20 * u, y + 12 * u, 1.5, ph - 24 * u);

    const label = g.stage < 0 ? "ZONE CLOSES IN" : g.phase === "warn" ? (warn ? "ZONE MOVING!" : "NEXT SHRINK IN") : closing ? "ZONE CLOSING" : "FINAL ZONE";
    const lx = cx - w / 4 + 10 * u;
    ctx.font = font(700, 12 * u, UIFONT);
    ctx.fillStyle = hot ? PAL.zone : PAL.dim;
    ctx.fillText(label, lx, y + 18 * u);
    ctx.font = font(800, 28 * u, MONO);
    const color = hot ? (warn && flash > 0.5 ? "#ffffff" : PAL.zone) : "#ffffff";
    outlined(ctx, g.phase === "done" ? "—" : fmt(g.remaining), lx, y + 42 * u, color, "rgba(5,4,13,0.6)", 4 * u, hot ? PAL.zone : undefined);
    if (warn) {
      // Shrink-imminent countdown bar
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(cx - w / 2 + 16 * u, y + ph - 7 * u, w / 2 - 12 * u, 3 * u);
      ctx.fillStyle = PAL.zone;
      ctx.fillRect(cx - w / 2 + 16 * u, y + ph - 7 * u, (w / 2 - 12 * u) * clamp01(g.remaining / 5), 3 * u);
    }

    // Alive count with a pip per player
    const ax = cx + w / 4 + 6 * u;
    ctx.font = font(700, 12 * u, UIFONT);
    ctx.fillStyle = PAL.dim;
    ctx.fillText("ALIVE", ax, y + 18 * u);
    const total = Math.max(g.alive, session.playerCount);
    ctx.font = font(800, 28 * u, MONO);
    outlined(ctx, `${g.alive}`, ax - 14 * u, y + 42 * u, "#ffffff", "rgba(5,4,13,0.6)", 4 * u);
    for (let i = 0; i < total; i++) {
      const px = ax + 6 * u + i * 12 * u;
      ctx.beginPath();
      ctx.arc(px, y + 42 * u, 4 * u, 0, Math.PI * 2);
      ctx.fillStyle = i < g.alive ? "#ffffff" : "rgba(255,255,255,0.15)";
      ctx.fill();
    }
  }

  private drawBanners(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    for (const b of this.banners) b.age += h.dt;
    this.banners = this.banners.filter((b) => b.age < BANNER_LIFE);
    let y = h.h * 0.25;
    for (const b of this.banners) {
      const t = b.age / BANNER_LIFE;
      const intro = easeBack(b.age / 0.28);
      const sc = 0.55 + 0.5 * intro - Math.min(0.08, t * 0.1);
      const alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(h.w / 2, y);
      // Side streaks sweeping outward
      const reach = 220 * u * easeOut(b.age / 0.4);
      for (const side of [-1, 1]) {
        const g = ctx.createLinearGradient(side * 70 * u, 0, side * (70 * u + reach), 0);
        g.addColorStop(0, withAlpha(b.color, 0.9));
        g.addColorStop(1, withAlpha(b.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(side * 70 * u, side * (70 * u + reach)), -2 * u, reach, 4 * u);
      }
      ctx.scale(sc, sc);
      ctx.textAlign = "center";
      ctx.font = font(900, 42 * u, DISPLAY);
      outlined(ctx, b.text, 0, 0, b.color, "rgba(5,4,13,0.9)", 8 * u, b.color);
      if (b.sub) {
        ctx.font = font(700, 20 * u, UIFONT);
        outlined(ctx, b.sub, 0, 40 * u, "#ffffff", "rgba(5,4,13,0.9)", 5 * u);
      }
      ctx.restore();
      y += 96 * u;
    }
    ctx.globalAlpha = 1;
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const c = this.countdown;
    if (!c) return;
    c.age += h.dt;
    const fight = c.n <= 0;
    const text = fight ? "FIGHT!" : String(c.n);
    const t = clamp01(c.age / 0.9);
    const sc = fight ? 0.7 + 0.55 * easeBack(c.age / 0.3) : 1.7 - easeOut(c.age / 0.35) * 0.7;
    const alpha = fight ? clamp01(1 - Math.max(0, c.age - 0.6) * 2) : 1 - t * 0.7;
    const col = fight ? PAL.gold : "#ffffff";
    ctx.save();
    ctx.translate(h.w / 2, h.h / 2);
    ctx.globalAlpha = alpha;
    // Shock ring
    ctx.strokeStyle = withAlpha(fight ? PAL.gold : PAL.edge, 0.7 * (1 - t));
    ctx.lineWidth = 6 * u * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(0, 0, (70 + t * 260) * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.scale(sc, sc);
    ctx.textAlign = "center";
    ctx.font = font(900, (fight ? 104 : 130) * u, DISPLAY);
    if (fight) ctx.transform(1, 0, -0.12, 1, 0, 0);
    outlined(ctx, text, 0, 0, col, "rgba(5,4,13,0.9)", 12 * u, fight ? PAL.gold : PAL.edge);
    ctx.restore();
    if (fight && c.age > 1.3) this.countdown = null;
  }

  /** Ping / FPS pill (top left), colored by quality. */
  private drawStats(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    if (!h.showPing && !h.showFps) return;
    const parts: { text: string; color: string }[] = [];
    if (h.showPing) parts.push({ text: `${Math.round(h.ping)} ms`, color: h.ping < 70 ? PAL.heal : h.ping < 130 ? PAL.gold : PAL.danger });
    if (h.showFps) parts.push({ text: `${Math.round(h.fps)} fps`, color: h.fps > 50 ? PAL.heal : h.fps > 30 ? PAL.gold : PAL.danger });
    ctx.font = font(700, 12 * u, MONO);
    const widths = parts.map((p) => ctx.measureText(p.text).width + 22 * u);
    const total = widths.reduce((a, b) => a + b, 0) + 10 * u;
    panel(ctx, 14 * u, 14 * u, total, 26 * u, 13 * u, { border: "rgba(255,255,255,0.12)" });
    let x = 24 * u;
    ctx.textAlign = "left";
    parts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(x + 3 * u, 27 * u, 3.5 * u, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.fillStyle = "rgba(220,226,255,0.9)";
      ctx.fillText(p.text, x + 12 * u, 28 * u);
      x += widths[i] ?? 0;
    });
  }
}

function fmt(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}
