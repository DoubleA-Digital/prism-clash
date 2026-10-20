// One room: up to 10 humans, with bots filling the empty seats of the 10-fighter drop, the lobby,
// and the match state machine:
//   lobby → ultSelect → draft → countdown → round (one long battle royale) → matchEnd
// The room ticks at 30 Hz; during the match it steps the authoritative World and sends
// each human a delta snapshot every tick, culled to what they can see.

import {
  applyPick, BOTS, C2S, DEFAULT_HERO, draftOffer, encode, GHOST, HERO_IDS, HUMAN_COLORS, inputFromWire, isHeroId, isMapId, MATCH, NET, PLAY_MAPS, PLAYER, PLAYER_COLORS, POWER_IDS, Rng, S2C, ultOffer, ULT_IDS, World,
  type ClientMsg, type DebugGrant, type Difficulty, type GameEvent, type HeroId, type InputFrame, type MapId, type MatchProgress, type Phase, type PowerId, type RoomSettings, type RoomState, type ServerMsg, type UltId,
} from "@prism/shared";
import { createBrain, prepareBots, type BotBrain } from "../bots/brain";
import { silentLogger, type Logger, type PeerSocket } from "../platform";
import { isInt, isNum, sanitizeName } from "../validate";
import { applyShard, botShardPick, matchResults, openShard, shardReplaces } from "./match";
import { newMember, resetMatchProgress, type Member } from "./member";
import { buildSnapshot } from "./snapshots";
import { debugBuildingSpot, debugFightSpot, debugLoadout } from "./debug";

const TICK_MS = 1000 / NET.tickRate;
const secs = (s: number) => Math.round(s * NET.tickRate);

export class Room {
  readonly code: string;
  members = new Map<number, Member>();
  hostId = 0;
  settings: RoomSettings = { fillBots: true, botDifficulty: "normal", map: "auto", testRoom: false };
  phase: Phase = "lobby";
  /** Room tick (runs in every phase). */
  tick = 0;
  phaseEndsAt = 0;
  world: World | null = null;
  private rng: Rng;
  private bots = new Map<number, BotBrain>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private log: Logger;
  private nextTime = 0;
  private matchStartTick = 0;
  private victoryAt = 0;
  private matches = 0;
  private seed = 0;
  private mapId: MapId = "neonCity";
  private emptySince = 0;
  onEmpty: (() => void) | null = null;

