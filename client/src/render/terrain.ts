// Terrain drawn live (crisp at any zoom, culled to the camera): walls with glowing neon
// edges, rocks, crystals, low cover, fences, hover cars, crates with tinted trim, barrels,
// glass panels (cracking as they take damage), bush foliage drawn over players, and roofs
// that fade out while you're inside the building.

import { RARITY, type MapDef, type Roof, type Solid } from "@prism/shared";
import { drawGlow, withAlpha } from "./glow";

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const inView = (s: { x0: number; y0: number; x1: number; y1: number }, b: Bounds, pad = 40) => s.x1 > b.x0 - pad && s.x0 < b.x1 + pad && s.y1 > b.y0 - pad && s.y0 < b.y1 + pad;

const CAR_COLORS = ["#FF2E88", "#00F0FF", "#FFC83D", "#A970FF", "#9DFF3A"];

export class Terrain {
  private roofAlpha: number[];
  private edge: string;

  constructor(readonly map: MapDef) {
    this.roofAlpha = map.roofs.map(() => 1);
    this.edge = map.theme === "wilds" ? "#2BFFC8" : "#7CF6FF";
  }

  /** Solids in view: `tall` = the sight blockers (walls, rocks, crystals, drawn above the
   *  shadows), otherwise the low stuff (cover, crates, cars, glass… drawn under players). */
  drawSolids(ctx: CanvasRenderingContext2D, b: Bounds, time: number, tall: boolean) {
    const walls: Solid[] = [];
    const rest: Solid[] = [];
    const m = this.map;
    m.grid.query(b.x0 - 40, b.y0 - 40, b.x1 + 40, b.y1 + 40, (i) => {
      const s = m.solids[i];
      if (!s || s.dead || s.vision !== tall || !inView(s, b)) return;
      if (s.kind === "wall") walls.push(s);
      else rest.push(s);
    });
    this.drawWalls(ctx, walls, time);
    for (const s of rest) this.drawSolid(ctx, s, time);
  }

  private drawWalls(ctx: CanvasRenderingContext2D, walls: Solid[], time: number) {
    if (!walls.length) return;
    const path = new Path2D();
    for (const s of walls) path.rect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
    ctx.save();
    ctx.fillStyle = "#1a1b48";
    ctx.fill(path);
    ctx.globalCompositeOperation = "lighter";
    const pulse = 0.8 + 0.2 * Math.sin(time * 1.6);
    ctx.strokeStyle = withAlpha(this.edge, 0.1 * pulse);
    ctx.lineWidth = 14;
    ctx.stroke(path);
    ctx.strokeStyle = withAlpha(this.edge, 0.85);
    ctx.lineWidth = 2;
    ctx.stroke(path);
    ctx.restore();
    // Top face highlight.
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (const s of walls) ctx.fillRect(s.x0 + 3, s.y0 + 3, Math.max(0, s.x1 - s.x0 - 6), Math.max(0, Math.min(8, s.y1 - s.y0 - 6)));
  }

