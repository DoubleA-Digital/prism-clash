// Player movement and collision. Pure functions on purpose: the server runs them for every
// player, and the client runs the exact same code to predict its own player.

import { ITEMS, PLAYER, TERRAIN, WEAPONS } from "../config";
import { clamp } from "../math/vec";
import { resolveCircle, type WallContact } from "./collision";
import { inWater } from "./map";
import type { MapDef } from "./map/types";
import type { Player } from "./types";
import { BTN } from "./types";

export type { WallContact } from "./collision";

export interface MoveInput {
  mx: number;
  my: number;
  aim: number;
  buttons: number;
  pressed: number;
}

export interface MoveResult {
  dashed: boolean;
  wall: WallContact | null;
}

/** Walking speed multiplier from what you hold, healing and standing in water. */
export function speedMult(p: Player, map: MapDef): number {
  const w = p.inv.weapons[p.inv.active];
  let m = w ? WEAPONS[w.id].moveMult : 1;
  if (p.healKind) m *= ITEMS.healMoveMult;
  if ((p.status.slowed ?? 0) > 0 || (p.status.shocked ?? 0) > 0) m *= 0.55;
  if ((p.status.airborne ?? 0) <= 0 && inWater(map, p.x, p.y)) m *= TERRAIN.waterSlow;
  return m;
}

/**
 * Advances one player by dt using its input. Handles dash, statuses that change movement
 * (slow, inverted controls, airborne), knockback decay and collisions with the map.
 * `timeScale` < 1 when the player is inside someone else's Time Bubble.
 */
export function movePlayer(p: Player, input: MoveInput, map: MapDef, dt: number, timeScale = 1): MoveResult {
  const st = p.status;
  const sdt = dt * timeScale;
  let mx = clamp(input.mx, -1, 1);
  let my = clamp(input.my, -1, 1);
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  if ((st.inverted ?? 0) > 0) {
    mx = -mx;
    my = -my;
  }
  p.aim = input.aim;

  let dashed = false;
  p.dashCd = Math.max(0, p.dashCd - sdt);
  const canAct = p.alive && (st.airborne ?? 0) <= 0;
  if (canAct && (input.pressed & BTN.dash) && p.dashCd <= 0 && p.dashT <= 0) {
    // Dash toward movement, or toward the aim if standing still.
    let dx = mx;
    let dy = my;
    if (Math.hypot(dx, dy) < 0.2) {
      dx = Math.cos(p.aim);
      dy = Math.sin(p.aim);
    }
    const dl = Math.hypot(dx, dy) || 1;
    p.dashX = dx / dl;
    p.dashY = dy / dl;
    p.dashT = PLAYER.dash.duration;
    p.dashCd = PLAYER.dash.cooldown;
    st.invulnerable = Math.max(st.invulnerable ?? 0, PLAYER.dash.iframes);
    dashed = true;
  }

  if (p.dashT > 0) {
    const sp = PLAYER.speed * PLAYER.dash.speedMult;
    p.vx = p.dashX * sp;
    p.vy = p.dashY * sp;
    p.dashT = Math.max(0, p.dashT - sdt);
    if (p.dashT <= 0) {
      p.vx *= 0.35;
      p.vy *= 0.35;
    }
  } else if ((st.dashing ?? 0) > 0) {
    // Power-driven dash (Phantom Mark): keep its velocity.
  } else {
    const sp = PLAYER.speed * speedMult(p, map);
    const k = Math.min(1, PLAYER.accel * sdt);
    p.vx += (mx * sp - p.vx) * k;
    p.vy += (my * sp - p.vy) * k;
  }

  // Move in sub-steps no longer than half the radius, so dashes never pass through walls.
  const tx = (p.vx + p.px) * sdt;
  const ty = (p.vy + p.py) * sdt;
  const steps = Math.max(1, Math.ceil(Math.hypot(tx, ty) / (p.r * 0.5)));
  const body = { x: p.x, y: p.y, vx: p.vx + p.px, vy: p.vy + p.py };
  let wall: WallContact | null = null;
  for (let i = 0; i < steps; i++) {
    body.x += tx / steps;
    body.y += ty / steps;
    const c = resolveCircle(map, body, p.r, 0);
    if (c && (!wall || c.impact > wall.impact)) wall = c;
  }
  p.x = body.x;
  p.y = body.y;
  const decay = Math.exp(-5.5 * sdt);
  p.px *= decay;
  p.py *= decay;
  if (Math.abs(p.px) < 1) p.px = 0;
  if (Math.abs(p.py) < 1) p.py = 0;
  if (wall) {
    // Kill the push component going into the obstacle so players don't stick.
    p.px *= 0.2;
    p.py *= 0.2;
  }
  return { dashed, wall };
}
