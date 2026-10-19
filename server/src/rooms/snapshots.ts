// Builds each client's snapshot with interest management: only what the viewer could see
// (inside the view range, in line of sight, not hidden in a bush), delta-encoded against the
// last snapshot they acknowledged, plus this tick's events and their private state.
// Destructible state is global (it changes collision for prediction); loot is range-culled.

import {
  encodeDelta, encodeEffect, encodeGlobal, encodeLoot, encodePlayer, encodeProjectile, encodeSelf, encodeSolid,
  INTEREST, NET, type EntityMap, type GameEvent, type Player, type SnapshotWire, type World,
} from "@prism/shared";
import type { Member } from "./member";

/** The player whose view a member gets: themselves, or who they're spectating as a ghost. */
export function viewerFor(w: World, m: Member): Player | null {
  const self = w.players.get(m.id);
  if (self?.alive) return self;
  const target = w.players.get(m.spectate);
  return target?.alive ? target : (self ?? null);
}

const inBox = (v: Player, x: number, y: number, pad = 0) => Math.abs(x - v.x) <= INTEREST.halfW + pad && Math.abs(y - v.y) <= INTEREST.halfH + pad;

export function entityMapFor(w: World, viewer: Player | null): EntityMap {
  const map: EntityMap = new Map();
  const seen = new Set<number>();
  for (const p of w.players.values()) {
    if (viewer && p.alive && !w.visibleTo(viewer, p)) continue;
    if (viewer && !p.alive && !inBox(viewer, p.x, p.y)) continue;
    seen.add(p.id);
    map.set(p.id, encodePlayer(p));
  }
  for (const pr of w.projectiles) {
    if (pr.dead) continue;
    if (viewer && pr.owner !== viewer.id && !seen.has(pr.owner)) {
      if (!inBox(viewer, pr.x, pr.y) || !w.canSee(viewer.x, viewer.y, pr.x, pr.y)) continue;
    } else if (viewer && !inBox(viewer, pr.x, pr.y, 400)) continue;
    map.set(pr.id, encodeProjectile(pr));
  }
  for (const e of w.effects.values()) {
    if (e.dead) continue;
    if (viewer && e.kind !== "supplyDrop" && e.owner !== viewer.id) {
      const far = !inBox(viewer, e.x, e.y, e.r + 300) && !inBox(viewer, e.x2, e.y2, e.r + 300);
      if (far) continue;
      // Clones and decoys of a hidden player are hidden too, so bushes and walls don't leak positions.
      const owner = w.players.get(e.owner);
      if ((e.kind === "clone" || e.kind === "decoy") && owner && !seen.has(owner.id)) continue;
    }
    map.set(e.id, encodeEffect(e));
  }
  for (const s of w.map.solids) if (s.maxHp > 0 && (s.dead || s.hp < s.maxHp)) map.set(s.id, encodeSolid(s.hp, s.dead));
  const lr = INTEREST.lootRange;
  for (const l of w.loot.values()) {
    if (l.dead || (viewer && (Math.abs(l.x - viewer.x) > lr || Math.abs(l.y - viewer.y) > lr))) continue;
    map.set(l.id, encodeLoot(l));
  }
  return map;
}

/** Events far from the viewer are dropped (they'd leak positions); feed-worthy ones always go. */
export function eventVisible(viewer: Player | null, e: GameEvent): boolean {
  if (!viewer) return true;
  switch (e.t) {
    case "kill":
    case "zoneStage":
    case "supply":
    case "win":
      return true;
    case "hit":
      if (e.target === viewer.id || e.by === viewer.id) return true;
      break;
    case "shard":
    case "heal":
    case "reload":
      return e.by === viewer.id;
    default:
      break;
  }
  if ("by" in e && e.by === viewer.id) return true;
  if ("x" in e && "y" in e) return inBox(viewer, e.x, e.y, 500);
  return true;
}

export function buildSnapshot(w: World, m: Member, events: GameEvent[], matchTime: number): SnapshotWire {
  const viewer = viewerFor(w, m);
  const cur = entityMapFor(w, viewer);
  const base = m.ackTick >= 0 && w.tick - m.ackTick <= NET.maxBaselineAgeTicks ? m.baselines.get(m.ackTick) ?? null : null;
  const { e, r } = encodeDelta(base, cur);
  m.baselines.set(w.tick, cur);
  // Keep baselines from the acked one onward; drop anything older.
  for (const t of m.baselines.keys()) if (t < m.ackTick || t < w.tick - NET.maxBaselineAgeTicks - 2) m.baselines.delete(t);
  const self = w.players.get(m.id);
  const alive = w.alivePlayers();
  const snap: SnapshotWire = {
    t: w.tick,
    b: base ? m.ackTick : -1,
    e,
    r,
    ev: viewer ? events.filter((ev) => eventVisible(viewer, ev)) : events,
    g: encodeGlobal(w.zone, alive.length, matchTime),
    y: self ? encodeSelf(self) : [],
  };
  const ids = alive.map((p) => p.id).sort((a, b) => a - b);
  const key = ids.join(",");
  if (!base || key !== m.aliveSent || w.tick - m.aliveSentAt >= NET.aliveListEveryTicks) {
    snap.al = ids;
    m.aliveSent = key;
    m.aliveSentAt = w.tick;
  }
  return snap;
}
