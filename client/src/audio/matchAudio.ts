// Per-frame match audio that no single server event covers: the music director (exploration
// → rising intensity → final duel), the zone-shrinking drone, footsteps per surface and bush
// rustle, grenade bounces, the Prism Lance charge hum, heal-loop cancel and the placement
// stinger. Everything is positional through the engine mixer and voice-capped.

import { PROJ, type NetGlobal, type NetProjectile } from "@prism/shared";
import { audio } from "./audio";
import { sustains } from "./sustains";

// ---- music director ---------------------------------------------------------------------------

const STAGES = 6;

/**
 * Match intensity 0..1 for the music: near 0 while looting before the first zone (calm
 * exploration groove), rising with zone progress (a bump while it is shrinking) and as fewer
 * fighters remain.
 */
export function matchIntensity(g: NetGlobal | null, fighters: number): number {
  if (!g) return 0;
  const sub = g.phase === "shrink" ? 0.5 : g.phase === "done" ? 1 : 0;
  const progress = g.stage < 0 ? 0 : Math.min(1, (g.stage + sub) / STAGES);
  const few = fighters > 1 ? 1 - (Math.max(1, g.alive) - 1) / (fighters - 1) : 0;
  const shrinking = g.phase === "shrink" ? 0.08 : 0;
  return Math.max(0, Math.min(1, 0.03 + 0.6 * progress + 0.45 * few ** 1.3 + shrinking));
}

export interface MatchAudioState {
  /** Latest zone/match globals from the snapshot (null outside a match). */
  g: NetGlobal | null;
  /** Fighters at match start (12). */
  fighters: number;
  /** The listener is outside the safe zone (the drone gets louder and more urgent). */
  outside?: boolean;
}

/**
 * Call once per frame during a match: drives the music intensity and the final-duel layer
 * (last 2 alive) and holds the zone drone while the zone shrinks or you stand outside it.
 * (The low-HP heartbeat is already driven by audio.matchFrame.)
 */
export function updateMatchAudio(s: MatchAudioState) {
  const m = audio.music;
  const g = s.g;
  m?.setIntensity(matchIntensity(g, s.fighters));
  m?.setDuel(!!g && g.alive === 2 && s.fighters > 2);
  const shrinking = g?.phase === "shrink";
  if (g && (shrinking || s.outside)) {
    const progress = g.stage < 0 ? 0 : Math.min(1, (g.stage + 1) / STAGES);
    sustains.hold("zone", "zoneDrone", { param: Math.min(1, progress + (s.outside ? 0.35 : 0)), level: s.outside ? 1.25 : 0.8 });
  } else sustains.release("zone");
}

// ---- footsteps --------------------------------------------------------------------------------

export type Surface = "floor" | "water" | "bush";

export interface Mover {
  id: number;
  x: number;
  y: number;
}

interface StepState {
  x: number;
  y: number;
  acc: number;
  surface: Surface;
  seen: number;
}

const STRIDE: Record<Surface, number> = { floor: 78, water: 96, bush: 84 };
const STEP_RANGE = 950;
const steps = new Map<number, StepState>();

/**
 * Call once per frame with every visible fighter (interpolated positions). Plays a footstep
 * every stride of travel, by surface: floor ticks, water splashes, bush rustles (plus an
 * immediate rustle when someone enters a bush). Quiet and short-ranged; your own are centered.
 */
