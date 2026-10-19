// Bottom-of-screen HUD: health (with delayed white damage bar and low-HP pulse), ammo pips,
// dash readiness, the power slots with radial cooldown sweeps, and the ultimate meter.

import { PLAYER, SHOT, powerDef, type PowerId, type UltId } from "@prism/shared";
import { drawShapeMarker } from "../render/core";
import { withAlpha } from "../render/glow";
import { colorHex, PAL } from "../render/palette";
import { keyLabel } from "../input/input";
import { clamp01, DISPLAY, font, keycap, MONO, outlined, panel, UIFONT } from "./hudKit";
import type { HudInput } from "./hudTypes";
import { iconCanvas, powerInfo } from "./icons";

interface SlotState {
  prevCd: number;
  flash: number;
  maxCd: number;
}

export class Vitals {
  private shownHp = 100;
  private lagHp = 100;
  private slotState: SlotState[] = [];
  private ultWasReady = false;
  private ultFlash = 0;

  reset() {
    this.shownHp = 100;
    this.lagHp = 100;
    this.slotState = [];
    this.ultWasReady = false;
    this.ultFlash = 0;
  }

  /** 0..1 how close to death the local player is (drives the screen-edge heartbeat). */
  lowHpAmount(): number {
    return clamp01((35 - this.shownHp) / 35);
  }

  draw(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    this.drawHealth(ctx, h, u);
    this.drawPowers(ctx, h, u);
  }

