// Player movement and collision. Pure functions on purpose: the server runs them for every
// player, and the client runs the exact same code to predict its own player.

import { ARENA, PLAYER } from "../config";
import { clamp } from "../math/vec";
import type { ArenaDef } from "./arena";
import type { Pillar, Player } from "./types";
import { BTN } from "./types";

export interface MoveInput {
  mx: number;
  my: number;
  aim: number;
  buttons: number;
  pressed: number;
}

export interface WallContact {
  nx: number;
  ny: number;
  /** Speed into the wall before the collision (for wall-slam damage). */
  impact: number;
}

/** Keeps a circle inside the arena polygon. Returns the strongest wall contact, if any. */
export function collideArena(arena: ArenaDef, o: { x: number; y: number; vx: number; vy: number }, r: number, bounce: number = ARENA.wallBounce): WallContact | null {
  let contact: WallContact | null = null;
  for (const w of arena.walls) {
    // Signed distance from the wall line, positive = inside.
    const d = (o.x - w.ax) * w.nx + (o.y - w.ay) * w.ny;
    if (d < r) {
      o.x += w.nx * (r - d);
      o.y += w.ny * (r - d);
      const vn = o.vx * w.nx + o.vy * w.ny;
      if (vn < 0) {
        o.vx -= (1 + bounce) * vn * w.nx;
        o.vy -= (1 + bounce) * vn * w.ny;
        if (!contact || -vn > contact.impact) contact = { nx: w.nx, ny: w.ny, impact: -vn };
      }
    }
  }
  return contact;
}

/** Pushes a circle out of pillars. Returns the pillar it hit hardest, if any. */
export function collidePillars(pillars: readonly Pillar[], o: { x: number; y: number; vx: number; vy: number }, r: number): { pillar: Pillar; impact: number } | null {
  let hit: { pillar: Pillar; impact: number } | null = null;
  for (const p of pillars) {
    if (p.dead) continue;
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const rr = r + p.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d;
    const ny = dy / d;
    o.x = p.x + nx * rr;
    o.y = p.y + ny * rr;
    const vn = o.vx * nx + o.vy * ny;
    if (vn < 0) {
      o.vx -= vn * nx;
      o.vy -= vn * ny;
      if (!hit || -vn > hit.impact) hit = { pillar: p, impact: -vn };
    }
  }
  return hit;
}

export interface MoveResult {
  dashed: boolean;
  wall: WallContact | null;
  pillarImpact: { pillar: Pillar; impact: number } | null;
}

/**
 * Advances one player by dt using its input. Handles dash, statuses that change movement
 * (slow, inverted controls, airborne), knockback decay and collisions.
 * `timeScale` < 1 when the player is inside someone else's Time Bubble.
 */
export function movePlayer(p: Player, input: MoveInput, arena: ArenaDef, pillars: readonly Pillar[], dt: number, timeScale = 1): MoveResult {
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

  const slow = (st.slowed ?? 0) > 0 ? 0.55 : 1;
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
    const tx = mx * PLAYER.speed * slow;
    const ty = my * PLAYER.speed * slow;
    const k = Math.min(1, PLAYER.accel * sdt);
    p.vx += (tx - p.vx) * k;
    p.vy += (ty - p.vy) * k;
  }

  p.x += (p.vx + p.px) * sdt;
  p.y += (p.vy + p.py) * sdt;
  const decay = Math.exp(-5.5 * sdt);
  p.px *= decay;
  p.py *= decay;
  if (Math.abs(p.px) < 1) p.px = 0;
  if (Math.abs(p.py) < 1) p.py = 0;

  // Collisions use the combined velocity so knockback into a wall registers as an impact.
  const body = { x: p.x, y: p.y, vx: p.vx + p.px, vy: p.vy + p.py };
  const airborne = (st.airborne ?? 0) > 0;
  const pillarImpact = airborne ? null : collidePillars(pillars, body, p.r);
  const wall = collideArena(arena, body, p.r, 0);
  p.x = body.x;
  p.y = body.y;
  if (wall || pillarImpact) {
    // Kill the push component going into the obstacle so players don't stick.
    const keep = 0.2;
    p.px *= keep;
    p.py *= keep;
  }
  return { dashed, wall, pillarImpact };
}

