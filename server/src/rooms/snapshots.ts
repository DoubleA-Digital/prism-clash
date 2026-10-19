// Builds each client's snapshot: what they're allowed to see (nebula hiding), delta-encoded
// against the last snapshot they acknowledged, plus this tick's events and their private state.

import {
  encodeDelta, encodeEffect, encodeGlobal, encodePickup, encodePillar, encodePlayer, encodeProjectile, encodeSelf,
  NET, type EntityMap, type GameEvent, type Player, type SnapshotWire, type World,
} from "@prism/shared";
import type { Member } from "./member";

/** The player whose view a member gets: themselves, or who they're spectating as a ghost. */
export function viewerFor(w: World, m: Member): Player | null {
  const self = w.players.get(m.id);
  if (self?.alive) return self;
  const target = w.players.get(m.spectate);
  return target?.alive ? target : (self ?? null);
}

export function entityMapFor(w: World, viewer: Player | null): EntityMap {
  const map: EntityMap = new Map();
  for (const p of w.players.values()) {
    if (viewer && w.hiddenFrom(viewer, p)) continue;
    map.set(p.id, encodePlayer(p));
  }
  for (const pr of w.projectiles) if (!pr.dead) map.set(pr.id, encodeProjectile(pr));
  for (const e of w.effects.values()) {
    if (e.dead) continue;
    // Clones of a hidden player are hidden too, so the nebula doesn't leak positions.
    const owner = w.players.get(e.owner);
    if ((e.kind === "clone" || e.kind === "decoy") && owner && viewer && w.hiddenFrom(viewer, owner)) continue;
    map.set(e.id, encodeEffect(e));
  }
  for (const pl of w.arena.pillars) map.set(pl.id, encodePillar(pl.hp, pl.dead));
  for (const pk of w.pickups.values()) if (!pk.dead) map.set(pk.id, encodePickup(pk.x, pk.y, pk.kind));
  return map;
}

export function buildSnapshot(w: World, m: Member, events: GameEvent[], roundTime: number): SnapshotWire {
  const viewer = viewerFor(w, m);
  const cur = entityMapFor(w, viewer);
  const base = m.ackTick >= 0 && w.tick - m.ackTick <= NET.maxBaselineAgeTicks ? m.baselines.get(m.ackTick) ?? null : null;
  const { e, r } = encodeDelta(base, cur);
  m.baselines.set(w.tick, cur);
  // Keep baselines from the acked one onward; drop anything older.
  for (const t of m.baselines.keys()) if (t < m.ackTick || t < w.tick - NET.maxBaselineAgeTicks - 2) m.baselines.delete(t);
  const self = w.players.get(m.id);
  return {
    t: w.tick,
    b: base ? m.ackTick : -1,
    e,
    r,
    ev: events,
    g: encodeGlobal(w.zone, w.alivePlayers().length, roundTime),
    y: self ? encodeSelf(self) : [],
  };
}