  private drawHealth(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const self = h.self;
    if (!self) return;
    const hp = Math.max(0, self.hp);
    this.shownHp += (hp - this.shownHp) * Math.min(1, h.dt * 18);
    if (hp > this.lagHp) this.lagHp = hp;
    else this.lagHp += (hp - this.lagHp) * Math.min(1, h.dt * 1.6);
    const myIdx = h.colors(h.myId);
    const myCol = colorHex(myIdx);
    const low = this.lowHpAmount();
    const pulse = 0.5 + 0.5 * Math.sin(h.time * (6 + low * 6));
    const x = 26 * u;
    const w = 340 * u;
    const ph = 112 * u;
    const y = h.h - ph - 22 * u;
    panel(ctx, x - 14 * u, y, w + 28 * u, ph, 16 * u, {
      border: low > 0 ? withAlpha(PAL.danger, 0.45 + 0.5 * pulse * low) : withAlpha(myCol, 0.45),
      glow: low > 0 ? withAlpha(PAL.danger, 0.5 * pulse * low) : withAlpha(myCol, 0.22),
    });
    // Name + shape marker
    const ny = y + 22 * u;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let nx = x;
    if (h.colorblind) {
      drawShapeMarker(ctx, nx + 7 * u, ny, 6 * u, myIdx);
      nx += 20 * u;
    } else {
      ctx.fillStyle = myCol;
      ctx.shadowColor = myCol;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(nx + 6 * u, ny, 5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      nx += 20 * u;
    }
    ctx.font = font(800, 14 * u, DISPLAY);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(h.names(h.myId).toUpperCase().slice(0, 14), nx, ny + 1);

    // Health bar
    const by = y + 36 * u;
    const bh = 28 * u;
    const r = 9 * u;
    ctx.beginPath();
    ctx.roundRect(x, by, w, bh, r);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, by, w, bh, r);
    ctx.clip();
    // Delayed white bar, then the real bar on top.
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(x, by, w * clamp01(this.lagHp / PLAYER.maxHp), bh);
    const frac = clamp01(this.shownHp / PLAYER.maxHp);
    const base = frac > 0.5 ? myCol : frac > 0.25 ? PAL.gold : PAL.danger;
    const g = ctx.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, withAlpha(base, 1));
    g.addColorStop(1, withAlpha(base, 0.62));
    ctx.fillStyle = g;
    ctx.fillRect(x, by, w * frac, bh);
    // Gloss + leading edge
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(x, by, w * frac, bh * 0.4);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(x + w * frac - 2 * u, by, 2 * u, bh);
    if (low > 0) {
      ctx.fillStyle = `rgba(255,40,70,${0.35 * pulse * low})`;
      ctx.fillRect(x, by, w, bh);
    }
    ctx.strokeStyle = "rgba(5,4,13,0.55)";
    ctx.lineWidth = 2 * u;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (w * i) / 4, by);
      ctx.lineTo(x + (w * i) / 4, by + bh);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(x, by, w, bh, r);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.font = font(800, 19 * u, MONO);
    outlined(ctx, `${Math.ceil(hp)}`, x + w - 10 * u, by + bh / 2 + 1, "#ffffff", "rgba(5,4,13,0.8)", 4 * u);

    // Ammo pips
    const ay = by + bh + 22 * u;
    ctx.textAlign = "left";
    ctx.font = font(700, 12 * u, UIFONT);
    ctx.fillStyle = PAL.dim;
    ctx.fillText("AMMO", x, ay);
    const pw = 27 * u;
    const gap = 5 * u;
    for (let i = 0; i < SHOT.ammoMax; i++) {
      const px = x + 46 * u + i * (pw + gap);
      const full = i < h.ammo.ammo;
      const filling = i === h.ammo.ammo;
      ctx.beginPath();
      ctx.roundRect(px, ay - 7 * u, pw, 14 * u, 5 * u);
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fill();
      if (full || filling) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(px, ay - 7 * u, pw, 14 * u, 5 * u);
        ctx.clip();
        ctx.fillStyle = full ? myCol : withAlpha(myCol, 0.5);
        if (full) {
          ctx.shadowColor = myCol;
          ctx.shadowBlur = 8;
        }
        ctx.fillRect(px, ay - 7 * u, pw * (full ? 1 : clamp01(h.ammo.reload)), 14 * u);
        ctx.restore();
      }
    }
    // Dash readiness
    const dx = x + 46 * u + SHOT.ammoMax * (pw + gap) + 10 * u;
    const dw = x + w - dx;
    const ready = self.dashCd <= 0;
    const f = ready ? 1 : 1 - self.dashCd / PLAYER.dash.cooldown;
    ctx.beginPath();
    ctx.roundRect(dx, ay - 9 * u, dw, 18 * u, 9 * u);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, ay - 9 * u, dw, 18 * u, 9 * u);
    ctx.clip();
    ctx.fillStyle = ready ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.35)";
    if (ready) {
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 10;
    }
    ctx.fillRect(dx, ay - 9 * u, dw * clamp01(f), 18 * u);
    ctx.restore();
    ctx.textAlign = "center";
    ctx.font = font(800, 11 * u, DISPLAY);
    ctx.fillStyle = ready ? "#0a0820" : "#ffffff";
    ctx.fillText(`DASH · ${keyLabel(h.input.binds.dash).toUpperCase()}`, dx + dw / 2, ay + 1);
  }

  private drawPowers(ctx: CanvasRenderingContext2D, h: HudInput, u: number) {
    const self = h.self;
    if (!self) return;
    const size = 70 * u;
    const gap = 14 * u;
    const ultSize = 84 * u;
    const keys = [h.input.binds.p1, h.input.binds.p2, h.input.binds.p3];
    interface Slot { id: PowerId | UltId | null; cd: number; recast: boolean; key: string; ult: number | null; index: number }
    const slots: Slot[] = [];
    self.slots.forEach((s, i) => {
      if (i === 2 && !s) return;
      slots.push({ id: s?.id ?? null, cd: s?.cd ?? 0, recast: (s?.recast ?? 0) > 0, key: keyLabel(keys[i] ?? ""), ult: null, index: i });
    });
    if (self.ult) slots.push({ id: self.ult.id, cd: 0, recast: false, key: keyLabel(h.input.binds.ult), ult: self.ult.charge, index: 9 });
    const widths = slots.map((s) => (s.ult !== null ? ultSize : size));
    const total = widths.reduce((a, b) => a + b, 0) + (slots.length - 1) * gap;
    let x = h.w / 2 - total / 2;
    const baseY = h.h - 30 * u;
    for (const [n, s] of slots.entries()) {
      const isUlt = s.ult !== null;
      const sz = isUlt ? ultSize : size;
      const y = baseY - sz;
      const cx = x + sz / 2;
      const cy = y + sz / 2;
      const color = s.id ? powerInfo(s.id).color : "#ffffff";
      const ready = isUlt ? (s.ult ?? 0) >= 100 : s.cd <= 0;
      const st = (this.slotState[s.index] ??= { prevCd: 0, flash: 0, maxCd: 1 });
      if (!isUlt) {
        if (s.cd > st.prevCd + 0.05) st.maxCd = Math.max(s.cd, powerDef(s.id as PowerId)?.cooldown ?? s.cd);
        if (st.prevCd > 0 && s.cd <= 0 && s.id) st.flash = 1;
        st.prevCd = s.cd;
      } else if (ready && !this.ultWasReady) {
        this.ultFlash = 1;
      }
      if (isUlt) this.ultWasReady = ready;
      st.flash = Math.max(0, st.flash - h.dt * 2.6);
      const pulse = 0.5 + 0.5 * Math.sin(h.time * 5.5 + n);

      ctx.save();
      // Ready glow
      if (ready && s.id) {
        ctx.shadowColor = isUlt ? PAL.gold : color;
        ctx.shadowBlur = isUlt ? 22 + 16 * pulse : 14;
      }
      ctx.beginPath();
      if (isUlt) ctx.arc(cx, cy, sz / 2, 0, Math.PI * 2);
      else ctx.roundRect(x, y, sz, sz, 16 * u);
      const bg = ctx.createLinearGradient(0, y, 0, y + sz);
      bg.addColorStop(0, "rgba(26,24,70,0.92)");
      bg.addColorStop(1, "rgba(7,6,22,0.94)");
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = (isUlt && ready ? 4 : 2.5) * u;
      ctx.strokeStyle = !s.id ? "rgba(255,255,255,0.14)" : ready ? (isUlt ? withAlpha(PAL.gold, 0.7 + 0.3 * pulse) : color) : "rgba(255,255,255,0.18)";
      if (!s.id) ctx.setLineDash([6 * u, 5 * u]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.clip();
      if (s.id) {
        const icon = iconCanvas(s.id, Math.round(sz * 0.8));
        ctx.globalAlpha = ready ? 1 : 0.38;
        ctx.drawImage(icon, cx - sz * 0.4, cy - sz * 0.4, sz * 0.8, sz * 0.8);
        ctx.globalAlpha = 1;
      }
      if (isUlt) {
        const fr = clamp01((s.ult ?? 0) / 100);
        if (fr < 1) {
          // Charging: dark fill drains upward as charge rises.
          ctx.fillStyle = "rgba(5,4,13,0.6)";
          ctx.fillRect(x, y, sz, sz * (1 - fr));
          ctx.font = font(800, 15 * u, MONO);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          outlined(ctx, `${Math.floor(fr * 100)}%`, cx, cy, "#ffffff", "rgba(5,4,13,0.85)", 4 * u);
        }
      } else if (!ready && s.id) {
        // Radial cooldown sweep: the dark wedge shrinks clockwise as the cooldown runs out.
        const fr = clamp01(s.cd / Math.max(0.1, st.maxCd));
        ctx.fillStyle = "rgba(5,4,13,0.66)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, sz, -Math.PI / 2, -Math.PI / 2 + fr * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2 * u;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(-Math.PI / 2 + fr * Math.PI * 2) * sz, cy + Math.sin(-Math.PI / 2 + fr * Math.PI * 2) * sz);
        ctx.stroke();
        ctx.font = font(800, 22 * u, MONO);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        outlined(ctx, s.cd >= 10 ? `${Math.ceil(s.cd)}` : s.cd.toFixed(1), cx, cy + 1, "#ffffff", "rgba(5,4,13,0.9)", 5 * u);
      }
      ctx.restore();

      // Ultimate ring (progress) and ready burst
      if (isUlt) {
        const fr = clamp01((s.ult ?? 0) / 100);
        ctx.lineWidth = 5 * u;
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.beginPath();
        ctx.arc(cx, cy, sz / 2 + 6 * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = PAL.gold;
        ctx.shadowColor = PAL.gold;
        ctx.shadowBlur = ready ? 18 : 8;
        ctx.beginPath();
        ctx.arc(cx, cy, sz / 2 + 6 * u, -Math.PI / 2, -Math.PI / 2 + fr * Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (ready) {
          const t = (h.time * 0.9) % 1;
          ctx.strokeStyle = withAlpha(PAL.gold, 0.55 * (1 - t));
          ctx.lineWidth = 3 * u;
          ctx.beginPath();
          ctx.arc(cx, cy, sz / 2 + (6 + t * 22) * u, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = font(900, 12 * u, DISPLAY);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          outlined(ctx, "ULT READY", cx, y - 22 * u, PAL.gold, "rgba(5,4,13,0.9)", 4 * u, PAL.gold);
        }
        if (this.ultFlash > 0) {
          ctx.strokeStyle = withAlpha("#ffffff", this.ultFlash);
          ctx.lineWidth = 6 * u;
          ctx.beginPath();
          ctx.arc(cx, cy, sz / 2 + (6 + (1 - this.ultFlash) * 40) * u, 0, Math.PI * 2);
          ctx.stroke();
          this.ultFlash = Math.max(0, this.ultFlash - h.dt * 2);
        }
      } else if (st.flash > 0 && s.id) {
        // "Ready again" pop
        const k = 1 - st.flash;
        ctx.strokeStyle = withAlpha(color, st.flash);
        ctx.lineWidth = 4 * u;
        ctx.beginPath();
        ctx.roundRect(x - k * 12 * u, y - k * 12 * u, sz + k * 24 * u, sz + k * 24 * u, (16 + k * 10) * u);
        ctx.stroke();
      }
      // Recast prompt
      if (s.recast) {
        const bob = Math.sin(h.time * 8) * 2 * u;
        ctx.font = font(900, 12 * u, DISPLAY);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        outlined(ctx, "RECAST", cx, y - 14 * u + bob, PAL.gold, "rgba(5,4,13,0.9)", 4 * u, PAL.gold);
        ctx.strokeStyle = withAlpha(PAL.gold, 0.6 + 0.4 * pulse);
        ctx.lineWidth = 3 * u;
        ctx.beginPath();
        ctx.roundRect(x - 3 * u, y - 3 * u, sz + 6 * u, sz + 6 * u, 18 * u);
        ctx.stroke();
      }
      keycap(ctx, s.key.toUpperCase(), cx, y + sz + 4 * u, u, ready && s.id ? (isUlt ? PAL.gold : color) : "#8a90c0");
      x += sz + gap;
    }
  }
}
