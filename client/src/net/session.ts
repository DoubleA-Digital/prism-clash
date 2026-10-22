// The client's session with the server: connection, room/lobby state, match phases,
// offers (including in-match shard drafts), results, and the NetView for the match.
// UI screens subscribe to it.

import {
  C2S, DEFAULT_HERO, inputToWire, isHeroId, NET, S2C,
  type DebugGrant, type Difficulty, type GameEvent, type HeroId, type InputFrame, type LobbyPlayer, type MapId, type Phase,
  type PlayerMatchStats, type PowerId, type RoomState, type ServerMsg, type UltId,
} from "@prism/shared";
import { NetView } from "./netview";
import { currentServer } from "./serverUrl";
import { Connection } from "./socket";
import { WorkerTransport, WsTransport, type Transport } from "./transport";

export interface MatchEndInfo {
  winnerId: number;
  stats: PlayerMatchStats[];
  chaosMoment: { playerId: number; damage: number } | null;
}

/** Your own line from the last match's results (shown in the lobby, e.g. after leaving early). */
export interface MyResult {
  place: number;
  kills: number;
  fighters: number;
  winnerId: number;
}

export interface ShardOffer {
  options: PowerId[];
  endsAt: number;
  total: number;
  replaces: PowerId | null;
}

const TOKEN_KEY = "prism.session";
/** Shown when an online room can't reach a game server (static deploys with no server, a server that's down). */
export const OFFLINE_MESSAGE = "Online rooms need the game server — Practice vs Bots works right now";
const WAKING_MESSAGE = "Connecting to the game server… a sleeping server can take up to a minute to wake.";
/** The server came back without our room (it restarted or slept: rooms live only in its memory). */
export const ROOM_LOST_MESSAGE = "The game server restarted, so that room closed. Create a new room to keep playing.";
/** Status messages shown in the menu's message line in the calm notice style rather than as errors. */
export const isNotice = (msg: string | null) => msg === OFFLINE_MESSAGE || msg === WAKING_MESSAGE || msg === ROOM_LOST_MESSAGE;
/** Give up on a connection that never opens (a sleeping Render server wakes well inside this). */
const CONNECT_TIMEOUT_MS = 70_000;
const WAKING_AFTER_MS = 3_000;
/** Dropped mid-room: keep retrying this long before giving up on the room (a blip reconnects in seconds). */
const REJOIN_TIMEOUT_MS = 15_000;
const RETRY_MS = 1_500;

/** The practice server: the whole authoritative server in a Web Worker (see practice.worker.ts). */
function practiceWorker(): Worker {
  return new Worker(new URL("./practice.worker.ts", import.meta.url), { type: "module", name: "prism-practice" });
}
const NAME_KEY = "prism.name";
const HERO_KEY = "prism.hero";

