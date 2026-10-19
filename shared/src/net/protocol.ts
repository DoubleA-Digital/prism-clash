// Every network message, both directions. Frames are msgpack: [type, ...payload].
// Hot messages (input, snapshot) are flat arrays of small integers to stay compact.

import type { LayoutId } from "../sim/arena";
import type { GameEvent, PowerId, UltId } from "../sim/types";

export const C2S = {
  hello: 1,
  createRoom: 2,
  joinRoom: 3,
  lobbySet: 4,
  kick: 5,
  start: 6,
  pickUlt: 7,
  pickPower: 8,
  input: 9,
  haunt: 10,
  spectate: 11,
  ping: 12,
  rematch: 13,
  debugGrant: 14,
  leave: 15,
} as const;

export const S2C = {
  welcome: 1,
  roomState: 2,
  error: 3,
  phase: 4,
  ultOffer: 5,
  draftOffer: 6,
  draftReveal: 7,
  snapshot: 8,
  roundEnd: 9,
  matchEnd: 10,
  pong: 11,
  kicked: 12,
  draftLocked: 13,
} as const;

export type Difficulty = "easy" | "normal" | "hard";
export type Phase = "lobby" | "ultSelect" | "draft" | "countdown" | "round" | "replay" | "standings" | "matchEnd";
export const PHASES: readonly Phase[] = ["lobby", "ultSelect", "draft", "countdown", "round", "replay", "standings", "matchEnd"];

export interface LobbyPlayer {
  id: number;
  name: string;
  color: number;
  ready: boolean;
  bot: boolean;
  connected: boolean;
  host: boolean;
  points: number;
}

export interface RoomSettings {
  fillBots: boolean;
  botDifficulty: Difficulty;
  layout: LayoutId | "auto";
  /** Debug test room: F1 grants allowed. */
  testRoom: boolean;
}

export interface RoomState {
  code: string;
  hostId: number;
  players: LobbyPlayer[];
  settings: RoomSettings;
  phase: Phase;
}

// ---- client -> server ----------------------------------------------------------------

export type ClientMsg =
  | { type: typeof C2S.hello; name: string; token: string | null; version: number }
  | { type: typeof C2S.createRoom; testRoom: boolean }
  | { type: typeof C2S.joinRoom; code: string }
  | { type: typeof C2S.lobbySet; color?: number; ready?: boolean; fillBots?: boolean; botDifficulty?: Difficulty; layout?: LayoutId | "auto"; name?: string }
  | { type: typeof C2S.kick; playerId: number }
  | { type: typeof C2S.start }
  | { type: typeof C2S.pickUlt; index: number }
  | { type: typeof C2S.pickPower; index: number }
  | { type: typeof C2S.input; frames: InputWire[]; ackTick: number }
  | { type: typeof C2S.haunt; kind: "lava" | "slow"; x: number; y: number }
  | { type: typeof C2S.spectate; targetId: number }
  | { type: typeof C2S.ping; t: number; rtt: number }
  | { type: typeof C2S.rematch }
  | { type: typeof C2S.debugGrant; playerId: number; power: PowerId | UltId | "fullUlt" | "heal" }
  | { type: typeof C2S.leave };

/** One input frame on the wire: [seq, mx*127, my*127, aimQ, buttons, pressed, dtMs, shotId]. */
export type InputWire = [number, number, number, number, number, number, number, number];

// ---- server -> client ----------------------------------------------------------------

export interface DraftCard {
  power: PowerId;
}

export interface Loadout {
  playerId: number;
  slots: (PowerId | null)[];
  ult: UltId | null;
}

export interface Placement {
  playerId: number;
  place: number;
  points: number;
  kills: number;
}

export interface PlayerMatchStats {
  playerId: number;
  points: number;
  kills: number;
  damage: number;
  shots: number;
  hits: number;
  powersUsed: number;
  combos: number;
  roundWins: number;
  placements: number[];
  chaos: number;
}

export type ServerMsg =
  | { type: typeof S2C.welcome; playerId: number; token: string; serverTime: number; tickRate: number }
  | { type: typeof S2C.roomState; room: RoomState }
  | { type: typeof S2C.error; code: string; message: string }
  | { type: typeof S2C.phase; phase: Phase; endsIn: number; round: number; layout: LayoutId; seed: number; playerCount: number; tick: number }
  | { type: typeof S2C.ultOffer; options: UltId[] }
  | { type: typeof S2C.draftOffer; options: PowerId[]; pickNumber: number; picks: number }
  | { type: typeof S2C.draftLocked; playerIds: number[] }
  | { type: typeof S2C.draftReveal; loadouts: Loadout[] }
  | { type: typeof S2C.snapshot; snap: SnapshotWire }
  | { type: typeof S2C.roundEnd; placements: Placement[]; totals: Record<number, number>; killTick: number; killerId: number; victimId: number; winnerId: number; round: number }
  | { type: typeof S2C.matchEnd; winnerId: number; stats: PlayerMatchStats[]; chaosMoment: { playerId: number; damage: number; round: number } | null }
  | { type: typeof S2C.pong; t: number; serverTime: number; tick: number }
  | { type: typeof S2C.kicked; reason: string };

/** Snapshot payload. Entities are delta-encoded against the client's acked baseline. */
export interface SnapshotWire {
  /** Server tick. */
  t: number;
  /** Baseline tick, or -1 for a full snapshot. */
  b: number;
  /** Delta-encoded entities (see delta.ts). */
  e: number[];
  /** Removed entity ids. */
  r: number[];
  /** Events this tick (only since the previous snapshot sent to this client). */
  ev: GameEvent[];
  /** Global state: zone etc. (see GLOBAL fields). */
  g: number[];
  /** The receiving player's private state (prediction + HUD), or empty when dead/spectating. */
  y: number[];
}
