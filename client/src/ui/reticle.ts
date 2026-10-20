// In-match reticle (replaces the OS cursor): the magazine around the crosshair (one segment
// per round for small magazines, a draining arc for big ones), the reload filling in, the
// Prism Lance charge, crosshair gap that opens with spread bloom, a hitmarker that flashes
// when your shot lands (gold for crits, red X for kills), and a faint aim guide out to your
// weapon's range. Screen space.

import { withAlpha } from "../render/glow";

export interface ReticleInput {
  dpr: number;
  mx: number;
  my: number;
  px: number;
  py: number;
  scale: number;
  mag: number;
  magSize: number;
  /** Reload progress 0..1, or -1 when not reloading. */
  reload: number;
  /** Weapon range in world units. */
  range: number;
  /** Current spread in degrees (base + bloom). */
  spread: number;
  charge: number;
  color: string;
  dt: number;
  visible: boolean;
}

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

  draw(ctx: CanvasRenderingContext2D, o: ReticleInput) {
    this.hit = Math.max(0, this.hit - o.dt * 5);
    this.kill = Math.max(0, this.kill - o.dt * 2.2);
    this.recoil = Math.max(0, this.recoil - o.dt * 10);
    if (!o.visible) return;
    ctx.save();
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    // Aim guide: dashed line from the player toward the cursor, out to weapon range.
    const dx = o.mx - o.px;
    const dy = o.my - o.py;
    const d = Math.hypot(dx, dy) || 1;
    const range = o.range * o.scale;
    const len = Math.min(range, Math.max(40, d));
    const ux = dx / d;
    const uy = dy / d;
    const g = ctx.createLinearGradient(o.px, o.py, o.px + ux * len, o.py + uy * len);
    g.addColorStop(0, withAlpha(o.color, 0));
    g.addColorStop(0.25, withAlpha(o.color, 0.3));
    g.addColorStop(1, withAlpha(o.color, 0.05));
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 9]);
    ctx.beginPath();
    ctx.moveTo(o.px + ux * 40 * o.scale, o.py + uy * 40 * o.scale);
    ctx.lineTo(o.px + ux * len, o.py + uy * len);
    ctx.stroke();
    ctx.setLineDash([]);
    if (d > range) {
      ctx.strokeStyle = withAlpha(o.color, 0.35);
      ctx.beginPath();
      ctx.arc(o.px + ux * range, o.py + uy * range, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    const x = o.mx;
    const y = o.my;
    // Crosshair gap follows the real spread at the cursor's distance.
    const spreadPx = Math.tan((o.spread * Math.PI) / 180) * d;
    const gap = Math.min(40, 7 + spreadPx * 0.6 + this.recoil * 5);
    const r = 21 + this.recoil * 2;
    const n = o.magSize;
    ctx.lineWidth = 3.5;
    if (n > 0 && n <= 14) {
      const seg = 0.14;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + seg / 2;
        const a1 = a0 + (Math.PI * 2) / n - seg;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(5,4,13,0.7)";
        ctx.beginPath();
        ctx.arc(x, y, r, a0, a1);
        ctx.stroke();
        if (i < o.mag) {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = o.color;
          ctx.beginPath();
          ctx.arc(x, y, r, a0, a1);
          ctx.stroke();
        }
      }
    } else if (n > 0) {
      ctx.strokeStyle = "rgba(5,4,13,0.7)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = o.color;
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * o.mag) / n);
      ctx.stroke();
    }
    if (o.reload >= 0) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.reload);
      ctx.stroke();
    }
    if (o.charge > 0) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = o.charge >= 0.999 ? "#ffffff" : withAlpha(o.color, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.charge);
      ctx.stroke();
    }
    // Crosshair ticks
    ctx.strokeStyle = o.mag > 0 || n === 0 ? "#ffffff" : "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(x + sx * gap, y + sy * gap);
      ctx.lineTo(x + sx * (gap + 6), y + sy * (gap + 6));
    }
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 1, y - 1, 2, 2);
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
