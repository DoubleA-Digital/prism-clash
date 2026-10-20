// Characters. Everything about how a fighter looks lives here behind one call:
//   drawHero(ctx, state)
// The current look is a clean neon body in the player's color with two hands gripping the
// weapon in hand, pointed at the aim. The hitbox is the PLAYER.radius circle, so any
// replacement art (chibi heroes) can swap the body drawing without touching the game.

import { PLAYER, PLAYER_COLORS, WEAPONS, type WeaponId } from "@prism/shared";
import { drawShapeMarker } from "./core";
import { drawGlow, withAlpha } from "./glow";
import { drawWeapon, muzzleLength } from "./items";

/** What a hero is doing this frame (all fields are cheap to fill from a NetPlayer). */
export interface HeroAnim {
  /** Moving speed (units/s) for the walk bob. */
  speed: number;
  dashing: boolean;
  reloading: boolean;
  healing: boolean;
  /** Prism Lance charge 0..1. */
  charge: number;
  swinging: boolean;
  /** Seconds since this hero last fired (recoil kick). */
  sinceShot: number;
  /** Seconds since this hero was last hit (hit flash). */
  sinceHit: number;
  airborne: number;
}

export interface HeroState {
  id: number;
  x: number;
  y: number;
  aim: number;
  color: string;
  colorIndex: number;
  name: string;
  hp: number;
  armor: number;
  weapon: WeaponId | null;
  rarity: number;
  isMe: boolean;
  /** 0..1 (cloak, disconnect). */
  alpha: number;
  ultReady: boolean;
  bountied: boolean;
  invulnerable: boolean;
  slowed: boolean;
  disconnected: boolean;
  colorblind: boolean;
  /** 1 / camera scale, so labels stay a constant screen size. */
  invScale: number;
  showBar: boolean;
  time: number;
  anim: HeroAnim;
}

const R = PLAYER.radius;

