// Player cores: a glowing inner orb inside a rotating angular shell. The shell cracks at
// 75/50/25% health and loses shards near death. Name and a small health bar float above.

import { PLAYER, PLAYER_COLORS, type PlayerShape } from "@prism/shared";
import { drawGlow, withAlpha } from "./glow";

export interface CoreOpts {
  x: number;
  y: number;
  color: string;
  colorIndex: number;
  hp: number;
  aim: number;
  time: number;
  name: string;
  isMe: boolean;
  alpha: number;
  dashing: boolean;
  ultReady: boolean;
  bountied: boolean;
  slowed: boolean;
  inverted: boolean;
  airborne: number;
  invulnerable: boolean;
  disconnected: boolean;
  colorblind: boolean;
  invScale: number;
  showBar: boolean;
}

const SHARDS = 6;

export function drawCore(ctx: CanvasRenderingContext2D, o: CoreOpts) {
  const r = PLAYER.radius * (1 + o.airborne * 0.45);
  const hpF = Math.max(0, Math.min(1, o.hp / PLAYER.maxHp));
  const a = o.alpha * (o.disconnected ? 0.35 : 1);
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  const pulse = 0.5 + 0.5 * Math.sin(o.time * (o.ultReady ? 6 : 2.2));

  // Airborne shadow on the floor.
  if (o.airborne > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(o.x, o.y + 18 + o.airborne * 30, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer aura
  drawGlow(ctx, o.x, o.y, r * (2.6 + (o.ultReady ? 0.8 * pulse : 0)), o.color, (o.ultReady ? 0.55 : 0.32) * a);
  if (o.bountied) drawGlow(ctx, o.x, o.y, r * 3.4, "#ffd34d", 0.7 * (0.6 + 0.4 * pulse));
  if (o.invulnerable) drawGlow(ctx, o.x, o.y, r * 2.2, "#ffffff", 0.35);

  // Rotating shell: 6 angular shards around the orb.
  const spin = o.time * (o.dashing ? 9 : 1.6) + o.colorIndex;
  const lost = hpF < 0.12 ? 3 : hpF < 0.25 ? 2 : 0;
  ctx.lineJoin = "round";
  for (let i = 0; i < SHARDS; i++) {
    if (i < lost) continue;
    const a0 = spin + (i / SHARDS) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / SHARDS - 0.16;
    const ri = r * 0.78;
    const ro = r * (1.05 + (o.ultReady ? 0.08 * pulse : 0));
    ctx.beginPath();
    ctx.moveTo(o.x + Math.cos(a0) * ri, o.y + Math.sin(a0) * ri);
    ctx.lineTo(o.x + Math.cos(a0 + 0.08) * ro, o.y + Math.sin(a0 + 0.08) * ro);
    ctx.lineTo(o.x + Math.cos(a1 - 0.08) * ro, o.y + Math.sin(a1 - 0.08) * ro);
    ctx.lineTo(o.x + Math.cos(a1) * ri, o.y + Math.sin(a1) * ri);
    ctx.closePath();
    ctx.fillStyle = withAlpha(o.color, 0.22 + 0.12 * hpF);
    ctx.fill();
    ctx.strokeStyle = o.ultReady ? "#ffffff" : o.color;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
  // Cracks: more lines as health drops.
  const cracks = hpF < 0.25 ? 3 : hpF < 0.5 ? 2 : hpF < 0.75 ? 1 : 0;
  if (cracks) {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.4;
    for (let c = 0; c < cracks; c++) {
      const ca = spin * 0.5 + c * 2.1 + o.colorIndex;
      ctx.beginPath();
      ctx.moveTo(o.x + Math.cos(ca) * r * 0.55, o.y + Math.sin(ca) * r * 0.55);
      ctx.lineTo(o.x + Math.cos(ca + 0.25) * r * 0.8, o.y + Math.sin(ca + 0.25) * r * 0.8);
      ctx.lineTo(o.x + Math.cos(ca + 0.1) * r * 1.02, o.y + Math.sin(ca + 0.1) * r * 1.02);
      ctx.stroke();
    }
  }

  // Inner orb
  const flicker = hpF < 0.25 ? 0.75 + 0.25 * Math.sin(o.time * 30) : 1;
  drawGlow(ctx, o.x, o.y, r * 1.25, o.color, 0.95 * flicker, 0.3);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(o.x, o.y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Aim chevron
  const cx = o.x + Math.cos(o.aim) * r * 1.55;
  const cy = o.y + Math.sin(o.aim) * r * 1.55;
  ctx.fillStyle = o.isMe ? "#ffffff" : o.color;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(o.aim) * 9, cy + Math.sin(o.aim) * 9);
  ctx.lineTo(cx + Math.cos(o.aim + 2.4) * 8, cy + Math.sin(o.aim + 2.4) * 8);
  ctx.lineTo(cx + Math.cos(o.aim - 2.4) * 8, cy + Math.sin(o.aim - 2.4) * 8);
  ctx.closePath();
  ctx.fill();

  // Status overlays
  if (o.slowed) {
    ctx.strokeStyle = "rgba(140,220,255,0.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(o.x, o.y, r * 1.5, o.time, o.time + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.inverted) {
    ctx.strokeStyle = "rgba(120,255,180,0.9)";
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 1.7, -o.time * 4 + k * Math.PI, -o.time * 4 + k * Math.PI + 1.2);
      ctx.stroke();
    }
  }

  // Colorblind shape marker
  if (o.colorblind) drawShapeMarker(ctx, o.x, o.y - r * 2.1, 7, o.colorIndex);

  ctx.restore();

  // Name + health bar in screen-sized units
  const s = o.invScale;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const ny = o.y - r - 18 * s;
  ctx.font = `700 ${15 * s}px Rajdhani, system-ui, sans-serif`;
  ctx.lineWidth = 3.5 * s;
  ctx.strokeStyle = "rgba(5,4,13,0.85)";
  const label = o.disconnected ? `${o.name} (reconnecting…)` : o.name;
  ctx.strokeText(label, o.x, ny);
  ctx.fillStyle = o.isMe ? "#ffffff" : o.color;
  ctx.fillText(label, o.x, ny);
  if (o.showBar) {
    const bw = 54 * s;
    const bh = 5 * s;
    const bx = o.x - bw / 2;
    const by = ny + 3 * s;
    ctx.fillStyle = "rgba(5,4,13,0.75)";
    ctx.fillRect(bx - 1.5 * s, by - 1.5 * s, bw + 3 * s, bh + 3 * s);
    ctx.fillStyle = hpF > 0.5 ? o.color : hpF > 0.25 ? "#ffd34d" : "#ff4a5e";
    ctx.fillRect(bx, by, bw * hpF, bh);
  }
  ctx.restore();
}

/** A closed polygon through (x + px·s, y + py·s), rotated by `rot`. */
function poly(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pts: readonly (readonly [number, number])[], rot = 0) {
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  pts.forEach(([px, py], i) => {
    const qx = x + (px * c - py * sn) * s;
    const qy = y + (px * sn + py * c) * s;
    if (i === 0) ctx.moveTo(qx, qy);
    else ctx.lineTo(qx, qy);
  });
}

const T = 0.38;
const CROSS: readonly (readonly [number, number])[] = [[-T, -1], [T, -1], [T, -T], [1, -T], [1, T], [T, T], [T, 1], [-T, 1], [-T, T], [-1, T], [-1, -T], [-T, -T]];
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 0.48 : 1.15;
  return [Math.cos(a) * r, Math.sin(a) * r] as const;
});
const HEX = Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)] as const);
const BOWTIE: readonly (readonly [number, number])[] = [[-1, -0.85], [0, -0.12], [1, -0.85], [1, 0.85], [0, 0.12], [-1, 0.85]];