export class Session {
  conn = new Connection();
  myId = 0;
  token: string | null = null;
  name = "";
  /** The hero you last picked (remembered across visits). */
  hero: HeroId = DEFAULT_HERO;
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
  lastResult: MyResult | null = null;
  /** A solo practice session on the in-browser server (leaving goes back to the main menu). */
  get isPractice() {
    return this.mode === "local";
  }
  rtt = 0;
  lastError: string | null = null;
  connected = false;
  /** "local": Practice vs Bots in the in-browser worker; "online": a game server. */
  mode: "online" | "local" = "online";
  version = 0;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent, immediate: boolean) => void>();
  private pingTimer = 0;
  private sentFrames: InputFrame[] = [];
  private unsent: InputFrame[] = [];
  private lastInputSend = 0;
  private pendingJoin: { create: boolean; testRoom: boolean; code: string } | null = null;
  private connectTimers: number[] = [];
  /** The token sent in this connection's hello: a welcome with a different one means the room is gone. */
  private helloToken: string | null = null;
  /** While reconnecting to a room we dropped out of: when to give up and go back to the menu. */
  private rejoinUntil = 0;
  /** Everyone seen in the room this match, so results still name players who left. */
  private known = new Map<number, LobbyPlayer>();

  constructor() {
    try {
      this.token = sessionStorage.getItem(TOKEN_KEY);
      this.name = localStorage.getItem(NAME_KEY) ?? "";
      const hero = localStorage.getItem(HERO_KEY);
      if (isHeroId(hero)) this.hero = hero;
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

  private transport(): Transport {
    return this.mode === "local" ? new WorkerTransport(practiceWorker) : new WsTransport(currentServer().url);
  }

  /** Switches between online and local practice, dropping the other connection. */
  private useMode(mode: "online" | "local") {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.conn.kind) {
      const old = this.conn;
      this.conn = Object.assign(new Connection(), { sim: old.sim });
      old.close();
    }
    this.connected = false;
    this.myId = 0;
  }

  connect() {
    if (this.conn.open) return;
    // A connection still trying to open is replaced, not left running beside the new one.
    if (this.conn.kind) this.conn.close();
    const conn = Object.assign(new Connection(), { sim: this.conn.sim });
    this.conn = conn;
    this.myId = 0;
    // Events from a connection we've since replaced are ignored.
    conn.on((m) => {
      if (conn === this.conn) this.onMessage(m);
    });
    conn.onOpen(() => {
      if (conn !== this.conn) return;
      this.clearConnectTimers();
      if (this.lastError === WAKING_MESSAGE) this.lastError = null;
      this.connected = true;
      const token = this.mode === "online" ? this.token : null;
      this.helloToken = token;
      conn.send({ type: C2S.hello, name: this.name || "Player", token, version: NET.version });
      this.changed();
    });
    conn.onClose((reason, opened) => {
      if (conn !== this.conn) return;
      this.clearConnectTimers();
      this.connected = false;
      window.clearInterval(this.pingTimer);
      if (this.mode === "online" && this.phase !== "menu") {
        // Dropped out of a room: retry for a while (the server rejoins us by token), then give up.
        if (opened) this.rejoinUntil = performance.now() + REJOIN_TIMEOUT_MS;
        if (performance.now() < this.rejoinUntil) window.setTimeout(() => this.retry(conn), RETRY_MS);
        else {
          this.lastError = ROOM_LOST_MESSAGE;
          this.toMenu();
        }
      } else if (!opened) {
        // Never connected: no server here (static deploy) or it's down. Say so, kindly.
        this.pendingJoin = null;
        this.lastError = this.mode === "local" ? reason : OFFLINE_MESSAGE;
        this.toMenu();
      } else if (this.mode === "local" && this.phase !== "menu") {
        this.lastError = reason;
        this.toMenu();
      }
      this.changed();
    });
    if (this.mode === "online") {
      this.connectTimers.push(
        window.setTimeout(() => {
          if (conn === this.conn && !conn.open && this.pendingJoin) {
            this.lastError = WAKING_MESSAGE;
            this.changed();
          }
        }, WAKING_AFTER_MS),
        window.setTimeout(() => {
          if (conn === this.conn && !conn.open) conn.close();
        }, this.phase !== "menu" ? Math.max(1000, this.rejoinUntil - performance.now()) : CONNECT_TIMEOUT_MS),
      );
    }
    conn.connect(this.transport());
  }

  /** A reconnect attempt, unless something newer (leaving, a fresh connect) already replaced it. */
  private retry(dropped: Connection) {
    if (dropped === this.conn && this.phase !== "menu") this.connect();
  }

  /** Online and in a room, but the connection dropped: we're trying to get back in. */
  get reconnecting() {
    return this.mode === "online" && this.phase !== "menu" && !this.connected;
  }

  private clearConnectTimers() {
    for (const t of this.connectTimers) window.clearTimeout(t);
    this.connectTimers = [];
  }

  private toMenu() {
    this.room = null;
    this.phase = "menu";
    this.view = null;
    this.shard = null;
  }

  setName(n: string) {
    this.name = n;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* storage blocked */
    }
  }

  /** Picks your hero: remembered locally and sent to the room (lobby only). */
  setHero(id: HeroId) {
    this.hero = id;
    try {
      localStorage.setItem(HERO_KEY, id);
    } catch {
      /* storage blocked */
    }
    if (this.room && this.room.phase === "lobby") this.lobbySet({ hero: id });
  }

  createRoom(testRoom = false) {
    this.lastError = null;
    this.useMode("online");
    this.pendingJoin = { create: true, testRoom, code: "" };
    this.ensureHello();
  }

  /** Practice vs Bots: a room on the in-browser server (works offline, no game server needed). */
  practice(testRoom = false) {
    this.lastError = null;
    this.useMode("local");
    this.pendingJoin = { create: true, testRoom, code: "" };
    this.ensureHello();
  }

  joinRoom(code: string) {
    this.lastError = null;
    this.useMode("online");
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
    this.toMenu();
    // Leaving practice shuts the local server down; the next practice starts a fresh one.
    if (this.mode === "local") this.conn.close();
    this.lastResult = null;
    this.changed();
  }

  /** Eliminated (or done with the results): back to the room's lobby while the match goes on. */
  leaveMatch() {
    this.conn.send({ type: C2S.leaveMatch });
  }

  lobbySet(s: { color?: number; hero?: HeroId; ready?: boolean; fillBots?: boolean; botDifficulty?: Difficulty; map?: MapId | "auto"; name?: string }) {
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

  private player(id: number): LobbyPlayer | undefined {
    return this.room?.players.find((p) => p.id === id) ?? this.known.get(id);
  }

  playerName(id: number): string {
    return this.player(id)?.name ?? "???";
  }

  playerColor(id: number): number {
    return this.player(id)?.color ?? 0;
  }

  playerHero(id: number): HeroId {
    return this.player(id)?.hero ?? DEFAULT_HERO;
  }

  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case S2C.welcome:
        this.myId = m.playerId;
        this.rejoinUntil = 0;
        if (this.mode === "online" && this.phase !== "menu" && m.token !== this.helloToken) {
          // Reconnected, but the server doesn't know our session: it restarted and the room is gone.
          // Without this the match screen waits forever for snapshots that never come (a black screen).
          this.lastError = ROOM_LOST_MESSAGE;
          this.toMenu();
        }
        // Only online sessions can be rejoined; a practice token would overwrite the real one.
        if (this.mode === "online") {
          this.token = m.token;
          try {
            sessionStorage.setItem(TOKEN_KEY, m.token);
          } catch {
            /* storage blocked */
          }
        }
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.conn.send({ type: C2S.ping, t: performance.now(), rtt: this.rtt }), NET.pingIntervalMs);
        this.flushJoin();
        break;
      case S2C.pong:
        this.rtt = this.rtt ? this.rtt * 0.75 + (performance.now() - m.t) * 0.25 : performance.now() - m.t;
        break;
      case S2C.roomState: {
        const joined = this.room?.code !== m.room.code;
        this.room = m.room;
        // A fresh room starts everyone on the default hero: bring your remembered pick along.
        const me = m.room.players.find((p) => p.id === this.myId);
        if (joined && me && me.hero !== this.hero && m.room.phase === "lobby") this.lobbySet({ hero: this.hero });
        for (const p of m.room.players) this.known.set(p.id, p);
        if (this.phase === "menu") this.phase = me?.inLobby ? "lobby" : m.room.phase;
        break;
      }
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
        this.lastResult = myResult(m.stats, this.myId, m.winnerId);
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
    if (m.phase === "ultSelect") {
      this.matchEnd = null;
      this.lastResult = null;
      this.known.clear();
    }
    if (prev !== m.phase) this.myPick = null;
  }
}

function myResult(stats: PlayerMatchStats[], myId: number, winnerId: number): MyResult | null {
  const mine = stats.find((s) => s.playerId === myId);
  return mine ? { place: mine.place, kills: mine.kills, fighters: stats.length, winnerId } : null;
}

export const session = new Session();
