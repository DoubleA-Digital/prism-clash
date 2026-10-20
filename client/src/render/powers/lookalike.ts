// Mirror Self clones and Decoy Swarm holograms pass for their owner: they're drawn with the
// same hero renderer real fighters use (same chibi hero, color, held weapon, name and health
// bar), fed from the owner's networked state and copying the owner's current hand animation
// (recoil, reload, heal), so at a glance nobody can tell which one is real.

import { DEFAULT_HERO, hasStatusBit, PFLAG, PLAYER, PLAYER_COLORS } from "@prism/shared";
import { settings } from "../../settings";
import { CHIBI_TIMING, idleAnim, type ChibiAnim } from "../chibi";
import { drawHero } from "../hero";
import type { RenderCtx } from "./types";

export interface LookalikeOpts {
  x: number;
  y: number;
  aim: number;
  alpha: number;
  /** Movement speed for the walk cycle. */
  speed: number;
  showBar: boolean;
  /** Overrides rc.invScale when drawing under a scale transform (smaller decoys). */
  invScale?: number;
  /** Per-copy seed so a swarm doesn't step in lockstep. */
  seed?: number;
}

function copyAnim(src: ChibiAnim | undefined, o: LookalikeOpts, time: number): ChibiAnim {
  const a = idleAnim();
  if (src) {
    a.recoilT = src.recoilT;
    a.reloadT = src.reloadT;
    a.healT = src.healT;
    a.healKind = src.healKind;
    a.throwT = src.throwT;
    a.slashT = src.slashT;
    a.slashSide = src.slashSide;
    a.charge = src.charge;
  }
  a.speed = o.speed;
  a.walkPhase = time * o.speed * CHIBI_TIMING.stridePerUnit + (o.seed ?? 0) * 1.7;
  return a;
}

/** Draws a copy of player `ownerId` at (x, y). */
export function drawLookalike(rc: RenderCtx, ownerId: number, o: LookalikeOpts) {
  const owner = rc.player(ownerId);
  const col = rc.color(ownerId);
  const st = owner?.status ?? 0;
  const dashing = owner ? (owner.flags & PFLAG.dashing) !== 0 : false;
  drawHero(rc.ctx, {
    id: ownerId, heroId: rc.hero?.(ownerId) ?? DEFAULT_HERO, x: o.x, y: o.y, aim: o.aim, color: col, colorIndex: owner?.color ?? Math.max(0, PLAYER_COLORS.findIndex((c) => c.hex === col)),
    name: rc.playerName(ownerId), hp: owner?.hp ?? PLAYER.maxHp, armor: owner?.armor ?? 0, weapon: owner?.weapon ?? "pistol", rarity: owner?.rarity ?? 0,
    isMe: false, alpha: o.alpha, ultReady: owner ? (owner.flags & PFLAG.ultReady) !== 0 : false, bountied: hasStatusBit(st, "bountied"),
    invulnerable: hasStatusBit(st, "invulnerable") && !dashing, slowed: hasStatusBit(st, "slowed") || hasStatusBit(st, "timeBubble") || hasStatusBit(st, "shocked"),
    disconnected: owner ? (owner.flags & PFLAG.connected) === 0 : false, colorblind: settings.colorblind, invScale: o.invScale ?? rc.invScale, showBar: o.showBar, time: rc.time,
    anim: copyAnim(rc.animOf?.(ownerId), o, rc.time), airborne: hasStatusBit(st, "airborne") ? 1 : 0,
  });
}