  private drawSolid(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    const cx = s.x0 + w / 2;
    const cy = s.y0 + h / 2;
    const dmg = s.maxHp > 0 ? 1 - s.hp / s.maxHp : 0;
    ctx.save();
    switch (s.kind) {
      case "rock": {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.roundRect(s.x0 + 6, s.y0 + 8, w, h, 18);
        ctx.fill();
        const g = ctx.createLinearGradient(s.x0, s.y0, s.x1, s.y1);
        g.addColorStop(0, "#3d4675");
        g.addColorStop(1, "#1b1f3e");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(s.x0, s.y0, w, h, Math.min(22, w / 3, h / 3));
        ctx.fill();
        ctx.strokeStyle = withAlpha(this.edge, 0.45);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.moveTo(s.x0 + w * 0.2, s.y0 + h * (0.3 + s.variant * 0.3));
        ctx.lineTo(s.x0 + w * 0.6, s.y0 + h * 0.2);
        ctx.lineTo(s.x0 + w * 0.8, s.y0 + h * 0.7);
        ctx.stroke();
        break;
      }
      case "crystal": {
        drawGlow(ctx, cx, cy, Math.max(w, h) * 1.4, "#8fe7ff", 0.3 + 0.1 * Math.sin(time * 1.5 + s.variant * 9));
        const g = ctx.createLinearGradient(s.x0, s.y0, s.x1, s.y1);
        g.addColorStop(0, "#b8f6ff");
        g.addColorStop(0.45, "#3c6fd6");
        g.addColorStop(1, "#1a1f6a");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, s.y0 - h * 0.08);
        ctx.lineTo(s.x1 + w * 0.06, cy);
        ctx.lineTo(cx, s.y1 + h * 0.08);
        ctx.lineTo(s.x0 - w * 0.06, cy);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(220,250,255,0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = "rgba(220,250,255,0.35)";
        ctx.beginPath();
        ctx.moveTo(cx, s.y0);
        ctx.lineTo(cx, s.y1);
        ctx.moveTo(s.x0, cy);
        ctx.lineTo(s.x1, cy);
        ctx.stroke();
        break;
      }
      case "cover": {
        ctx.fillStyle = "#262c5c";
        ctx.beginPath();
        ctx.roundRect(s.x0, s.y0, w, h, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(169,112,255,0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(s.x0 + 3, s.y0 + 3, w - 6, Math.min(5, h - 6));
        break;
      }
      case "fence": {
        const horiz = w >= h;
        ctx.strokeStyle = `rgba(255,46,136,${0.55 + 0.25 * Math.sin(time * 5 + s.variant * 7) - dmg * 0.3})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (horiz) {
          ctx.moveTo(s.x0, cy - 3);
          ctx.lineTo(s.x1, cy - 3);
          ctx.moveTo(s.x0, cy + 3);
          ctx.lineTo(s.x1, cy + 3);
        } else {
          ctx.moveTo(cx - 3, s.y0);
          ctx.lineTo(cx - 3, s.y1);
          ctx.moveTo(cx + 3, s.y0);
          ctx.lineTo(cx + 3, s.y1);
        }
        ctx.stroke();
        ctx.fillStyle = "#2a2d55";
        const len = horiz ? w : h;
        for (let t = 0; t <= len; t += 40) {
          const px = horiz ? s.x0 + t : cx;
          const py = horiz ? cy : s.y0 + t;
          ctx.fillRect(px - 5, py - 5, 10, 10);
        }
        break;
      }
      case "car": {
        const col = CAR_COLORS[Math.floor(s.variant * CAR_COLORS.length)] ?? "#00F0FF";
        drawGlow(ctx, cx, cy, Math.max(w, h) * 0.9, col, 0.3);
        ctx.fillStyle = "#151733";
        ctx.beginPath();
        ctx.roundRect(s.x0, s.y0, w, h, 18);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Cabin glass
        const horiz = w >= h;
        ctx.fillStyle = withAlpha(col, 0.28);
        if (horiz) ctx.fillRect(s.x0 + w * 0.3, s.y0 + 10, w * 0.35, h - 20);
        else ctx.fillRect(s.x0 + 10, s.y0 + h * 0.3, w - 20, h * 0.35);
        ctx.fillStyle = "#ffffff";
        if (horiz) {
          ctx.fillRect(s.x1 - 6, s.y0 + 10, 4, 10);
          ctx.fillRect(s.x1 - 6, s.y1 - 20, 4, 10);
        } else {
          ctx.fillRect(s.x0 + 10, s.y1 - 6, 10, 4);
          ctx.fillRect(s.x1 - 20, s.y1 - 6, 10, 4);
        }
        break;
      }
      case "crate": {
        const trim = RARITY[s.variant > 0.92 ? 2 : s.variant > 0.6 ? 1 : 0]?.color ?? "#B8C0D8";
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(s.x0 + 4, s.y0 + 6, w, h);
        ctx.fillStyle = "#2b2142";
        ctx.fillRect(s.x0, s.y0, w, h);
        ctx.strokeStyle = withAlpha(trim, 0.9);
        ctx.lineWidth = 3;
        ctx.strokeRect(s.x0 + 1.5, s.y0 + 1.5, w - 3, h - 3);
        ctx.lineWidth = 2;
        ctx.strokeStyle = withAlpha(trim, 0.45);
        ctx.beginPath();
        ctx.moveTo(s.x0 + 4, s.y0 + 4);
        ctx.lineTo(s.x1 - 4, s.y1 - 4);
        ctx.moveTo(s.x1 - 4, s.y0 + 4);
        ctx.lineTo(s.x0 + 4, s.y1 - 4);
        ctx.stroke();
        break;
      }
      case "barrel": {
        const r = Math.min(w, h) / 2;
        drawGlow(ctx, cx, cy, r * 2.4, "#ff6a2b", 0.35 + 0.15 * Math.sin(time * 4 + s.variant * 9));
        ctx.fillStyle = "#4a1410";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ff8a2b";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "#ffd34d";
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.55);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.35);
        ctx.lineTo(cx - r * 0.5, cy + r * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#4a1410";
        ctx.fillRect(cx - 1.5, cy - r * 0.25, 3, r * 0.35);
        break;
      }
      case "glass": {
        ctx.fillStyle = `rgba(140,230,255,${0.22 + dmg * 0.1})`;
        ctx.fillRect(s.x0, s.y0, w, h);
        ctx.strokeStyle = "rgba(200,248,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(s.x0, s.y0, w, h);
        break;
      }
      default:
        break;
    }
    if (dmg > 0.05 && s.kind !== "barrel") this.cracks(ctx, s, dmg);
    ctx.restore();
  }

  private cracks(ctx: CanvasRenderingContext2D, s: Solid, dmg: number) {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + dmg * 0.5})`;
    ctx.lineWidth = 1.4;
    const n = Math.ceil(dmg * 5);
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = s.variant * 13 + k * 2.4;
      const x = s.x0 + w * (0.5 + 0.35 * Math.cos(a));
      const y = s.y0 + h * (0.5 + 0.35 * Math.sin(a * 1.3));
      ctx.moveTo(s.x0 + w / 2, s.y0 + h / 2);
      ctx.lineTo((x + s.x0 + w / 2) / 2 + 4, (y + s.y0 + h / 2) / 2 - 3);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** Bush foliage, drawn above players so it hides them. Your own bush is see-through. */
  drawBushes(ctx: CanvasRenderingContext2D, b: Bounds, time: number, me: { x: number; y: number } | null) {
    for (const bu of this.map.bushes) {
      if (bu.x + bu.r < b.x0 || bu.x - bu.r > b.x1 || bu.y + bu.r < b.y0 || bu.y - bu.r > b.y1) continue;
      const inside = !!me && (me.x - bu.x) ** 2 + (me.y - bu.y) ** 2 < bu.r * bu.r;
      ctx.save();
      ctx.globalAlpha = inside ? 0.45 : 0.96;
      const sway = Math.sin(time * 1.3 + bu.x * 0.01) * 2;
      ctx.fillStyle = "#0b3b34";
      ctx.beginPath();
      ctx.arc(bu.x, bu.y, bu.r, 0, Math.PI * 2);
      ctx.fill();
      // Layered leaf blobs around the rim and a lighter crown.
      ctx.fillStyle = "#11574a";
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + bu.x * 0.003;
        ctx.beginPath();
        ctx.arc(bu.x + Math.cos(a) * bu.r * 0.55 + sway, bu.y + Math.sin(a) * bu.r * 0.55, bu.r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#1b7a62";
      ctx.beginPath();
      ctx.arc(bu.x - bu.r * 0.15 + sway, bu.y - bu.r * 0.2, bu.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(93,255,190,${0.35 + 0.12 * Math.sin(time * 2 + bu.y * 0.01)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bu.x, bu.y, bu.r - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(150,255,210,0.5)";
      for (let k = 0; k < 4; k++) {
        const a = k * 1.9 + bu.y * 0.01;
        ctx.fillRect(bu.x + Math.cos(a) * bu.r * 0.6, bu.y + Math.sin(a) * bu.r * 0.6, 3, 3);
      }
      ctx.restore();
    }
  }

  /** Roofs: opaque from outside, fading away while `inside` is that building. */
  drawRoofs(ctx: CanvasRenderingContext2D, b: Bounds, inside: number, dt: number) {
    this.map.roofs.forEach((r: Roof, i) => {
      const target = i === inside ? 0.08 : 1;
      const cur = this.roofAlpha[i] ?? 1;
      const next = cur + (target - cur) * Math.min(1, dt * 8);
      this.roofAlpha[i] = next;
      if (!inView(r, b) || next < 0.02) return;
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      ctx.save();
      ctx.globalAlpha = next;
      ctx.fillStyle = r.variant > 0.5 ? "#191a40" : "#1d1638";
      ctx.fillRect(r.x0 - 4, r.y0 - 4, w + 8, h + 8);
      // Rooftop details: a grid of panels, vents and an AC unit.
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = r.x0 + 80; x < r.x1 - 20; x += 80) {
        ctx.moveTo(x, r.y0 + 10);
        ctx.lineTo(x, r.y1 - 10);
      }
      ctx.stroke();
      ctx.fillStyle = "#262856";
      ctx.fillRect(r.x0 + w * 0.15, r.y0 + h * 0.2, 70, 50);
      ctx.fillRect(r.x0 + w * (0.55 + r.variant * 0.2), r.y0 + h * 0.6, 40, 40);
      ctx.strokeStyle = withAlpha(r.variant > 0.5 ? "#FF2E88" : "#7CF6FF", 0.8);
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x0 - 2, r.y0 - 2, w + 4, h + 4);
      ctx.restore();
    });
  }
}
