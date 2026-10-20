// Characters. Everything about how a fighter looks in the world lives behind one call:
//   drawHero(ctx, state)
// The body is the chibi hero renderer (render/chibi), fed with animation progress values
// from heroAnim.ts. This file adds what the game needs around it: status auras (bounty,
// ultimate ready, invulnerable), the Shockwave Slam hop, the slowed ring, colorblind shape
// markers, and the name + health/armor bar. The hitbox stays the PLAYER.radius circle.

import { PLAYER, PLAYER_COLORS, type HeroId, type WeaponId } from "@prism/shared";
import { drawHero as drawChibi, type ChibiAnim } from "./chibi";
import { drawShapeMarker } from "./core";
import { drawGlow } from "./glow";

export interface HeroState {
  id: number;
  heroId: HeroId;
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
  /** 0..1 overall opacity (disconnects, lookalike fades). Cloak goes through anim.cloak. */
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
  /** Draw the name (and bar) at all (off for corpses and tiny decoys). */
  label?: boolean;
  time: number;
  anim: ChibiAnim;
  /** Shockwave Slam leap, 0..1. */
  airborne: number;
  /** Draw scale on top of the hop (decoys are smaller). */
  scale?: number;
}

const R = PLAYER.radius;
/** How far above the hitbox center the top of a chibi's head sits (world units at scale 1). */
const HEAD_TOP = 34;
const HOP = 26;

export function drawHero(ctx: CanvasRenderingContext2D, h: HeroState) {
  const a = h.alpha * (h.disconnected ? 0.35 : 1);
  if (a <= 0.01) return;
  const an = h.anim;
  const dying = an.deathT >= 0;
  const visible = 1 - Math.min(1, an.cloak) * 0.86;
  const hop = h.airborne * HOP;
  const scale = (h.scale ?? 1) * (1 + h.airborne * 0.35);
  ctx.save();
  ctx.globalAlpha = a;

  if (!dying) {
    const pulse = 0.5 + 0.5 * Math.sin(h.time * (h.ultReady ? 6 : 2.2));
    if (h.ultReady) drawGlow(ctx, h.x, h.y + 6, R * (2.2 + 0.5 * pulse), h.color, 0.32 * a * visible);
    if (h.bountied) drawGlow(ctx, h.x, h.y, R * 3.2, "#ffd34d", 0.7 * (0.6 + 0.4 * pulse));
    if (h.invulnerable) drawGlow(ctx, h.x, h.y - 4, R * 2.2, "#ffffff", 0.32 * visible);
    if (h.airborne > 0) {
      // The hero leaves the ground: a separate shadow stays on the floor and shrinks.
      ctx.fillStyle = `rgba(0,0,0,${0.4 * visible})`;
      ctx.beginPath();
      ctx.ellipse(h.x, h.y + 19, R * (1 - h.airborne * 0.35), R * 0.42 * (1 - h.airborne * 0.35), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawChibi(ctx, {
    heroId: h.heroId, color: h.color, x: h.x, y: h.y - hop, aim: h.aim, weapon: h.weapon ? { id: h.weapon, rarity: h.rarity } : null,
    anim: an, scale, time: h.time, seed: h.id, floorGlow: h.airborne < 0.2,
  });

  if (h.slowed && !dying) {
    ctx.strokeStyle = "rgba(140,210,255,0.8)";
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + 8, R + 8, R * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  if (dying || h.label === false) return;
  const top = h.y - hop - HEAD_TOP * scale;
  if (h.colorblind) drawShapeMarker(ctx, h.x, top - 30 * h.invScale, 7, h.colorIndex);
  drawLabel(ctx, h, a * (1 - Math.min(1, an.cloak) * 0.9), top);
}

/** Name and health/armor bar above the hero, in screen-sized units. */
function drawLabel(ctx: CanvasRenderingContext2D, h: HeroState, a: number, top: number) {
  if (a <= 0.02) return;
  const s = h.invScale;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const ny = top - (h.showBar ? 10 : 4) * s;
  ctx.font = `700 ${15 * s}px Rajdhani, system-ui, sans-serif`;
  ctx.lineWidth = 3.5 * s;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(5,4,13,0.85)";
  const label = h.disconnected ? `${h.name} (reconnecting…)` : h.name;
  ctx.strokeText(label, h.x, ny);
  ctx.fillStyle = h.isMe ? "#ffffff" : h.color;
  ctx.fillText(label, h.x, ny);
  if (h.showBar) {
    const bw = 54 * s;
    const bh = 5 * s;
    const bx = h.x - bw / 2;
    const by = ny + 2 * s;
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