export function drawHero(ctx: CanvasRenderingContext2D, h: HeroState) {
  const a = h.alpha * (h.disconnected ? 0.35 : 1);
  if (a <= 0.01) return;
  const an = h.anim;
  const scale = 1 + an.airborne * 0.4;
  const bob = an.speed > 30 && !an.dashing ? Math.sin(h.time * 14 + h.id) * 1.6 : 0;
  ctx.save();
  ctx.globalAlpha = a;

  // Shadow on the floor (bigger and offset while airborne).
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.ellipse(h.x + 3, h.y + R * 0.55 + an.airborne * 26, R * 1.05, R * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  const pulse = 0.5 + 0.5 * Math.sin(h.time * (h.ultReady ? 6 : 2.2));
  drawGlow(ctx, h.x, h.y, R * (2.4 + (h.ultReady ? 0.7 * pulse : 0)), h.color, (h.ultReady ? 0.5 : 0.28) * a);
  if (h.bountied) drawGlow(ctx, h.x, h.y, R * 3.2, "#ffd34d", 0.7 * (0.6 + 0.4 * pulse));
  if (h.invulnerable) drawGlow(ctx, h.x, h.y, R * 2.1, "#ffffff", 0.35);
  if (an.healing) drawGlow(ctx, h.x, h.y, R * 2.4, "#5dff9d", 0.35 + 0.2 * Math.sin(h.time * 8));

  ctx.translate(h.x, h.y + bob);
  ctx.scale(scale, scale);

  // Body: dark core with a bright rim in the player's color, a visor facing the aim.
  const flash = Math.max(0, 1 - an.sinceHit / 0.12);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
  g.addColorStop(0, withAlpha(h.color, 0.95));
  g.addColorStop(0.55, withAlpha(h.color, 0.55));
  g.addColorStop(1, "rgba(12,10,36,0.95)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(5,4,13,0.95)";
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(h.color, 1);
  ctx.beginPath();
  ctx.arc(0, 0, R - 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.rotate(h.aim);
  ctx.fillStyle = "rgba(5,4,13,0.85)";
  ctx.beginPath();
  ctx.ellipse(R * 0.38, 0, R * 0.32, R * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(R * 0.46, -R * 0.12, R * 0.09, R * 0.15, 0, 0, Math.PI * 2);
  ctx.ellipse(R * 0.46, R * 0.18, R * 0.09, R * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.7 * flash})`;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
  }
  // Weapon and hands, rotated to the aim. Reloading tips the gun down; recoil kicks it back.
  const w = h.weapon;
  const kick = w ? Math.max(0, 1 - an.sinceShot / 0.09) * WEAPONS[w].recoil : 0;
  const tilt = an.reloading ? 0.75 + Math.sin(h.time * 10) * 0.08 : 0;
  ctx.save();
  ctx.rotate(h.aim);
  let swing = 0;
  if (an.swinging && w === "blade") swing = Math.sin(h.time * 40) * 0.9;
  ctx.rotate(tilt + swing);
  const grip = R * 0.55 - kick;
  if (w) {
    ctx.save();
    ctx.translate(grip, R * 0.42);
    drawWeapon(ctx, w, h.rarity, 1, h.time);
    if (an.charge > 0) {
      const m = muzzleLength(w);
      drawGlow(ctx, m, 0, 16 + an.charge * 36, h.color, 0.5 + an.charge * 0.5);
      drawGlow(ctx, m, 0, 8 + an.charge * 14, "#ffffff", 0.8);
    }
    ctx.restore();
  }
  // Hands: one on the grip, one forward on the barrel.
  const handFill = withAlpha(h.color, 1);
  for (const [hx, hy] of [[grip + 1, R * 0.62], [grip + (w ? Math.min(22, muzzleLength(w) * 0.45) : 10), R * 0.3]] as const) {
    ctx.beginPath();
    ctx.arc(hx, hy, R * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = handFill;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(5,4,13,0.9)";
    ctx.stroke();
  }
  ctx.restore();

  if (h.slowed) {
    ctx.strokeStyle = "rgba(140,210,255,0.8)";
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  if (h.colorblind) drawShapeMarker(ctx, h.x, h.y - R * 2.2, 7, h.colorIndex);
  drawLabel(ctx, h, a);
}

/** Name and health/armor bar above the hero, in screen-sized units. */
function drawLabel(ctx: CanvasRenderingContext2D, h: HeroState, a: number) {
  const s = h.invScale;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const ny = h.y - R - 16 * s;
  ctx.font = `700 ${15 * s}px Rajdhani, system-ui, sans-serif`;
  ctx.lineWidth = 3.5 * s;
  ctx.strokeStyle = "rgba(5,4,13,0.85)";
  const label = h.disconnected ? `${h.name} (reconnecting…)` : h.name;
  ctx.strokeText(label, h.x, ny);
  ctx.fillStyle = h.isMe ? "#ffffff" : h.color;
  ctx.fillText(label, h.x, ny);
  if (h.showBar) {
    const bw = 54 * s;
    const bh = 5 * s;
    const bx = h.x - bw / 2;
    const by = ny + 3 * s;
    const hpF = Math.max(0, Math.min(1, h.hp / PLAYER.maxHp));
    ctx.fillStyle = "rgba(5,4,13,0.75)";
    ctx.fillRect(bx - 1.5 * s, by - 1.5 * s, bw + 3 * s, bh + 3 * s + (h.armor > 0 ? 4 * s : 0));
    ctx.fillStyle = hpF > 0.5 ? h.color : hpF > 0.25 ? "#ffd34d" : "#ff4a5e";
    ctx.fillRect(bx, by, bw * hpF, bh);
    if (h.armor > 0) {
      ctx.fillStyle = "#5fd0ff";
      ctx.fillRect(bx, by + bh + 1 * s, bw * Math.min(1, h.armor / 50), 2.5 * s);
    }
  }
  ctx.restore();
}

/** Color hex for a palette index (used by callers building HeroState). */
export const heroColor = (i: number) => PLAYER_COLORS[i]?.hex ?? "#00F0FF";
