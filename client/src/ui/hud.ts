// The in-match HUD, drawn on the canvas in screen space. Everything hugs the edges so the
// middle of the screen (the fight) stays clear.

import { FX, hasStatusBit, PFLAG, PLAYER, powerDef, SHOT, type NetGlobal, type NetPlayer, type NetSelf, type SourceId, type PowerId, type UltId } from "@prism/shared";
import type { KillFeedItem } from "../fx/events";
import { drawShapeMarker } from "../render/core";
import { withAlpha } from "../render/glow";
import { colorHex, PAL } from "../render/palette";
import { iconCanvas } from "./icons";
import { keyLabel, type Input } from "../input/input";

export interface HudInput {
  w: number;
  h: number;
  dpr: number;
  self: NetSelf | null;
  ammo: { ammo: number; reload: number };
  g: NetGlobal | null;
  players: NetPlayer[];
  myId: number;
  meX: number;
  meY: number;
  arenaRadius: number;
  names: (id: number) => string;
  colors: (id: number) => number;
  killFeed: KillFeedItem[];
  ping: number;
  showPing: boolean;
  fps: number;
  showFps: boolean;
  time: number;
  dt: number;
  input: Input;
  colorblind: boolean;
  /** Players the minimap may reveal (fired recently). */
  revealed: Set<number>;
  huntersEye: boolean;
  round: number;
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  age: number;
}

