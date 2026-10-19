// In-match reticle (replaces the OS cursor): ammo segments around the crosshair with the
// reload filling in, a hitmarker that flashes when your shot lands (gold for crits, red X
// for kills), and a faint aim guide out to your shot's range. Screen space.

import { SHOT } from "@prism/shared";
import { withAlpha } from "../render/glow";

export class Reticle {
  private hit = 0;
  private crit = false;
  private kill = 0;
  private recoil = 0;

  onHit(crit: boolean) {
    this.hit = 1;
    this.crit = crit;
  }

  onKill() {
    this.kill = 1;
  }

  onShoot() {
    this.recoil = 1;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    o: { dpr: number; mx: number; my: number; px: number; py: number; scale: number; ammo: number; reload: number; color: string; dt: number; visible: boolean },
  ) {
    this.hit = Math.max(0, this.hit - o.dt * 5);
    this.kill = Math.max(0, this.kill - o.dt * 2.2);
    this.recoil = Math.max(0, this.recoil - o.dt * 10);
    if (!o.visible) return;
    ctx.save();
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    // Aim guide: dashed line from the player toward the cursor, out to shot range.
    const dx = o.mx - o.px;
    const dy = o.my - o.py;
    const d = Math.hypot(dx, dy) || 1;
    const range = SHOT.speed * SHOT.life * o.scale;
    const len = Math.min(range, Math.max(40, d));
    const ux = dx / d;
    const uy = dy / d;
    const g = ctx.createLinearGradient(o.px, o.py, o.px + ux * len, o.py + uy * len);
    g.addColorStop(0, withAlpha(o.color, 0));
    g.addColorStop(0.25, withAlpha(o.color, 0.32));
    g.addColorStop(1, withAlpha(o.color, 0.06));
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 9]);
    ctx.beginPath();
    ctx.moveTo(o.px + ux * 40 * o.scale, o.py + uy * 40 * o.scale);
    ctx.lineTo(o.px + ux * len, o.py + uy * len);
    ctx.stroke();
    ctx.setLineDash([]);
    // Range end tick
    if (d > range) {
      ctx.strokeStyle = withAlpha(o.color, 0.35);
      ctx.beginPath();
      ctx.arc(o.px + ux * range, o.py + uy * range, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    const x = o.mx;
    const y = o.my;
    const spread = 9 + this.recoil * 5;
    // Ammo ring: one arc per shot, the next one fills while reloading.
    const n = SHOT.ammoMax;
    const gap = 0.16;
    const r = 19 + this.recoil * 2;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + gap / 2;
      const a1 = a0 + (Math.PI * 2) / n - gap;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(5,4,13,0.7)";
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1);
      ctx.stroke();
      const full = i < o.ammo;
      const filling = i === o.ammo;
      if (full || filling) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = full ? o.color : withAlpha(o.color, 0.6);
        ctx.beginPath();
        ctx.arc(x, y, r, a0, full ? a1 : a0 + (a1 - a0) * o.reload);
        ctx.stroke();
      }
    }
    // Crosshair ticks
    ctx.strokeStyle = o.ammo > 0 ? "#ffffff" : "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(x + sx * spread, y + sy * spread);
      ctx.lineTo(x + sx * (spread + 5), y + sy * (spread + 5));
    }
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 1, y - 1, 2, 2);
    // Hitmarker
    if (this.hit > 0) {
      const s = 6 + (1 - this.hit) * 6;
      ctx.strokeStyle = this.crit ? `rgba(255,211,77,${this.hit})` : `rgba(255,255,255,${this.hit})`;
      ctx.lineWidth = this.crit ? 3 : 2.2;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        ctx.moveTo(x + sx * s, y + sy * s);
        ctx.lineTo(x + sx * (s + 7), y + sy * (s + 7));
      }
      ctx.stroke();
    }
    if (this.kill > 0) {
      const s = 14 + (1 - this.kill) * 10;
      ctx.strokeStyle = `rgba(255,74,94,${this.kill})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
    }
    ctx.restore();
  }
}
