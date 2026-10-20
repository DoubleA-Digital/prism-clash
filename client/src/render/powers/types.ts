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
  /** Where a player's core is drawn this frame (predicted for the local player), if visible. */
  pos?(id: number): { x: number; y: number } | undefined;
  /** Hunter's Eye / spectating: cloaked players are shown clearly. */
  seeCloaked?: boolean;
  /** Is a world point in the viewer's line of sight? Clones and decoys pass for players, so
   *  they're hidden behind walls exactly like players are. Absent = everything visible. */
  canSee?(x: number, y: number): boolean;
  fx: Fx;
  /** 1 / camera scale: multiply screen pixel sizes by this for world units. */
  invScale: number;
}

export type EffectDrawer = (rc: RenderCtx, e: NetEffect) => void;
export type ProjectileDrawer = (rc: RenderCtx, p: NetProjectile) => void;
