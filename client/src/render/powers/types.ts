// What a power's visual module gets each frame. Visuals are pure functions of the
// networked effect/projectile state plus time, so every client draws the same thing.

import type { NetEffect, NetPlayer, NetProjectile } from "@prism/shared";
import type { Fx } from "../../fx/fx";

export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  /** Seconds since the page loaded (for animation). */
  time: number;
  dt: number;
  myId: number;
  /** Player color hex by player id. */
  color(id: number): string;
  /** Player by id from the current view (interpolated), if visible. */
  player(id: number): NetPlayer | undefined;
  playerName(id: number): string;
  fx: Fx;
  /** 1 / camera scale: multiply screen pixel sizes by this for world units. */
  invScale: number;
}

export type EffectDrawer = (rc: RenderCtx, e: NetEffect) => void;
export type ProjectileDrawer = (rc: RenderCtx, p: NetProjectile) => void;
