// The client's session with the server: connection, room/lobby state, match phases,
// offers (including in-match shard drafts), results, and the NetView for the match.
// UI screens subscribe to it.

import {
  C2S, inputToWire, NET, S2C,
  type DebugGrant, type Difficulty, type GameEvent, type InputFrame, type MapId, type Phase,
  type PlayerMatchStats, type PowerId, type RoomState, type ServerMsg, type UltId,
} from "@prism/shared";
import { NetView } from "./netview";
import { Connection, serverUrl } from "./socket";

export interface MatchEndInfo {
  winnerId: number;
  stats: PlayerMatchStats[];
  chaosMoment: { playerId: number; damage: number } | null;
}

export interface ShardOffer {
  options: PowerId[];
  endsAt: number;
  total: number;
  replaces: PowerId | null;
}

const TOKEN_KEY = "prism.session";
const NAME_KEY = "prism.name";

export class Session {
  conn = new Connection();
  myId = 0;
  token: string | null = null;
  name = "";
  room: RoomState | null = null;
  phase: Phase | "menu" = "menu";
  phaseEndsAt = 0;
  mapId: MapId = "neonCity";
  seed = 0;
  playerCount = 0;
  view: NetView | null = null;
  ultOptions: UltId[] = [];
  draftOptions: PowerId[] = [];
  draftLocked = new Set<number>();
  myPick: number | null = null;
  shard: ShardOffer | null = null;
  matchEnd: MatchEndInfo | null = null;
  rtt = 0;
  lastError: string | null = null;
  connected = false;
  version = 0;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent, immediate: boolean) => void>();
  private pingTimer = 0;
  private sentFrames: InputFrame[] = [];
  private unsent: InputFrame[] = [];
  private lastInputSend = 0;
  private pendingJoin: { create: boolean; testRoom: boolean; code: string } | null = null;

  constructor() {
    try {
      this.token = sessionStorage.getItem(TOKEN_KEY);
      this.name = localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      /* storage blocked */
    }
  }

  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  onGameEvent(f: (e: GameEvent, immediate: boolean) => void) {
    this.eventListeners.add(f);
    return () => this.eventListeners.delete(f);
  }

  private changed() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  connect() {
    if (this.conn.open) return;
    this.conn = Object.assign(new Connection(), { sim: this.conn.sim });
    this.conn.on((m) => this.onMessage(m));
    this.conn.onOpen(() => {
      this.connected = true;
      this.conn.send({ type: C2S.hello, name: this.name || "Player", token: this.token, version: NET.version });
      this.changed();
    });
    this.conn.onClose(() => {
      this.connected = false;
      window.clearInterval(this.pingTimer);
      this.changed();
      if (this.phase !== "menu") window.setTimeout(() => this.connect(), 1500);
    });
    this.conn.connect(serverUrl());
  }

  setName(n: string) {
    this.name = n;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* storage blocked */
    }
  }

  createRoom(testRoom = false) {
    this.lastError = null;
    this.pendingJoin = { create: true, testRoom, code: "" };
    this.ensureHello();
  }

  joinRoom(code: string) {
    this.lastError = null;
    this.pendingJoin = { create: false, testRoom: false, code: code.toUpperCase() };
    this.ensureHello();
  }

  private ensureHello() {
    if (!this.conn.open) this.connect();
    else if (this.myId) this.flushJoin();
  }

  private flushJoin() {
    const j = this.pendingJoin;
    if (!j) return;
    this.pendingJoin = null;
    if (j.create) this.conn.send({ type: C2S.createRoom, testRoom: j.testRoom });
    else this.conn.send({ type: C2S.joinRoom, code: j.code });
  }

  leave() {
    this.conn.send({ type: C2S.leave });
    this.room = null;
    this.phase = "menu";
    this.view = null;
    this.changed();
  }

  lobbySet(s: { color?: number; ready?: boolean; fillBots?: boolean; botDifficulty?: Difficulty; map?: MapId | "auto"; name?: string }) {
    this.conn.send({ type: C2S.lobbySet, ...s });
  }

  start() {
    this.conn.send({ type: C2S.start });
  }

  kick(id: number) {
    this.conn.send({ type: C2S.kick, playerId: id });
  }

  pickUlt(i: number) {
    this.myPick = i;
    this.conn.send({ type: C2S.pickUlt, index: i });
    this.changed();
  }

  pickPower(i: number) {
    this.myPick = i;
    this.conn.send({ type: C2S.pickPower, index: i });
    this.changed();
  }

  /** In-match Prism Shard pick (the overlay closes right away; the server confirms). */
  pickShard(i: number) {
    if (!this.shard) return;
    this.conn.send({ type: C2S.pickPower, index: i });
    this.shard = null;
    this.changed();
  }

  rematch() {
    this.conn.send({ type: C2S.rematch });
  }

  haunt(kind: "lava" | "slow", x: number, y: number) {
    this.conn.send({ type: C2S.haunt, kind, x, y });
  }

  spectate(id: number) {
    this.conn.send({ type: C2S.spectate, targetId: id });
  }

  debugGrant(playerId: number, power: DebugGrant) {
    this.conn.send({ type: C2S.debugGrant, playerId, power });
  }

  /**
   * Queues this frame's input and sends at most ~60 messages a second (high-refresh
   * monitors batch several frames per message). Each message also repeats the previous
   * two frames, so a dropped packet never loses movement.
   */
  sendInput(f: InputFrame) {
    this.unsent.push(f);
    const now = performance.now();
    if (now - this.lastInputSend < 15 && this.unsent.length < 6) return;
    this.lastInputSend = now;
    const frames = [...this.sentFrames.slice(-2), ...this.unsent];
    this.sentFrames.push(...this.unsent);
    if (this.sentFrames.length > 8) this.sentFrames.splice(0, this.sentFrames.length - 8);
    this.unsent = [];
    const ack = this.view?.lastTick ?? -1;
    this.conn.send({ type: C2S.input, frames: frames.slice(-8).map(inputToWire), ackTick: ack });
  }

  phaseRemaining(now = performance.now()): number {
    return Math.max(0, (this.phaseEndsAt - now) / 1000);
  }

  playerName(id: number): string {
    return this.room?.players.find((p) => p.id === id)?.name ?? "???";
  }

  playerColor(id: number): number {
    return this.room?.players.find((p) => p.id === id)?.color ?? 0;
  }

  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case S2C.welcome:
        this.myId = m.playerId;
        this.token = m.token;
        try {
          sessionStorage.setItem(TOKEN_KEY, m.token);
        } catch {
          /* storage blocked */
        }
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.conn.send({ type: C2S.ping, t: performance.now(), rtt: this.rtt }), NET.pingIntervalMs);
        this.flushJoin();
        break;
      case S2C.pong:
        this.rtt = this.rtt ? this.rtt * 0.75 + (performance.now() - m.t) * 0.25 : performance.now() - m.t;
        break;
      case S2C.roomState:
        this.room = m.room;
        if (this.phase === "menu") this.phase = m.room.phase;
        break;
      case S2C.error:
        this.lastError = m.message;
        break;
      case S2C.kicked:
        this.lastError = m.reason;
        this.room = null;
        this.phase = "menu";
        this.view = null;
        break;
      case S2C.phase:
        this.onPhase(m);
        break;
      case S2C.ultOffer:
        this.ultOptions = m.options;
        this.myPick = null;
        break;
      case S2C.draftOffer:
        this.draftOptions = m.options;
        this.draftLocked.clear();
        this.myPick = null;
        break;
      case S2C.draftLocked:
        this.draftLocked = new Set(m.playerIds);
        break;
      case S2C.shardOffer:
        this.shard = m.options.length ? { options: m.options, endsAt: performance.now() + m.endsIn * 1000, total: Math.max(1, m.endsIn), replaces: m.replaces } : null;
        break;
      case S2C.snapshot:
        if (this.view) this.view.receive(m.snap, performance.now());
        return; // hot path: no UI notify
      case S2C.matchEnd:
        this.matchEnd = { winnerId: m.winnerId, stats: m.stats, chaosMoment: m.chaosMoment };
        break;
      default:
        break;
    }
    this.changed();
  }

  private onPhase(m: Extract<ServerMsg, { type: typeof S2C.phase }>) {
    const prev = this.phase;
    this.phase = m.phase;
    this.phaseEndsAt = performance.now() + m.endsIn * 1000;
    if (m.phase === "countdown" || (m.phase === "round" && (!this.view || this.seed !== m.seed))) {
      // New match: a fresh view of the map (same map + seed as the server).
      this.mapId = m.map;
      this.seed = m.seed;
      this.playerCount = m.playerCount;
      this.view = new NetView(m.map, m.seed, this.myId);
      this.view.onEvent = (e, imm) => this.eventListeners.forEach((f) => f(e, imm));
      this.sentFrames = [];
      this.unsent = [];
      this.shard = null;
    }
    if (m.phase === "lobby" || m.phase === "matchEnd") this.shard = null;
    if (m.phase === "lobby") {
      this.view = null;
      this.matchEnd = null;
    }
    if (m.phase === "ultSelect") this.matchEnd = null;
    if (prev !== m.phase) this.myPick = null;
  }
}

export const session = new Session();