export class Hud {
  private shownHp = 100;
  private lagHp = 100;
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
    this.shownHp = 100;
    this.lagHp = 100;
  }

  draw(ctx: CanvasRenderingContext2D, h: HudInput) {
    ctx.save();
    ctx.setTransform(h.dpr, 0, 0, h.dpr, 0, 0);
    const W = h.w;
    const H = h.h;
    const u = Math.max(0.75, Math.min(1.25, Math.min(W / 1600, H / 900) * 1.1));

    if (this.hurtFlash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(255,0,40,0)");
      g.addColorStop(1, `rgba(255,0,40,${0.35 * this.hurtFlash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      this.hurtFlash = Math.max(0, this.hurtFlash - h.dt * 2.5);
    }

    if (h.self && h.self.alive) {
      this.drawVitals(ctx, h, u);
      this.drawPowers(ctx, h, u);
    }
    if (h.g) this.drawTop(ctx, h, u);
    this.drawFeed(ctx, h, u);
    if (h.g) this.drawMinimap(ctx, h, u);
    this.drawBanners(ctx, h, u);
    this.drawCountdown(ctx, h, u);
    if (h.showPing || h.showFps) {
      ctx.font = `600 ${12 * u}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = "rgba(200,210,255,0.7)";
      ctx.textAlign = "left";
      const parts = [];
      if (h.showPing) parts.push(`${Math.round(h.ping)} ms`);
      if (h.showFps) parts.push(`${Math.round(h.fps)} fps`);
      ctx.fillText(parts.join("  ·  "), 14 * u, 22 * u);
    }
    ctx.restore();
  }

  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = "rgba(8,7,26,0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(124,246,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawVitals(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const self = h.self;
    if (!self) return;
    const hp = Math.max(0, self.hp);
    this.shownHp += (hp - this.shownHp) * Math.min(1, h.dt * 18);
    if (hp > this.lagHp) this.lagHp = hp;
    else this.lagHp += (hp - this.lagHp) * Math.min(1, h.dt * 1.8);
    const x = 24 * u;
    const y = h.h - 108 * u;
    const w = 330 * u;
    this.panel(ctx, x - 12 * u, y - 16 * u, w + 24 * u, 96 * u, 14 * u);
    const myCol = colorHex(h.colors(h.myId));
    // Health bar with delayed white "damage taken" bar
    const bh = 22 * u;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, bh, 6 * u);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(x, y, w * Math.min(1, this.lagHp / PLAYER.maxHp), bh, 6 * u);
    ctx.fill();
    const frac = Math.min(1, this.shownHp / PLAYER.maxHp);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    const c = frac > 0.5 ? myCol : frac > 0.25 ? PAL.gold : PAL.danger;
    g.addColorStop(0, withAlpha(c, 0.85));
    g.addColorStop(1, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, w * frac, bh, 6 * u);
    ctx.fill();
    // Segment ticks every 25 hp
    ctx.strokeStyle = "rgba(5,4,13,0.6)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (w * i) / 4, y);
      ctx.lineTo(x + (w * i) / 4, y + bh);
      ctx.stroke();
    }
    ctx.font = `700 ${16 * u}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.ceil(hp)}`, x + w - 8 * u, y + bh / 2 + 1);
    // Ammo pips
    const ay = y + bh + 18 * u;
    ctx.textAlign = "left";
    ctx.font = `700 ${11 * u}px Rajdhani, system-ui`;
    ctx.fillStyle = PAL.dim;
    ctx.fillText("AMMO", x, ay);
    const pw = 34 * u;
    for (let i = 0; i < SHOT.ammoMax; i++) {
      const px = x + 44 * u + i * (pw + 6 * u);
      const full = i < h.ammo.ammo;
      const filling = i === h.ammo.ammo;
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.beginPath();
      ctx.roundRect(px, ay - 5 * u, pw, 10 * u, 4 * u);
      ctx.fill();
      if (full || filling) {
        ctx.fillStyle = full ? myCol : withAlpha(myCol, 0.45);
        ctx.beginPath();
        ctx.roundRect(px, ay - 5 * u, pw * (full ? 1 : h.ammo.reload), 10 * u, 4 * u);
        ctx.fill();
      }
    }
    // Dash pip
    const dy = ay + 22 * u;
    ctx.fillStyle = PAL.dim;
    ctx.fillText(`DASH · ${keyLabel(h.input.binds.dash)}`, x, dy);
    const ready = self.dashCd <= 0;
    const dw = 120 * u;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.roundRect(x + 110 * u, dy - 4 * u, dw, 8 * u, 4 * u);
    ctx.fill();
    ctx.fillStyle = ready ? "#ffffff" : withAlpha("#ffffff", 0.5);
    ctx.beginPath();
    ctx.roundRect(x + 110 * u, dy - 4 * u, dw * (ready ? 1 : 1 - self.dashCd / PLAYER.dash.cooldown), 8 * u, 4 * u);
    ctx.fill();
  }

  private drawPowers(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const self = h.self;
    if (!self) return;
    const size = 64 * u;
    const gap = 14 * u;
    const slots: { id: PowerId | UltId | null; cd: number; max: number; key: string; recast: boolean; ult?: number }[] = [];
    const keys = [h.input.binds.p1, h.input.binds.p2, h.input.binds.p3];
    self.slots.forEach((s, i) => {
      if (i === 2 && !s) return;
      slots.push({ id: s?.id ?? null, cd: s?.cd ?? 0, max: 1, key: keyLabel(keys[i] ?? ""), recast: (s?.recast ?? 0) > 0 });
    });
    if (self.ult) slots.push({ id: self.ult.id, cd: 0, max: 1, key: keyLabel(h.input.binds.ult), recast: false, ult: self.ult.charge });
    const total = slots.length * size + (slots.length - 1) * gap;
    let x = h.w / 2 - total / 2;
    const y = h.h - size - 26 * u;
    for (const s of slots) {
      const cx = x + size / 2;
      const cy = y + size / 2;
      const isUlt = s.ult !== undefined;
      const ready = isUlt ? (s.ult ?? 0) >= 100 : s.cd <= 0;
      ctx.save();
      ctx.beginPath();
      if (isUlt) ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      else ctx.roundRect(x, y, size, size, 14 * u);
      ctx.fillStyle = "rgba(8,7,26,0.82)";
      ctx.fill();
      const pulse = 0.5 + 0.5 * Math.sin(h.time * 6);
      ctx.strokeStyle = isUlt && ready ? withAlpha(PAL.gold, 0.6 + 0.4 * pulse) : ready ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.15)";
      ctx.lineWidth = isUlt && ready ? 4 * u : 2 * u;
      ctx.stroke();
      ctx.clip();
      if (s.id) {
        const icon = iconCanvas(s.id, Math.round(size * 0.78));
        ctx.globalAlpha = ready ? 1 : 0.4;
        ctx.drawImage(icon, cx - size * 0.39, cy - size * 0.39, size * 0.78, size * 0.78);
        ctx.globalAlpha = 1;
      }
      // Radial cooldown sweep / ult charge
      if (isUlt) {
        const f = Math.min(1, (s.ult ?? 0) / 100);
        if (f < 1) {
          ctx.fillStyle = "rgba(5,4,13,0.55)";
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, size, -Math.PI / 2 + f * Math.PI * 2, Math.PI * 1.5);
          ctx.closePath();
          ctx.fill();
        }
      } else if (!ready && s.id) {
        const def = s.cd;
        const max = maxCooldown(s.id);
        const f = Math.min(1, def / max);
        ctx.fillStyle = "rgba(5,4,13,0.62)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, size, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.font = `700 ${20 * u}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(def >= 10 ? `${Math.ceil(def)}` : def.toFixed(1), cx, cy);
      }
      ctx.restore();
      if (isUlt) {
        ctx.strokeStyle = PAL.gold;
        ctx.lineWidth = 4 * u;
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2 + 4 * u, -Math.PI / 2, -Math.PI / 2 + Math.min(1, (s.ult ?? 0) / 100) * Math.PI * 2);
        ctx.stroke();
      }
      if (s.recast) {
        ctx.font = `800 ${11 * u}px Rajdhani, system-ui`;
        ctx.fillStyle = PAL.gold;
        ctx.textAlign = "center";
        ctx.fillText("RECAST", cx, y - 8 * u);
      }
      // Key label
      ctx.font = `800 ${12 * u}px "JetBrains Mono", ui-monospace, monospace`;
      const kw = Math.max(20 * u, ctx.measureText(s.key).width + 10 * u);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.roundRect(cx - kw / 2, y + size - 9 * u, kw, 18 * u, 5 * u);
      ctx.fill();
      ctx.fillStyle = "#05040d";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.key, cx, y + size + 0.5);
      x += size + gap;
    }
  }

  private drawTop(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const g = h.g;
    if (!g) return;
    const cx = h.w / 2;
    const y = 16 * u;
    this.panel(ctx, cx - 150 * u, y, 300 * u, 54 * u, 12 * u);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${11 * u}px Rajdhani, system-ui`;
    ctx.fillStyle = PAL.dim;
    const label = g.stage < 0 ? "ZONE CLOSES IN" : g.phase === "warn" ? "ZONE SHRINKS IN" : g.phase === "shrink" ? "ZONE CLOSING" : "FINAL ZONE";
    ctx.fillText(label, cx - 70 * u, y + 17 * u);
    ctx.font = `700 ${22 * u}px "JetBrains Mono", ui-monospace, monospace`;
    const urgent = g.phase === "warn" && g.remaining < 4;
    ctx.fillStyle = g.phase === "shrink" || urgent ? PAL.zone : "#ffffff";
    ctx.fillText(g.phase === "done" ? "—" : fmt(g.remaining), cx - 70 * u, y + 37 * u);
    ctx.font = `800 ${11 * u}px Rajdhani, system-ui`;
    ctx.fillStyle = PAL.dim;
    ctx.fillText("ALIVE", cx + 70 * u, y + 17 * u);
    ctx.font = `700 ${22 * u}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${g.alive}`, cx + 70 * u, y + 37 * u);
    ctx.font = `800 ${11 * u}px Rajdhani, system-ui`;
    ctx.fillStyle = withAlpha(PAL.edge, 0.8);
    ctx.fillText(`ROUND ${h.round}`, cx, y + 64 * u);
  }

  private drawFeed(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const now = performance.now();
    let y = 22 * u;
    const x = h.w - 20 * u;
    ctx.textBaseline = "middle";
    for (const k of h.killFeed) {
      const age = (now - k.at) / 1000;
      if (age > 7) continue;
      const a = age > 6 ? 7 - age : 1;
      ctx.globalAlpha = a;
      ctx.font = `700 ${15 * u}px Rajdhani, system-ui`;
      const killer = k.killer ? h.names(k.killer) : sourceLabel(k.source);
      const victim = h.names(k.victim);
      const wv = ctx.measureText(victim).width;
      const wk = ctx.measureText(killer).width;
      const iconW = 22 * u;
      const total = wk + wv + iconW + 40 * u;
      this.panel(ctx, x - total, y - 14 * u, total, 28 * u, 8 * u);
      ctx.textAlign = "right";
      ctx.fillStyle = colorHex(h.colors(k.victim));
      ctx.fillText(victim, x - 10 * u, y);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("⟶", x - 14 * u - wv, y);
      const ix = x - 30 * u - wv - iconW;
      if (k.source !== "shot" && k.source !== "zone" && k.source !== "wall" && k.source !== "haunt" && k.source !== "combo") {
        ctx.drawImage(iconCanvas(k.source as PowerId, Math.round(iconW)), ix, y - iconW / 2, iconW, iconW);
      } else {
        ctx.fillStyle = PAL.dim;
        ctx.beginPath();
        ctx.arc(ix + iconW / 2, y, 4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = k.killer ? colorHex(h.colors(k.killer)) : PAL.zone;
      ctx.fillText(killer, ix - 6 * u, y);
      if (h.myId === k.killer || h.myId === k.victim) {
        ctx.strokeStyle = withAlpha("#ffffff", 0.6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x - total, y - 14 * u, total, 28 * u, 8 * u);
        ctx.stroke();
      }
      y += 34 * u;
    }
    ctx.globalAlpha = 1;
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const g = h.g;
    if (!g) return;
    const size = 180 * u;
    const x0 = h.w - size - 22 * u;
    const y0 = h.h - size - 22 * u;
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const sc = (size / 2 - 6 * u) / h.arenaRadius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8,7,26,0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(124,246,255,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();
    // Arena 12-gon
    ctx.strokeStyle = "rgba(124,246,255,0.4)";
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
    // Zone
    if (g.zr < 6000) {
      ctx.strokeStyle = PAL.zone;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + g.zx * sc, cy + g.zy * sc, Math.max(1, g.zr * sc), 0, Math.PI * 2);
      ctx.stroke();
      if (g.phase === "warn") {
        ctx.strokeStyle = PAL.zoneSafe;
        ctx.setLineDash([4, 4]);
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
      const visible = me || h.huntersEye || ((d < FX.minimapRange || h.revealed.has(p.id)) && !cloaked);
      if (!visible) continue;
      const px = cx + (me ? h.meX : p.x) * sc;
      const py = cy + (me ? h.meY : p.y) * sc;
      ctx.fillStyle = colorHex(p.color);
      if (h.colorblind) drawShapeMarker(ctx, px, py, 4.5 * u, p.color);
      else {
        ctx.beginPath();
        ctx.arc(px, py, (me ? 5 : 4) * u, 0, Math.PI * 2);
        ctx.fill();
      }
      if (me) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 7 * u, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawBanners(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    for (const b of this.banners) b.age += h.dt;
    this.banners = this.banners.filter((b) => b.age < 2.2);
    let y = h.h * 0.24;
    for (const b of this.banners) {
      const t = b.age / 2.2;
      const sc = t < 0.08 ? 0.6 + (t / 0.08) * 0.5 : 1.1 - Math.min(0.1, (t - 0.08) * 0.4);
      ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${40 * u * sc}px Orbitron, system-ui`;
      ctx.lineWidth = 7 * u;
      ctx.strokeStyle = "rgba(5,4,13,0.85)";
      ctx.strokeText(b.text, h.w / 2, y);
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 24;
      ctx.fillText(b.text, h.w / 2, y);
      ctx.shadowBlur = 0;
      if (b.sub) {
        ctx.font = `700 ${20 * u}px Rajdhani, system-ui`;
        ctx.lineWidth = 4 * u;
        ctx.strokeText(b.sub, h.w / 2, y + 38 * u);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(b.sub, h.w / 2, y + 38 * u);
      }
      y += 90 * u;
    }
    ctx.globalAlpha = 1;
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const c = this.countdown;
    if (!c) return;
    c.age += h.dt;
    const text = c.n > 0 ? String(c.n) : "FIGHT!";
    const t = Math.min(1, c.age / 0.9);
    const sc = 1.6 - t * 0.6;
    ctx.globalAlpha = c.n > 0 ? 1 - t * 0.6 : Math.max(0, 1 - Math.max(0, c.age - 0.5) * 1.6);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${120 * u * sc}px Orbitron, system-ui`;
    ctx.lineWidth = 10 * u;
    ctx.strokeStyle = "rgba(5,4,13,0.85)";
    ctx.strokeText(text, h.w / 2, h.h / 2);
    const col = c.n > 0 ? "#ffffff" : PAL.gold;
    ctx.fillStyle = col;
    ctx.shadowColor = c.n > 0 ? PAL.edge : PAL.gold;
    ctx.shadowBlur = 40;
    ctx.fillText(text, h.w / 2, h.h / 2);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (c.n <= 0 && c.age > 1.2) this.countdown = null;
  }
}

function fmt(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

function sourceLabel(s: SourceId): string {
  if (s === "zone") return "ZONE";
  if (s === "haunt") return "HAUNT";
  return "???";
}

function maxCooldown(id: PowerId | UltId): number {
  return powerDef(id as PowerId)?.cooldown ?? 10;
}
