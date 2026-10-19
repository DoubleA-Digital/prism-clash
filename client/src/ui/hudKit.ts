// Drawing helpers shared by the canvas HUD pieces: fonts, glass panels, outlined text, glyphs.

import { withAlpha } from "../render/glow";

export const MONO = `"JetBrains Mono", ui-monospace, monospace`;
export const DISPLAY = `Orbitron, system-ui, sans-serif`;
export const UIFONT = `Rajdhani, system-ui, sans-serif`;

export const font = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeBack = (t: number) => {
  const c = 1.9;
  const x = clamp01(t) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

export interface PanelStyle {
  fill?: string;
  border?: string;
  borderWidth?: number;
  glow?: string;
  glowBlur?: number;
}

/** Dark glass rounded panel with an optional colored border and outer glow. */
export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, s: PanelStyle = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (s.glow) {
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = s.glowBlur ?? 18;
  }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, s.fill ?? "rgba(18,16,48,0.82)");
  g.addColorStop(1, "rgba(6,5,20,0.82)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = s.border ?? "rgba(124,246,255,0.2)";
  ctx.lineWidth = s.borderWidth ?? 1.5;
  ctx.stroke();
  // Top gloss line
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 1, w - 4, Math.min(h * 0.45, 14), [r, r, 4, 4]);
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fill();
  ctx.restore();
}

/** Text with a dark outline and optional glow, for readability over any background. */
export function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, outline = "rgba(5,4,13,0.9)", width = 4, glow?: string) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = outline;
  ctx.strokeText(text, x, y);
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Keycap pill centered at (cx, cy). Returns its width. */
export function keycap(ctx: CanvasRenderingContext2D, label: string, cx: number, cy: number, u: number, accent = "#ffffff"): number {
  ctx.save();
  ctx.font = font(800, 12 * u, MONO);
  const w = Math.max(22 * u, ctx.measureText(label).width + 12 * u);
  const h = 20 * u;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2 + 2 * u, w, h, 6 * u);
  ctx.fillStyle = "rgba(5,4,13,0.9)";
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 6 * u);
  const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, withAlpha(accent, 0.75));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = "#0a0820";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 0.5);
  ctx.restore();
  return w;
}

/** Small glyphs for kill-feed sources that have no power icon. */
export function sourceGlyph(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.6, r * 0.2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (kind) {
    case "zone":
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.95, r * 0.8);
      ctx.lineTo(-r * 0.95, r * 0.8);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(-r * 0.08, -r * 0.3, r * 0.16, r * 0.6);
      break;
    case "wall":
      ctx.strokeRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.2);
      ctx.lineTo(r * 0.2, r * 0.2);
      ctx.moveTo(r * 0.2, -r * 0.2);
      ctx.lineTo(-r * 0.2, r * 0.2);
      ctx.stroke();
      break;
    case "haunt":
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.7, Math.PI, 0);
      ctx.lineTo(r * 0.7, r * 0.8);
      ctx.lineTo(r * 0.35, r * 0.5);
      ctx.lineTo(0, r * 0.8);
      ctx.lineTo(-r * 0.35, r * 0.5);
      ctx.lineTo(-r * 0.7, r * 0.8);
      ctx.closePath();
      ctx.stroke();
      break;
    case "combo":
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? r * 0.4 : r;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    default:
      // Basic shot: crosshair
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.moveTo(-r, 0);
      ctx.lineTo(-r * 0.35, 0);
      ctx.moveTo(r, 0);
      ctx.lineTo(r * 0.35, 0);
      ctx.moveTo(0, -r);
      ctx.lineTo(0, -r * 0.35);
      ctx.moveTo(0, r);
      ctx.lineTo(0, r * 0.35);
      ctx.stroke();
  }
  ctx.restore();
}