  constructor(code: string, seed: number, testRoom: boolean, opts: { loop?: boolean; log?: Logger } = {}) {
    this.code = code;
    this.log = opts.log ?? silentLogger;
    this.rng = new Rng(seed);
    this.settings.testRoom = testRoom;
    this.nextTime = performance.now();
    if (opts.loop !== false) this.timer = setTimeout(() => this.loop(), TICK_MS);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- membership ------------------------------------------------------------------

  get humans() {
    return [...this.members.values()].filter((m) => !m.bot);
  }

  isFull() {
    return this.humans.length >= NET.maxPlayers || (this.phase !== "lobby" && this.members.size >= MATCH.fighters);
  }

  private freeColor(): number {
    const used = new Set([...this.members.values()].map((m) => m.color));
    return PLAYER_COLORS.find((c) => !used.has(c.id))?.id ?? this.rng.int(PLAYER_COLORS.length);
  }

  private uniqueName(name: string, selfId: number): string {
    const taken = new Set([...this.members.values()].filter((m) => m.id !== selfId).map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 10; i++) {
      const n = `${name.slice(0, 14)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name;
  }

  addHuman(id: number, name: string, token: string, ws: PeerSocket, ip: string): Member | null {
    if (this.isFull()) return null;
    const m = newMember(id, this.uniqueName(name || "Player", id), token, false, ip, Date.now());
    m.color = this.freeColor();
    m.ws = ws;
    m.ready = false;
    // Joining while a match runs: wait in the lobby for the next one.
    m.inLobby = this.phase !== "lobby";
    this.members.set(id, m);
    if (!this.hostId || !this.members.get(this.hostId) || this.members.get(this.hostId)?.bot) this.hostId = id;
    this.broadcastRoom();
    return m;
  }

  /** Same session token within the rejoin window: swap the socket in. */
  rejoin(m: Member, ws: PeerSocket) {
    m.ws = ws;
    m.connected = true;
    m.ackTick = -1;
    m.baselines.clear();
    m.aliveSent = "";
    const p = this.world?.players.get(m.id);
    if (p) p.connected = true;
    this.log.info(`room ${this.code}: ${m.name} rejoined`);
    this.broadcastRoom();
    this.sendPhase(m);
  }

  disconnect(m: Member) {
    m.ws = null;
    m.connected = false;
    m.disconnectedAt = Date.now();
    const p = this.world?.players.get(m.id);
    if (p) p.connected = false;
    if (this.phase === "lobby") this.removeMember(m.id);
    else this.broadcastRoom();
    this.migrateHost();
    // The last one still looking at the results dropped: everyone else is already in the lobby.
    this.lobbyIfResultsEmpty();
  }

  /** On the results screen with every connected human already back in the lobby: reopen it. */
  private lobbyIfResultsEmpty() {
    if (this.phase === "matchEnd" && this.humans.every((h) => h.inLobby || !h.connected)) this.toLobby();
  }

  /**
   * Back to the lobby screen while the match carries on: for the eliminated (the world keeps
   * their stats and placement) and for anyone on the results screen. Spectating stays the default.
   */
  private leaveMatch(m: Member) {
    if (m.bot || m.inLobby) return;
    if (this.phase === "matchEnd") {
      m.inLobby = true;
      m.ready = false;
      this.sendPhase(m);
      this.broadcastRoom();
      this.lobbyIfResultsEmpty();
      return;
    }
    if (this.phase !== "round" && this.phase !== "countdown") return;
    const p = this.world?.players.get(m.id);
    if (p?.alive) return;
    m.inLobby = true;
    m.ready = false;
    m.spectate = 0;
    m.inputs = [];
    m.shardOptions = [];
    m.shardPending = 0;
    this.sendPhase(m);
    this.broadcastRoom();
  }

  removeMember(id: number) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.bots.delete(id);
    const p = this.world?.players.get(id);
    if (p?.alive && this.world) this.world.kill(p);
    this.migrateHost();
    this.broadcastRoom();
  }

  private migrateHost() {
    const host = this.members.get(this.hostId);
    if (host && !host.bot && host.connected) return;
    const next = this.humans.filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) this.hostId = next.id;
  }

  addBot(): Member | null {
    if (this.members.size >= MATCH.fighters) return null;
    const used = new Set([...this.members.values()].map((m) => m.name));
    const name = BOTS.names.find((n) => !used.has(n)) ?? `BOT ${this.members.size}`;
    let id = 1_000_000 + this.rng.int(1e6);
    while (this.members.has(id)) id++;
    const m = newMember(id, name, "", true, "bot", Date.now());
    m.color = this.freeColor();
    m.hero = this.botHero();
    this.members.set(id, m);
    this.bots.set(id, createBrain(this.settings.botDifficulty, this.rng.int(1e9)));
    return m;
  }

  /** A random hero no other bot wears yet (the least used one once all 8 are taken). */
  private botHero(): HeroId {
    const uses = new Map<HeroId, number>(HERO_IDS.map((h) => [h, 0]));
    for (const o of this.members.values()) uses.set(o.hero, (uses.get(o.hero) ?? 0) + (o.bot ? 2 : 1));
    const least = Math.min(...uses.values());
    const pool = HERO_IDS.filter((h) => uses.get(h) === least);
    return pool[this.rng.int(pool.length)] ?? DEFAULT_HERO;
  }

  private fillBots() {
    if (!this.settings.fillBots) return;
    while (this.members.size < MATCH.fighters) if (!this.addBot()) break;
  }

  // ---- messages ----------------------------------------------------------------------

  send(m: Member, msg: ServerMsg) {
    if (!m.ws || m.ws.readyState !== 1) return;
    m.ws.send(encode(msg));
  }

  broadcast(msg: ServerMsg) {
    const data = encode(msg);
    for (const m of this.members.values()) if (m.ws && m.ws.readyState === 1) m.ws.send(data);
  }

  roomState(): RoomState {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: { ...this.settings },
      players: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, color: m.color, hero: m.hero, ready: m.ready, bot: m.bot, connected: m.connected, host: m.id === this.hostId, inLobby: m.inLobby,
      })),
      match: this.matchProgress(),
    };
  }

  private matchProgress(): MatchProgress | null {
    if (this.phase === "lobby" || this.phase === "matchEnd") return null;
    const w = this.world;
    if (!w) {
      const fighters = [...this.members.values()].filter((m) => !m.inLobby).length;
      return { alive: fighters, fighters, elapsed: 0 };
    }
    const elapsed = this.phase === "round" ? Math.max(0, Math.floor((w.tick - this.matchStartTick) / NET.tickRate)) : 0;
    return { alive: w.alivePlayers().length, fighters: w.players.size, elapsed };
  }

  broadcastRoom() {
    this.broadcast({ type: S2C.roomState, room: this.roomState() });
  }

  /** Keeps the lobby's "match in progress" panel current for whoever is waiting there. */
  private updateLobbyWaiters() {
    const waiting = [...this.members.values()].filter((m) => m.inLobby && m.ws);
    if (!waiting.length) return;
    const data = encode({ type: S2C.roomState, room: this.roomState() });
    for (const m of waiting) if (m.ws && m.ws.readyState === 1) m.ws.send(data);
  }

  handle(m: Member, msg: ClientMsg) {
    switch (msg.type) {
      case C2S.input: {
        if (this.phase !== "round" || !Array.isArray(msg.frames)) return;
        if (isInt(msg.ackTick, -1, 2 ** 31)) m.ackTick = msg.ackTick;
        for (const raw of msg.frames.slice(0, 8)) {
          if (!Array.isArray(raw)) continue;
          const f = inputFromWire(raw);
          if (f) m.inputs.push(f);
        }
        // About two seconds of frames; beyond that the client is far ahead of real time.
        if (m.inputs.length > 150) m.inputs.splice(0, m.inputs.length - 150);
        return;
      }
      case C2S.lobbySet:
        return this.lobbySet(m, msg);
      case C2S.kick:
        if (m.id === this.hostId && this.phase === "lobby" && isInt(msg.playerId, 0, 2 ** 31) && msg.playerId !== m.id) {
          const target = this.members.get(msg.playerId);
          if (target) {
            this.send(target, { type: S2C.kicked, reason: "The host removed you from the room." });
            target.ws?.close();
            this.removeMember(target.id);
          }
        }
        return;
      case C2S.start:
        // Never while a match runs. Once it's over, a host waiting in the lobby can start the
        // next one: everyone still on the results screen comes along to the lobby.
        if (m.id !== this.hostId) return;
        if (this.phase === "matchEnd" && m.inLobby) {
          this.toLobby();
          // Those just brought back from the results get to ready up first.
          if (this.humans.some((h) => !h.ready && h.id !== this.hostId)) return;
        }
        if (this.phase === "lobby") this.tryStart();
        return;
      case C2S.leaveMatch:
        return this.leaveMatch(m);
      case C2S.pickUlt:
        if (this.phase === "ultSelect" && isInt(msg.index, 0, 2) && m.ultPick === null && msg.index < m.ultOptions.length) {
          m.ultPick = msg.index;
          this.maybeAdvanceSelection();
        }
        return;
      case C2S.pickPower:
        if (this.phase === "draft" && isInt(msg.index, 0, 3) && m.draftPick === null && msg.index < m.draftOptions.length) {
          m.draftPick = msg.index;
          this.broadcast({ type: S2C.draftLocked, playerIds: [...this.members.values()].filter((x) => x.draftPick !== null).map((x) => x.id) });
          this.maybeAdvanceSelection();
        } else if (this.phase === "round" && this.world && isInt(msg.index, 0, 3) && msg.index < m.shardOptions.length) {
          this.resolveShard(m, msg.index);
        }
        return;
      case C2S.spectate:
        if (isInt(msg.targetId, 0, 2 ** 31)) m.spectate = msg.targetId;
        return;
      case C2S.haunt:
        return this.haunt(m, msg.kind, msg.x, msg.y);
      case C2S.rematch:
        if (this.phase === "matchEnd") this.toLobby();
        return;
      case C2S.debugGrant:
        return this.debugGrant(m, msg.playerId, msg.power);
      default:
        return;
    }
  }

  private lobbySet(m: Member, msg: Extract<ClientMsg, { type: typeof C2S.lobbySet }>) {
    if (this.phase !== "lobby") {
      // Waiting out a match in the lobby: you can ready up for the next one (looks and room
      // settings stay locked while the match uses them).
      if (m.inLobby && typeof msg.ready === "boolean") {
        m.ready = msg.ready;
        this.broadcastRoom();
      }
      return;
    }
    if (isInt(msg.color, 0, HUMAN_COLORS - 1)) {
      const taken = [...this.members.values()].some((o) => o.id !== m.id && o.color === msg.color);
      if (!taken) m.color = msg.color;
    }
    if (isHeroId(msg.hero)) m.hero = msg.hero;
    if (typeof msg.ready === "boolean") m.ready = msg.ready;
    if (typeof msg.name === "string") {
      const n = sanitizeName(msg.name);
      if (n) m.name = this.uniqueName(n, m.id);
    }
    if (m.id === this.hostId) {
      if (typeof msg.fillBots === "boolean") this.settings.fillBots = msg.fillBots;
      if (msg.botDifficulty === "easy" || msg.botDifficulty === "normal" || msg.botDifficulty === "hard") {
        this.settings.botDifficulty = msg.botDifficulty;
        for (const [id] of this.bots) this.bots.set(id, createBrain(msg.botDifficulty, this.rng.int(1e9)));
      }
      if (msg.map === "auto" || (isMapId(msg.map) && (PLAY_MAPS as readonly string[]).includes(msg.map))) this.settings.map = msg.map;
    }
    this.broadcastRoom();
  }

  private tryStart() {
    const willHave = this.settings.fillBots ? MATCH.fighters : this.members.size;
    if (willHave < 2) {
      const host = this.members.get(this.hostId);
      if (host) this.send(host, { type: S2C.error, code: "not_ready", message: "You need at least 2 players. Turn on Fill with bots or wait for a friend." });
      return;
    }
    if (this.humans.some((h) => !h.ready && h.id !== this.hostId)) {
      const host = this.members.get(this.hostId);
      if (host) this.send(host, { type: S2C.error, code: "not_ready", message: "Everyone has to be ready first." });
      return;
    }
    this.fillBots();
    for (const m of this.members.values()) resetMatchProgress(m);
    this.startUltSelect();
  }

  // ---- phases ------------------------------------------------------------------------

  private setPhase(phase: Phase, seconds: number) {
    this.phase = phase;
    this.phaseEndsAt = this.tick + secs(seconds);
    for (const m of this.members.values()) this.sendPhase(m);
  }

  sendPhase(m: Member) {
    if (m.inLobby && this.phase !== "lobby") {
      // Their screen is the lobby until the room gets back there.
      this.send(m, { type: S2C.phase, phase: "lobby", endsIn: 0, map: this.mapId, seed: this.seed, playerCount: this.members.size, tick: this.world?.tick ?? 0 });
      return;
    }
    this.send(m, {
      type: S2C.phase, phase: this.phase, endsIn: (this.phaseEndsAt - this.tick) / NET.tickRate, map: this.mapId,
      seed: this.seed, playerCount: this.world?.players.size ?? this.members.size, tick: this.world?.tick ?? 0,
    });
    if (this.phase === "ultSelect" && m.ultPick === null) this.send(m, { type: S2C.ultOffer, options: m.ultOptions });
    if (this.phase === "draft" && m.draftPick === null) this.send(m, { type: S2C.draftOffer, options: m.draftOptions });
    if (this.phase === "round" && m.shardOptions.length) this.sendShard(m);
  }

  private startUltSelect() {
    for (const m of this.members.values()) {
      m.ultOptions = ultOffer(this.rng);
      m.ultPick = null;
    }
    this.setPhase("ultSelect", MATCH.ultSelectSeconds);
    this.broadcastRoom();
  }

  private startDraft() {
    for (const m of this.members.values()) {
      m.draftOptions = draftOffer(this.rng, m.loadout.slots);
      m.draftPick = null;
    }
    this.setPhase("draft", MATCH.draftSeconds);
  }

  /** Bots and humans have all picked (or time ran out): move on. */
  private maybeAdvanceSelection(timeUp = false) {
    if (this.phase === "ultSelect") {
      const all = [...this.members.values()].every((m) => m.ultPick !== null || !m.connected || m.inLobby);
      if (!all && !timeUp) return;
      for (const m of this.members.values()) {
        const i = m.ultPick ?? this.rng.int(m.ultOptions.length);
        m.ult = (m.ultOptions[i] ?? m.ultOptions[0] ?? "overdrive") as UltId;
      }
      this.startDraft();
      return;
    }
    if (this.phase === "draft") {
      const all = [...this.members.values()].every((m) => m.draftPick !== null || !m.connected || m.inLobby);
      if (!all && !timeUp) return;
      for (const m of this.members.values()) {
        const i = m.draftPick ?? this.rng.int(m.draftOptions.length);
        const pick = m.draftOptions[i] ?? m.draftOptions[0];
        if (pick) m.loadout = applyPick(m.loadout, pick);
      }
      this.startCountdown();
    }
  }

  private startCountdown() {
    this.seed = this.rng.int(2 ** 30);
    this.mapId = this.settings.map === "auto" ? (PLAY_MAPS[this.matches % PLAY_MAPS.length] ?? "neonCity") : this.settings.map;
    this.matches++;
    const w = new World(this.mapId, this.seed);
    for (const m of this.members.values()) {
      // Someone who joined during the picks waits in the lobby for the next match.
      if (m.inLobby) continue;
      const p = w.addPlayer(m.id, m.name, m.color, m.bot);
      p.slots = [0, 1].map((i) => {
        const id = m.loadout.slots[i];
        return id ? { id, cd: 0, recast: 0 } : null;
      });
      p.ult = m.ult ? { id: m.ult, charge: 0 } : null;
      p.connected = m.connected;
      m.inputs = [];
      m.dtBudget = 0;
      m.budgetAt = 0;
      m.ackTick = -1;
      m.baselines.clear();
      m.aliveSent = "";
      m.spectate = 0;
      m.hauntReadyAt = 0;
    }
    w.placeSpawns();
    // Build the bots' nav grid now, during the countdown, rather than on the first round tick.
    if (this.bots.size) prepareBots(w);
    this.world = w;
    this.victoryAt = 0;
    this.log.info(`room ${this.code}: match on ${this.mapId} (seed ${this.seed}), ${w.players.size} fighters`);
    this.setPhase("countdown", MATCH.countdownSeconds);
  }

  private startRound() {
    this.matchStartTick = this.world?.tick ?? 0;
    this.setPhase("round", MATCH.maxSeconds);
  }

  private endMatch() {
    const w = this.world;
    if (!w) return;
    const res = matchResults(w, [...w.players.keys()], this.matchStartTick);
    this.world = null;
    this.setPhase("matchEnd", 3600);
    this.broadcast({ type: S2C.matchEnd, winnerId: res.winnerId, stats: res.stats, chaosMoment: res.chaos });
    this.broadcastRoom();
  }

  private toLobby() {
    this.world = null;
    for (const m of this.members.values()) {
      resetMatchProgress(m);
      // Whoever waited in the lobby and readied up for the next match stays ready.
      m.ready = m.bot || (m.inLobby && m.ready);
      m.inLobby = false;
    }
    // Drop bots that were only fill-ins; the host can fill again.
    for (const m of [...this.members.values()]) if (m.bot) this.removeMember(m.id);
    this.setPhase("lobby", 0);
    this.broadcastRoom();
  }

  // ---- shards, ghosts, debug ---------------------------------------------------------

  private sendShard(m: Member) {
    this.send(m, { type: S2C.shardOffer, options: m.shardOptions, endsIn: Math.max(0, (m.shardEndsAt - this.tick) / NET.tickRate), replaces: shardReplaces(m) });
  }

  private resolveShard(m: Member, index: number) {
    const w = this.world;
    if (!w) return;
    applyShard(w, m, index);
    this.send(m, { type: S2C.shardOffer, options: [], endsIn: 0, replaces: null });
    if (openShard(m, this.rng, this.tick)) this.sendShard(m);
  }

  private stepShards(w: World, events: GameEvent[]) {
    for (const e of events) {
      if (e.t !== "shard") continue;
      const m = this.members.get(e.by);
      if (!m) continue;
      m.shardPending++;
      if (openShard(m, this.rng, this.tick) && !m.bot) this.sendShard(m);
    }
    for (const m of this.members.values()) {
      if (!m.shardOptions.length) continue;
      if (!w.players.get(m.id)?.alive) {
        m.shardOptions = [];
        m.shardPending = 0;
        continue;
      }
      if (m.bot) this.resolveShard(m, botShardPick(m, this.bots.get(m.id)));
      else if (this.tick >= m.shardEndsAt) this.resolveShard(m, this.rng.int(m.shardOptions.length));
    }
  }

  private haunt(m: Member, kind: unknown, x: unknown, y: unknown) {
    const w = this.world;
    if (!w || this.phase !== "round" || (kind !== "lava" && kind !== "slow") || !isNum(x) || !isNum(y)) return;
    const self = w.players.get(m.id);
    if (!self || self.alive || m.inLobby || this.tick < m.hauntReadyAt) return;
    if (!w.insideArena(x, y, 20)) return;
    m.hauntReadyAt = this.tick + secs(GHOST.hauntCooldown);
    const cfg = kind === "lava" ? GHOST.lava : GHOST.slow;
    w.spawnEffect({ kind: kind === "lava" ? "lava" : "slowField", owner: m.id, source: "haunt", x, y, r: cfg.radius, life: cfg.duration, n: 1, v: m.color });
    w.emit({ t: "haunt", by: m.id, kind, x, y });
  }

  private debugGrant(m: Member, playerId: unknown, power: unknown) {
    const w = this.world;
    if (!this.settings.testRoom || !w || !isInt(playerId, 0, 2 ** 31)) return;
    const p = w.players.get(playerId);
    if (!p) return;
    const g = power as DebugGrant;
    if (g === "fullUlt") {
      if (p.ult) p.ult.charge = 100;
    } else if (g === "die") {
      w.kill(p);
    } else if (g === "heal") {
      p.hp = PLAYER.maxHp;
    } else if (g === "loadout") {
      debugLoadout(p);
    } else if (g === "shard") {
      const target = this.members.get(p.id);
      if (target) {
        target.shardPending++;
        if (openShard(target, this.rng, this.tick) && !target.bot) this.sendShard(target);
      }
    } else if (g === "toBuilding" || g === "toFight") {
      const spot = g === "toBuilding" ? debugBuildingSpot(w, p) : debugFightSpot(w, p);
      if (spot) {
        p.x = spot.x;
        p.y = spot.y;
        p.vx = p.vy = p.px = p.py = 0;
        p.warp = 3;
      }
    } else if ((POWER_IDS as readonly string[]).includes(g)) {
      const slot = p.slots[0] ? 1 : 0;
      p.slots[slot] = { id: g as PowerId, cd: 0, recast: 0 };
    } else if ((ULT_IDS as readonly string[]).includes(g)) {
      p.ult = { id: g as UltId, charge: 100 };
    }
    this.log.info(`debug grant ${String(power)} to ${p.name} by ${m.name}`);
  }

  // ---- the loop ----------------------------------------------------------------------

  private loop() {
    if (!this.timer) return;
    const now = performance.now();
    // Catch up if we fell behind (never more than 5 ticks at once).
    let n = 0;
    while (now >= this.nextTime && n < 5) {
      this.step();
      this.nextTime += TICK_MS;
      n++;
    }
    if (now - this.nextTime > 250) this.nextTime = now;
    this.timer = setTimeout(() => this.loop(), Math.max(1, this.nextTime - performance.now()));
  }

  /** One room tick (public so tests can drive a room without real time). */
  step() {
    this.tick++;
    const nowMs = Date.now();

    // Rejoin window
    for (const m of [...this.members.values()]) {
      if (!m.bot && !m.connected && nowMs - m.disconnectedAt > NET.rejoinSeconds * 1000) this.removeMember(m.id);
    }
    if (this.humans.length === 0) {
      this.emptySince ||= nowMs;
      if (nowMs - this.emptySince > 5000) this.onEmpty?.();
      return;
    }
    this.emptySince = 0;

    const timeUp = this.phase !== "lobby" && this.phase !== "matchEnd" && this.tick >= this.phaseEndsAt;
    switch (this.phase) {
      case "ultSelect":
        for (const m of this.members.values()) if (m.bot && m.ultPick === null) m.ultPick = this.bots.get(m.id)?.pickUlt(m.ultOptions) ?? 0;
        this.maybeAdvanceSelection(timeUp);
        break;
      case "draft":
        for (const m of this.members.values()) {
          if (m.bot && m.draftPick === null && this.tick % 10 === m.id % 10) m.draftPick = this.bots.get(m.id)?.pickPower(m.draftOptions, m.loadout.slots) ?? 0;
        }
        this.maybeAdvanceSelection(timeUp);
        break;
      case "countdown":
        // Everyone sees the map and their spawn while counting down.
        if (this.world && this.tick % 3 === 0) this.sendSnapshots(this.world, []);
        if (timeUp) this.startRound();
        break;
      case "round":
        this.stepRound(timeUp);
        break;
      default:
        break;
    }
  }

  private stepRound(timeUp: boolean) {
    const w = this.world;
    if (!w) return;
    const inputs = new Map<number, InputFrame[]>();
    for (const m of this.members.values()) {
      const p = w.players.get(m.id);
      if (!p) continue;
      if (m.bot) {
        const brain = this.bots.get(m.id);
        if (brain && p.alive) inputs.set(m.id, [brain.think(w, p)]);
        continue;
      }
      if (m.inLobby) {
        m.inputs = [];
        continue;
      }
      inputs.set(m.id, this.humanFrames(w, m, p.ackSeq, p.aim));
    }
    w.step(inputs);
    this.stepShards(w, w.events);
    if (!this.victoryAt && (w.alivePlayers().length <= 1 || timeUp)) {
      this.victoryAt = this.tick + secs(MATCH.victorySeconds);
      w.emit({ t: "win", winner: w.alivePlayers().length === 1 ? (w.alivePlayers()[0]?.id ?? 0) : 0 });
    }
    this.sendSnapshots(w, w.events);
    if (this.tick % NET.tickRate === 0) this.updateLobbyWaiters();
    if (this.victoryAt && this.tick >= this.victoryAt) this.endMatch();
  }

  /** A human's frames for this tick, spent from a real-time budget (anti speed-hack). */
  private humanFrames(w: World, m: Member, ackSeq: number, aim: number): InputFrame[] {
    // Wall clock, so a busy server that ticks late doesn't starve honest clients, plus slack.
    const nowMs = performance.now();
    const elapsed = m.budgetAt ? (nowMs - m.budgetAt) / 1000 : w.dt;
    m.budgetAt = nowMs;
    m.dtBudget = Math.min(m.dtBudget + Math.min(elapsed, 0.5), 0.35);
    const frames: InputFrame[] = [];
    const rest: InputFrame[] = [];
    let lastSeq = ackSeq;
    for (const f of m.inputs) {
      if (f.seq <= lastSeq) continue;
      if (rest.length || f.dt > m.dtBudget + 0.002) {
        rest.push(f);
        continue;
      }
      m.dtBudget -= f.dt;
      lastSeq = f.seq;
      frames.push(f);
    }
    m.inputs = rest;
    // Starved for a quarter second (tab in background, packet stall): move them idle so
    // pulls and knockback still apply. Their client reconciles when inputs resume.
    if (frames.length === 0 && m.dtBudget >= 0.34) {
      m.dtBudget -= w.dt;
      frames.push({ seq: ackSeq, mx: 0, my: 0, aim, buttons: 0, pressed: 0, dt: w.dt, shotId: 0 });
    }
    w.latencyTicks.set(m.id, Math.round(((m.rttMs / 2 + 100) / 1000) * NET.tickRate));
    return frames;
  }

  private sendSnapshots(w: World, events: GameEvent[]) {
    const matchTime = this.phase === "round" ? (w.tick - this.matchStartTick) / NET.tickRate : 0;
    for (const m of this.members.values()) {
      if (m.bot || !m.ws || m.inLobby) continue;
      this.send(m, { type: S2C.snapshot, snap: buildSnapshot(w, m, events, matchTime) });
    }
  }

  setRtt(m: Member, rtt: number) {
    m.rttMs = m.rttMs * 0.7 + Math.min(1000, Math.max(0, rtt)) * 0.3;
  }

  static difficulty(d: unknown): Difficulty {
    return d === "easy" || d === "hard" ? d : "normal";
  }
}
