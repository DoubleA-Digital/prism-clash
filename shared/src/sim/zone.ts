// The shrinking safe zone: one long round, six stages, and the center moves somewhere new
// (seeded) every stage, so the final circle can end up anywhere on the map.

import { NET, ZONE } from "../config";
import { dist2 } from "../math/vec";
import type { MapDef } from "./map/types";
import type { World } from "./world";

export interface ZoneState {
  x: number;
  y: number;
  r: number;
  fromX: number;
  fromY: number;
  fromR: number;
  toX: number;
  toY: number;
  toR: number;
  /** -1 before the first stage starts; otherwise the current stage index. */
  stage: number;
  phase: "wait" | "warn" | "shrink" | "done";
  timer: number;
  /** Seconds until the current phase ends (for the HUD). */
  remaining: number;
}

/** Before the first stage the zone covers the whole map. */
export function initialZone(map: MapDef): ZoneState {
  const r = Math.ceil(map.half * Math.SQRT2) + 60;
  return { x: 0, y: 0, r, fromX: 0, fromY: 0, fromR: r, toX: 0, toY: 0, toR: r, stage: -1, phase: "wait", timer: 0, remaining: ZONE.startDelay };
}

export function stepZone(w: World, dt: number) {
  const z = w.zone;
  z.timer += dt;
  const stages = ZONE.stages;
  if (z.phase === "wait") {
    z.remaining = ZONE.startDelay - z.timer;
    if (z.timer >= ZONE.startDelay) beginStage(w, 0);
  } else if (z.phase === "warn") {
    const st = stages[z.stage];
    if (!st) return;
    z.remaining = st.warn - z.timer;
    if (z.timer >= st.warn) {
      z.phase = "shrink";
      z.timer = 0;
    }
  } else if (z.phase === "shrink") {
    const st = stages[z.stage];
    if (!st) return;
    const t = Math.min(1, z.timer / st.shrink);
    const e = t * t * (3 - 2 * t);
    z.x = z.fromX + (z.toX - z.fromX) * e;
    z.y = z.fromY + (z.toY - z.fromY) * e;
    z.r = z.fromR + (z.toR - z.fromR) * e;
    z.remaining = st.shrink - z.timer;
    if (t >= 1) {
      if (z.stage + 1 < stages.length) beginStage(w, z.stage + 1);
      else {
        z.phase = "done";
        z.remaining = 0;
      }
    }
  }
  // Damage outside, applied in half-second chunks.
  if (z.stage >= 0 && w.tick % Math.round(NET.tickRate * 0.5) === 0) {
    const dps = stages[Math.min(z.stage, stages.length - 1)]?.dps ?? 0;
    for (const p of w.players.values()) {
      if (p.alive && dist2(p.x, p.y, z.x, z.y) > z.r * z.r) w.damage(p, dps * 0.5, 0, "zone", { pierce: true, noCharge: true });
    }
  }
}

function beginStage(w: World, i: number) {
  const z = w.zone;
  const st = ZONE.stages[i];
  if (!st) return;
  z.stage = i;
  z.phase = "warn";
  z.timer = 0;
  z.fromX = z.x;
  z.fromY = z.y;
  z.fromR = z.r;
  z.toR = st.radius;
  // New center: anywhere the new circle still fits inside the old one, kept inside the map.
  const lim = w.map.half - ZONE.edgeMargin;
  let tx = z.x;
  let ty = z.y;
  for (let k = 0; k < 12; k++) {
    const maxOff = Math.max(0, z.r - z.toR) * 0.85;
    const a = w.rng.range(0, Math.PI * 2);
    const d = maxOff * Math.sqrt(w.rng.next());
    const cx = Math.max(-lim, Math.min(lim, z.x + Math.cos(a) * d));
    const cy = Math.max(-lim, Math.min(lim, z.y + Math.sin(a) * d));
    if (Math.hypot(cx - z.x, cy - z.y) + z.toR <= z.r || k === 11) {
      tx = cx;
      ty = cy;
      break;
    }
  }
  z.toX = tx;
  z.toY = ty;
  w.emit({ t: "zoneStage", stage: i });
}
