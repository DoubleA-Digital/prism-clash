// Every network message, both directions. Frames are msgpack: [type, ...payload].
// Hot messages (input, snapshot) are flat arrays of small integers to stay compact.

import type { HeroId } from "../heroes";
import type { MapId } from "../sim/map/types";
import type { GameEvent, PowerId, UltId } from "../sim/types";

export const C2S = {
  hello: 1,
  createRoom: 2,
  joinRoom: 3,
  lobbySet: 4,
  kick: 5,
  start: 6,
  pickUlt: 7,
  /** Pre-match draft pick, or (during the round) the Prism Shard draft pick. */
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
  snapshot: 8,
  matchEnd: 10,
  pong: 11,
  kicked: 12,
  draftLocked: 13,
  /** In-match Prism Shard draft offer (empty options = closed). */
  shardOffer: 14,
} as const;

export type Difficulty = "easy" | "normal" | "hard";
export type Phase = "lobby" | "ultSelect" | "draft" | "countdown" | "round" | "matchEnd";
export const PHASES: readonly Phase[] = ["lobby", "ultSelect", "draft", "countdown", "round", "matchEnd"];

export interface LobbyPlayer {
  id: number;
  name: string;
  color: number;
  /** Chibi hero look (same stats for everyone). */
  hero: HeroId;
  ready: boolean;
  bot: boolean;
  connected: boolean;
  host: boolean;
}

export interface RoomSettings {
  fillBots: boolean;
  botDifficulty: Difficulty;
  map: MapId | "auto";
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

/** Test-room grants: a power or ultimate, or a helper (shard draft, jump into a building or
 *  next to the nearest enemy) for trying systems quickly. */
export type DebugGrant = PowerId | UltId | "fullUlt" | "heal" | "loadout" | "shard" | "toBuilding" | "toFight";

export type ClientMsg =
  | { type: typeof C2S.hello; name: string; token: string | null; version: number }
  | { type: typeof C2S.createRoom; testRoom: boolean }
  | { type: typeof C2S.joinRoom; code: string }
  | { type: typeof C2S.lobbySet; color?: number; hero?: HeroId; ready?: boolean; fillBots?: boolean; botDifficulty?: Difficulty; map?: MapId | "auto"; name?: string }
  | { type: typeof C2S.kick; playerId: number }
  | { type: typeof C2S.start }
  | { type: typeof C2S.pickUlt; index: number }
  | { type: typeof C2S.pickPower; index: number }
  | { type: typeof C2S.input; frames: InputWire[]; ackTick: number }
  | { type: typeof C2S.haunt; kind: "lava" | "slow"; x: number; y: number }
  | { type: typeof C2S.spectate; targetId: number }
  | { type: typeof C2S.ping; t: number; rtt: number }
  | { type: typeof C2S.rematch }
  | { type: typeof C2S.debugGrant; playerId: number; power: DebugGrant }
  | { type: typeof C2S.leave };

/** One input frame on the wire: [seq, mx*127, my*127, aimQ, buttons, pressed, dtMs, shotId]. */
export type InputWire = [number, number, number, number, number, number, number, number];

// ---- server -> client ----------------------------------------------------------------

export interface Placement {
  playerId: number;
  place: number;
  kills: number;
}

export interface PlayerMatchStats {
  playerId: number;
  place: number;
  kills: number;
  damage: number;
  shots: number;
  hits: number;
  powersUsed: number;
  combos: number;
  healed: number;
  looted: number;
  /** Seconds survived. */
  survived: number;
  chaos: number;
}

export type ServerMsg =
  | { type: typeof S2C.welcome; playerId: number; token: string; serverTime: number; tickRate: number }
  | { type: typeof S2C.roomState; room: RoomState }
  | { type: typeof S2C.error; code: string; message: string }
  | { type: typeof S2C.phase; phase: Phase; endsIn: number; map: MapId; seed: number; playerCount: number; tick: number }
  | { type: typeof S2C.ultOffer; options: UltId[] }
  | { type: typeof S2C.draftOffer; options: PowerId[] }
  | { type: typeof S2C.draftLocked; playerIds: number[] }
  | { type: typeof S2C.shardOffer; options: PowerId[]; endsIn: number; replaces: PowerId | null }
  | { type: typeof S2C.snapshot; snap: SnapshotWire }
  | { type: typeof S2C.matchEnd; winnerId: number; stats: PlayerMatchStats[]; chaosMoment: { playerId: number; damage: number } | null }
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
  /** Ids of players still alive, when that list changed (and every so often). */
  al?: number[];
}
