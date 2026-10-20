// Animated backdrop behind the menus: the starfield, a slowly turning arena outline, and
// five chibi heroes circling each other and trading shots.

import { HERO_IDS, PLAYER_COLORS, type HeroId, type WeaponId } from "@prism/shared";
import { session } from "../net/session";
import { Background } from "./background";
import { CHIBI_TIMING, drawHero, idleAnim } from "./chibi";
import { drawGlow, withAlpha } from "./glow";

const CAST: { hero: HeroId; weapon: WeaponId; rarity: number }[] = [
  { hero: HERO_IDS[1] ?? "blaze", weapon: "rifle", rarity: 3 },
  { hero: HERO_IDS[4] ?? "vex", weapon: "sniper", rarity: 2 },
  { hero: HERO_IDS[3] ?? "drip", weapon: "shotgun", rarity: 1 },
  { hero: HERO_IDS[2] ?? "nova", weapon: "smg", rarity: 2 },
  { hero: HERO_IDS[5] ?? "pixel", weapon: "lance", rarity: 3 },
];
const HERO_SCALE = 1.55;

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
  /** Smoothed mouse position (-1..1) for parallax, and how "calm" the scene is (dimmed behind lobby/draft UI). */
  private mx = 0;
  private my = 0;
  private tx = 0;
  private ty = 0;
  private calm = 0;
  private walk = [0, 0, 0, 0, 0];
  private last: { x: number; y: number }[] = [];
  private shotAt = [-9, -9, -9, -9, -9];

  constructor() {
    window.addEventListener("mousemove", (e) => {
      this.tx = (e.clientX / window.innerWidth) * 2 - 1;
      this.ty = (e.clientY / window.innerHeight) * 2 - 1;
    });
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, time: number, dt: number) {
    const k = Math.min(1, dt * 4);
    this.mx += (this.tx - this.mx) * k;
    this.my += (this.ty - this.my) * k;
    this.calm += ((session.phase === "menu" ? 0 : 1) - this.calm) * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#05040d";
    ctx.fillRect(0, 0, w, h);
    this.bg.draw(ctx, w, h, time * 30 + this.mx * 90, time * 12 + this.my * 60, time, 0.4);
    const cw = w / dpr;
    const ch = h / dpr;
    const s = Math.min(cw, ch) / 900;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, w / 2 - this.mx * 26 * dpr, h / 2 + ch * dpr * 0.06 - this.my * 18 * dpr);
    // Rotating arena outline
    ctx.save();
    ctx.rotate(time * 0.05);
    ctx.globalCompositeOperation = "lighter";
    for (const [r, a] of [[430, 0.5], [445, 0.15]] as const) {
      ctx.strokeStyle = withAlpha("#7cf6ff", a * (1 - this.calm * 0.55));
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
      const r = 405 + Math.sin(time * 0.7 + i * 1.3) * 45;
      return { x: Math.cos(a) * r * 1.12, y: Math.sin(a) * r * 0.78, c };
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
        this.shotAt[i] = time;
      }
    }
    for (const b of this.bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      drawGlow(ctx, b.x, b.y, 22, b.color, Math.min(1, b.life * 3) * (1 - this.calm * 0.7));
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
    // Back to front, so the lower hero overlaps.
    const order = pos.map((p, i) => ({ p, i })).sort((u, v) => u.p.y - v.p.y);
    for (const { p, i } of order) {
      const target = pos[(i + 2) % 5];
      const aim = target ? Math.atan2(target.y - p.y, target.x - p.x) : 0;
      const prev = this.last[i] ?? p;
      const moved = Math.hypot(p.x - prev.x, p.y - prev.y);
      this.last[i] = { x: p.x, y: p.y };
      this.walk[i] = (this.walk[i] ?? 0) + (moved / HERO_SCALE) * CHIBI_TIMING.stridePerUnit;
      const cast = CAST[i];
      if (!cast) continue;
      const anim = idleAnim();
      anim.walkPhase = this.walk[i] ?? 0;
      anim.speed = dt > 0 ? moved / dt / HERO_SCALE : 0;
      const since = time - (this.shotAt[i] ?? -9);
      anim.recoilT = since < CHIBI_TIMING.recoil[cast.weapon] ? since / CHIBI_TIMING.recoil[cast.weapon] : -1;
      if (cast.weapon === "lance") anim.charge = 0.5 + 0.5 * Math.sin(time * 2 + i);
      ctx.save();
      ctx.globalAlpha = 0.95 - this.calm * 0.78;
      drawHero(ctx, { heroId: cast.hero, color: p.c.hex, x: p.x, y: p.y, aim, weapon: { id: cast.weapon, rarity: cast.rarity }, anim, scale: HERO_SCALE, time, seed: i * 7 });
      ctx.restore();
    }
  }
}