/** The colorblind shape marker of a player color: white with a dark outline, one shape per seat. */
export function drawShapeMarker(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, colorIndex: number) {
  const shape: PlayerShape = PLAYER_COLORS[colorIndex]?.shape ?? "circle";
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(5,4,13,0.9)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (shape === "ring") {
    // Hollow: a dark band, then a thick white circle on it.
    ctx.arc(x, y, s * 0.85, 0, Math.PI * 2);
    ctx.lineWidth = s * 0.55 + 4;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = s * 0.55;
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (shape === "circle") ctx.arc(x, y, s, 0, Math.PI * 2);
  else if (shape === "triangle") poly(ctx, x, y, s, [[0, -1], [1, 0.8], [-1, 0.8]]);
  else if (shape === "square") ctx.rect(x - s * 0.85, y - s * 0.85, s * 1.7, s * 1.7);
  else if (shape === "diamond") poly(ctx, x, y, s, [[0, -1.1], [1, 0], [0, 1.1], [-1, 0]]);
  else if (shape === "cross") poly(ctx, x, y, s, CROSS);
  else if (shape === "x") poly(ctx, x, y, s * 1.1, CROSS, Math.PI / 4);
  else if (shape === "star") poly(ctx, x, y, s, STAR);
  else if (shape === "hex") poly(ctx, x, y, s, HEX);
  else poly(ctx, x, y, s, BOWTIE);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