export function trackFootsteps(movers: readonly Mover[], surfaceAt: (x: number, y: number) => Surface, myId: number) {
  const now = performance.now();
  const l = audio.listenerPos;
  for (const p of movers) {
    const own = p.id === myId;
    if (!own && Math.hypot(p.x - l.x, p.y - l.y) > STEP_RANGE) {
      steps.delete(p.id);
      continue;
    }
    const surface = surfaceAt(p.x, p.y);
    const st = steps.get(p.id);
    if (!st) {
      steps.set(p.id, { x: p.x, y: p.y, acc: 0, surface, seen: now });
      continue;
    }
    const d = Math.hypot(p.x - st.x, p.y - st.y);
    st.x = p.x;
    st.y = p.y;
    st.seen = now;
    if (d > 160) {
      st.acc = 0;
      st.surface = surface;
      continue;
    }
    if (surface === "bush" && st.surface !== "bush" && d > 0.5) {
      st.acc = 0;
      step(p, "bush", own, 1.2);
    }
    st.surface = surface;
    st.acc += d;
    if (st.acc >= STRIDE[surface]) {
      st.acc %= STRIDE[surface];
      step(p, surface, own, 1);
    }
  }
  for (const [id, st] of steps) if (now - st.seen > 1000) steps.delete(id);
}

function step(p: Mover, surface: Surface, own: boolean, boost: number) {
  const pitch = 0.9 + Math.random() * 0.2;
  const base = surface === "floor" ? 0.45 : 0.6;
  audio.sfx(`step:${surface}`, p.x, p.y, {
    positional: !own, gain: base * boost * (own ? 0.7 : 1), pitch, range: STEP_RANGE, ref: 240, group: own ? "step:own" : "step", cap: own ? 2 : 4,
  });
}

// ---- grenade bounces --------------------------------------------------------------------------

const grenades = new Map<number, { vx: number; vy: number }>();

/** Call once per frame with the visible projectiles: grenades clink when they bounce. */
export function trackProjectiles(projectiles: readonly NetProjectile[]) {
  const alive = new Set<number>();
  for (const p of projectiles) {
    if (p.kind !== PROJ.grenade) continue;
    alive.add(p.id);
    const prev = grenades.get(p.id);
    grenades.set(p.id, { vx: p.vx, vy: p.vy });
    if (!prev) continue;
    const a = Math.hypot(prev.vx, prev.vy);
    const b = Math.hypot(p.vx, p.vy);
    if (a < 60 || b < 1) continue;
    // A bounce reflects the velocity: the direction swings by more than ~70 degrees.
    if (prev.vx * p.vx + prev.vy * p.vy < 0.35 * a * b) {
      audio.sfx("grenade:bounce", p.x, p.y, { gain: Math.min(1, 0.35 + a / 700), pitch: 0.9 + Math.random() * 0.2, range: 1100, group: "grenade:bounce", cap: 3 });
    }
  }
  for (const id of grenades.keys()) if (!alive.has(id)) grenades.delete(id);
}

// ---- lance charge, heal cancel ------------------------------------------------------------------

/**
 * Prism Lance charge hum. Call every frame while a fighter holds the trigger with charge 0..1
 * (omit x/y for your own, centered). It pings when full, stops on its own when the calls stop,
 * and the beam's shoot event stops it immediately.
 */
export function lanceCharge(playerId: number, charge: number, x?: number, y?: number) {
  sustains.hold(`lance:${playerId}`, "lanceCharge", { param: charge, x, y });
}

export function stopLanceCharge(playerId: number) {
  sustains.release(`lance:${playerId}`);
}

/** A heal channel was cancelled (moved, swapped, shot): stop its loop. */
export function stopHeal(playerId: number) {
  sustains.release(`heal:${playerId}`);
}

// ---- stingers, reset --------------------------------------------------------------------------

/** Results stinger for your final placement: #1 fanfare, top-3 cadence, or the sad sting. */
export function placementSting(place: number) {
  const name = place <= 1 ? "sting:victory" : place <= 3 ? "sting:placement" : "sting:eliminated";
  audio.sfx(name, 0, 0, { positional: false, gain: 0.9, group: "sting", cap: 1 });
}

/** Leaving a match: stop every loop, forget trackers. */
export function resetMatchAudio() {
  sustains.releaseAll();
  steps.clear();
  grenades.clear();
  audio.music?.setDuel(false);
}
