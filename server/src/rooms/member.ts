// One seat in a room: a human (with a socket that may drop and rejoin) or a bot.

import type { PeerSocket } from "../platform";
import { DEFAULT_HERO, type DraftLoadout, type EntityMap, type HeroId, type InputFrame, type PowerId, type UltId } from "@prism/shared";

export interface Member {
  id: number;
  name: string;
  color: number;
  hero: HeroId;
  ready: boolean;
  bot: boolean;
  token: string;
  ws: PeerSocket | null;
  connected: boolean;
  disconnectedAt: number;
  joinedAt: number;
  ip: string;

  // Match progress
  loadout: DraftLoadout;
  ult: UltId | null;
  ultOptions: UltId[];
  draftOptions: PowerId[];
  draftPick: number | null;
  ultPick: number | null;
  /** In-match Prism Shard draft: the open offer, when it closes, and shards still waiting. */
  shardOptions: PowerId[];
  shardEndsAt: number;
  shardPending: number;

  // Netcode
  inputs: InputFrame[];
  /** Simulation time the player may still spend (anti speed-hack), refilled by real elapsed time. */
  dtBudget: number;
  budgetAt: number;
  ackTick: number;
  baselines: Map<number, EntityMap>;
  rttMs: number;
  spectate: number;
  hauntReadyAt: number;
  /** Last alive-list sent (and when), so it only rides on snapshots when it changes. */
  aliveSent: string;
  aliveSentAt: number;
  rate: { second: number; inputs: number; other: number; strikes: number };
}

export function newMember(id: number, name: string, token: string, bot: boolean, ip: string, now: number): Member {
  return {
    id, name, color: 0, hero: DEFAULT_HERO, ready: bot, bot, token, ws: null, connected: true, disconnectedAt: 0, joinedAt: now, ip,
    loadout: { slots: [null, null], older: 0 }, ult: null, ultOptions: [], draftOptions: [], draftPick: null, ultPick: null,
    shardOptions: [], shardEndsAt: 0, shardPending: 0,
    inputs: [], dtBudget: 0, budgetAt: 0, ackTick: -1, baselines: new Map(), rttMs: 80, spectate: 0, hauntReadyAt: 0,
    aliveSent: "", aliveSentAt: -9999,
    rate: { second: 0, inputs: 0, other: 0, strikes: 0 },
  };
}

export function resetMatchProgress(m: Member) {
  m.loadout = { slots: [null, null], older: 0 };
  m.ult = null;
  m.shardOptions = [];
  m.shardPending = 0;
  m.shardEndsAt = 0;
}
