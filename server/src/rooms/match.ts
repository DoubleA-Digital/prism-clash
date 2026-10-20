// Match helpers for the room: building the world for a match, the in-match Prism Shard
// draft, and the final placements and stats.

import {
  applyPick, draftOffer, equipPower, MATCH, NET, pickSlot, placements, type PlayerMatchStats, type PowerId, type Rng, type World,
} from "@prism/shared";
import type { BotBrain } from "../bots/brain";
import type { Member } from "./member";

/** Opens the next shard draft for a member, if one is waiting and none is open. */
export function openShard(m: Member, rng: Rng, tick: number): boolean {
  if (m.shardOptions.length || m.shardPending <= 0) return false;
  m.shardPending--;
  m.shardOptions = draftOffer(rng, m.loadout.slots);
  m.shardEndsAt = tick + Math.round(MATCH.shardDraftSeconds * NET.tickRate);
  return m.shardOptions.length > 0;
}

/** Applies a shard pick: fills an empty power slot or replaces the older one. */
export function applyShard(w: World, m: Member, index: number) {
  const pick = m.shardOptions[index] ?? m.shardOptions[0];
  m.shardOptions = [];
  if (!pick) return;
  const slot = pickSlot(m.loadout);
  m.loadout = applyPick(m.loadout, pick);
  const p = w.players.get(m.id);
  if (p?.alive) equipPower(w, p, slot, pick);
}

/** The power a shard pick would replace (for the overlay's hint), or null for an empty slot. */
export function shardReplaces(m: Member): PowerId | null {
  return m.loadout.slots[pickSlot(m.loadout)] ?? null;
}

export function botShardPick(m: Member, brain: BotBrain | undefined): number {
  return brain?.pickPower(m.shardOptions, m.loadout.slots) ?? 0;
}

/** Most damage any one player dealt in a 3-second window. */
export function chaosMoment(w: World): { playerId: number; damage: number } | null {
  const win = 3 * NET.tickRate;
  const byPlayer = new Map<number, { tick: number; amount: number }[]>();
  for (const d of w.damageLog) {
    const list = byPlayer.get(d.by) ?? [];
    list.push(d);
    byPlayer.set(d.by, list);
  }
  let best: { playerId: number; damage: number } | null = null;
  for (const [id, list] of byPlayer) {
    let sum = 0;
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      sum += list[i]?.amount ?? 0;
      while ((list[i]?.tick ?? 0) - (list[j]?.tick ?? 0) > win) sum -= list[j++]?.amount ?? 0;
      if (!best || sum > best.damage) best = { playerId: id, damage: Math.round(sum) };
    }
  }
  return best;
}

/** Final placements and per-player stats for the results screen. */
export function matchResults(w: World, ids: readonly number[], startTick: number): { winnerId: number; stats: PlayerMatchStats[]; chaos: { playerId: number; damage: number } | null } {
  const kills = new Map(ids.map((id) => [id, w.stat(id).kills] as const));
  const pl = placements(ids, w.deaths, kills);
  const chaos = chaosMoment(w);
  const deathTick = new Map(w.deaths.map((d) => [d.id, d.tick] as const));
  const stats: PlayerMatchStats[] = pl.map((p) => {
    const s = w.stat(p.playerId);
    return {
      playerId: p.playerId, place: p.place, kills: s.kills, damage: Math.round(s.damage), shots: s.shots, hits: s.hits, powersUsed: s.powersUsed.size,
      combos: s.combos, healed: s.healed, looted: s.looted, survived: Math.round(((deathTick.get(p.playerId) ?? w.tick) - startTick) / NET.tickRate),
      chaos: chaos?.playerId === p.playerId ? chaos.damage : 0,
    };
  });
  return { winnerId: pl[0]?.playerId ?? 0, stats, chaos };
}
