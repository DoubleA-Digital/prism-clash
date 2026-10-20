// Mirror Self clones and Decoy Swarm holograms pass for their owner: they're drawn with the
// same hero renderer real fighters use (same body, color, held weapon, name and health bar),
// fed from the owner's networked state, so at a glance nobody can tell which one is real.

import { ACT, hasStatusBit, PFLAG, PLAYER, PLAYER_COLORS } from "@prism/shared";
import { settings } from "../../settings";
import { drawHero } from "../hero";
import type { RenderCtx } from "./types";

export interface LookalikeOpts {
  x: number;
  y: number;
  aim: number;
  alpha: number;
  /** Movement speed for the walk bob. */
  speed: number;
  showBar: boolean;
  /** Overrides rc.invScale when drawing under a scale transform (smaller decoys). */
  invScale?: number;
}

/** Draws a copy of player `ownerId` at (x, y). */
export function drawLookalike(rc: RenderCtx, ownerId: number, o: LookalikeOpts) {
  const owner = rc.player(ownerId);
  const col = rc.color(ownerId);
  const st = owner?.status ?? 0;
  const act = owner?.act ?? 0;
  const dashing = owner ? (owner.flags & PFLAG.dashing) !== 0 : false;
  drawHero(rc.ctx, {
    id: ownerId, x: o.x, y: o.y, aim: o.aim, color: col, colorIndex: owner?.color ?? Math.max(0, PLAYER_COLORS.findIndex((c) => c.hex === col)),
    name: rc.playerName(ownerId), hp: owner?.hp ?? PLAYER.maxHp, armor: owner?.armor ?? 0, weapon: owner?.weapon ?? "pistol", rarity: owner?.rarity ?? 0,
    isMe: false, alpha: o.alpha, ultReady: owner ? (owner.flags & PFLAG.ultReady) !== 0 : false, bountied: hasStatusBit(st, "bountied"),
    invulnerable: hasStatusBit(st, "invulnerable") && !dashing, slowed: hasStatusBit(st, "slowed") || hasStatusBit(st, "timeBubble") || hasStatusBit(st, "shocked"),
    disconnected: owner ? (owner.flags & PFLAG.connected) === 0 : false, colorblind: settings.colorblind, invScale: o.invScale ?? rc.invScale, showBar: o.showBar, time: rc.time,
    anim: {
      speed: o.speed, dashing, reloading: (act & ACT.reloading) !== 0, healing: (act & ACT.healing) !== 0, charge: owner?.charge ?? 0,
      swinging: (act & ACT.swinging) !== 0, sinceShot: 99, sinceHit: 99, airborne: hasStatusBit(st, "airborne") ? 1 : 0,
    },
  });
}
