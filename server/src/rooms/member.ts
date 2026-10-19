// One seat in a room: a human (with a socket that may drop and rejoin) or a bot.

import type { WebSocket } from "ws";
import type { DraftLoadout, EntityMap, InputFrame, PowerId, UltId } from "@prism/shared";

export interface Member {
  id: number;
  name: string;
  color: number;
  ready: boolean;
  bot: boolean;
  token: string;
  ws: WebSocket | null;
  connected: boolean;
  disconnectedAt: number;
  joinedAt: number;
  ip: string;

  // Match progress
  points: number;
  roundWins: number;
  totalKills: number;
  totalDamage: number;
  totalShots: number;
  totalHits: number;
  totalCombos: number;
  powersUsed: Set<string>;
  placements: number[];
  loadout: DraftLoadout;
  ult: UltId | null;
  ultOptions: UltId[];
  draftOptions: PowerId[];
  draftPick: number | null;
  ultPick: number | null;

  // Netcode
  inputs: InputFrame[];
  /** Simulation time the player may still spend (anti speed-hack). */
  dtBudget: number;
  ackTick: number;
  baselines: Map<number, EntityMap>;
  rttMs: number;
  spectate: number;
  hauntReadyAt: number;
  rate: { second: number; inputs: number; other: number; strikes: number };
}

export function newMember(id: number, name: string, token: string, bot: boolean, ip: string, now: number): Member {
  return {
    id, name, color: 0, ready: bot, bot, token, ws: null, connected: true, disconnectedAt: 0, joinedAt: now, ip,
    points: 0, roundWins: 0, totalKills: 0, totalDamage: 0, totalShots: 0, totalHits: 0, totalCombos: 0, powersUsed: new Set(), placements: [],
    loadout: { slots: [null, null], older: 0 }, ult: null, ultOptions: [], draftOptions: [], draftPick: null, ultPick: null,
    inputs: [], dtBudget: 0, ackTick: -1, baselines: new Map(), rttMs: 80, spectate: 0, hauntReadyAt: 0,
    rate: { second: 0, inputs: 0, other: 0, strikes: 0 },
  };
}

export function resetMatchProgress(m: Member) {
  m.points = 0;
  m.roundWins = 0;
  m.totalKills = 0;
  m.totalDamage = 0;
  m.totalShots = 0;
  m.totalHits = 0;
  m.totalCombos = 0;
  m.powersUsed = new Set();
  m.placements = [];
  m.loadout = { slots: [null, null], older: 0 };
  m.ult = null;
}
