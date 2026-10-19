// One room: up to 5 players (humans and bots), the lobby, and the match state machine.
//   lobby → ultSelect → draft → countdown → round → replay → standings → draft … → matchEnd
// The room ticks at 30 Hz; during a round it steps the authoritative World and sends
// each player a delta snapshot every tick.

import type { WebSocket } from "ws";
import {
  applyPick, BOTS, C2S, comebackPlayers, draftOffer, encode, GHOST, inputFromWire, LAYOUTS, MATCH, matchLeader, matchOver, NET,
  offerSize, placements, PLAYER_COLORS, POWER_IDS, Rng, S2C, ultOffer, World,
  type ClientMsg, type Difficulty, type GameEvent, type InputFrame, type LayoutId, type Phase, type PlayerMatchStats, type PowerId, type RoomSettings, type RoomState, type ServerMsg, type UltId,
} from "@prism/shared";
import { createBrain, type BotBrain } from "../bots/brain";
import { log } from "../log";
import { isInt, isNum, sanitizeName } from "../validate";
import { newMember, resetMatchProgress, type Member } from "./member";
import { buildSnapshot } from "./snapshots";

const TICK_MS = 1000 / NET.tickRate;
const secs = (s: number) => Math.round(s * NET.tickRate);

export class Room {
  readonly code: string;
  members = new Map<number, Member>();
  hostId = 0;
  settings: RoomSettings = { fillBots: true, botDifficulty: "normal", layout: "auto", testRoom: false };
  phase: Phase = "lobby";
  /** Room tick (runs in every phase). */
  tick = 0;
  phaseEndsAt = 0;
  round = 0;
  world: World | null = null;
  private rng: Rng;
  private bots = new Map<number, BotBrain>();
  private timer: NodeJS.Timeout | null = null;
  private nextTime = 0;
  private draftPickNumber = 1;
  private draftPicksThisRound = 1;
  private roundStartTick = 0;
  private lastRoundEnd: { killTick: number; killerId: number; victimId: number; winnerId: number } | null = null;
  private seed = 0;
  private layout: LayoutId = "shatteredGrid";
  private emptySince = 0;
  /** Per-round damage windows for "Most Chaotic Moment". */
  private chaos: { playerId: number; damage: number; round: number } | null = null;
  onEmpty: (() => void) | null = null;

  constructor(code: string, seed: number, testRoom: boolean) {
    this.code = code;
    this.rng = new Rng(seed);
    this.settings.testRoom = testRoom;
    this.nextTime = performance.now();
    this.timer = setTimeout(() => this.loop(), TICK_MS);
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
    return this.members.size >= NET.maxPlayers && !this.bumpableBot();
  }

  private bumpableBot(): Member | undefined {
    return this.phase === "lobby" ? [...this.members.values()].find((m) => m.bot) : undefined;
  }

  private freeColor(): number {
    const used = new Set([...this.members.values()].map((m) => m.color));
    return PLAYER_COLORS.find((c) => !used.has(c.id))?.id ?? 0;
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

  addHuman(id: number, name: string, token: string, ws: WebSocket, ip: string): Member | null {
    if (this.phase !== "lobby" && this.members.size >= NET.maxPlayers) return null;
    if (this.members.size >= NET.maxPlayers) {
      const bot = this.bumpableBot();
      if (!bot) return null;
      this.removeMember(bot.id);
    }
    const m = newMember(id, this.uniqueName(name || "Player", id), token, false, ip, Date.now());
    m.color = this.freeColor();
    m.ws = ws;
    m.ready = false;
    if (this.phase !== "lobby") {
      // Joining mid-match: sit out as a ghost until the next round.
      m.loadout = { slots: [null, null], older: 0 };
    }
    this.members.set(id, m);
    if (!this.hostId || !this.members.get(this.hostId) || this.members.get(this.hostId)?.bot) this.hostId = id;
    this.broadcastRoom();
    return m;
  }

  /** Same session token within the rejoin window: swap the socket in. */
  rejoin(m: Member, ws: WebSocket) {
    m.ws = ws;
    m.connected = true;
    m.ackTick = -1;
    m.baselines.clear();
    const p = this.world?.players.get(m.id);
    if (p) p.connected = true;
    log.info(`room ${this.code}: ${m.name} rejoined`);
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
  }

  removeMember(id: number) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.bots.delete(id);
    const p = this.world?.players.get(id);
    if (p?.alive && this.world) this.world.kill(p);
    this.world?.players.delete(id);
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
    if (this.members.size >= NET.maxPlayers) return null;
    const used = new Set([...this.members.values()].map((m) => m.name));
    const name = BOTS.names.find((n) => !used.has(n)) ?? "BOT";
    const id = 1_000_000 + Math.floor(this.rng.next() * 1e6);
    const m = newMember(id, name, "", true, "bot", Date.now());
    m.color = this.freeColor();
    this.members.set(id, m);
    this.bots.set(id, createBrain(this.settings.botDifficulty, this.rng.int(1e9)));
    return m;
  }

  private fillBots() {
    if (!this.settings.fillBots) return;
    while (this.members.size < NET.maxPlayers) if (!this.addBot()) break;
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
      players: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color, ready: m.ready, bot: m.bot, connected: m.connected, host: m.id === this.hostId, points: m.points })),
    };
  }

  broadcastRoom() {
    this.broadcast({ type: S2C.roomState, room: this.roomState() });
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
        if (m.inputs.length > 24) m.inputs.splice(0, m.inputs.length - 24);
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
        if (m.id === this.hostId && this.phase === "lobby") this.tryStart();
        return;
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
    if (this.phase !== "lobby") return;
    if (isInt(msg.color, 0, PLAYER_COLORS.length - 1)) {
      const taken = [...this.members.values()].some((o) => o.id !== m.id && o.color === msg.color);
      if (!taken) m.color = msg.color;
    }
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
      if (msg.layout === "auto" || (typeof msg.layout === "string" && (LAYOUTS as readonly string[]).includes(msg.layout))) this.settings.layout = msg.layout;
    }
    this.broadcastRoom();
  }

  private tryStart() {
    const ready = this.humans.filter((h) => h.ready || h.id === this.hostId);
    const willHave = this.settings.fillBots ? NET.maxPlayers : this.members.size;
    if (ready.length < 1 || willHave < 2) {
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
    this.round = 0;
    this.chaos = null;
    this.startUltSelect();
  }

  // ---- phases ------------------------------------------------------------------------

  private setPhase(phase: Phase, seconds: number) {
    this.phase = phase;
    this.phaseEndsAt = this.tick + secs(seconds);
    for (const m of this.members.values()) this.sendPhase(m);
  }

  sendPhase(m: Member) {
    this.send(m, {
      type: S2C.phase, phase: this.phase, endsIn: (this.phaseEndsAt - this.tick) / NET.tickRate, round: this.round, layout: this.layout,
      seed: this.seed, playerCount: this.members.size, tick: this.world?.tick ?? 0,
    });
    if (this.phase === "ultSelect" && m.ultPick === null) this.send(m, { type: S2C.ultOffer, options: m.ultOptions });
    if (this.phase === "draft" && m.draftPick === null) this.send(m, { type: S2C.draftOffer, options: m.draftOptions, pickNumber: this.draftPickNumber, picks: this.draftPicksThisRound });
  }

  private startUltSelect() {
    for (const m of this.members.values()) {
      m.ultOptions = ultOffer(this.rng);
      m.ultPick = null;
    }
    this.setPhase("ultSelect", MATCH.ultSelectSeconds);
    this.broadcastRoom();
  }

  private startDraft(pickNumber: number) {
    this.draftPickNumber = pickNumber;
    this.draftPicksThisRound = this.round === 0 ? 2 : 1;
    const points = new Map([...this.members.values()].map((m) => [m.id, m.points] as const));
    const comeback = comebackPlayers(points);
    for (const m of this.members.values()) {
      m.draftOptions = draftOffer(this.rng, m.loadout.slots, offerSize(m.id, comeback));
      m.draftPick = null;
    }
    this.setPhase("draft", this.round === 0 ? MATCH.firstDraftSeconds : MATCH.draftSeconds);
  }

  /** Bots and humans have all picked (or time ran out): move on. */
  private maybeAdvanceSelection(timeUp = false) {
    if (this.phase === "ultSelect") {
      const all = [...this.members.values()].every((m) => m.ultPick !== null || !m.connected);
      if (!all && !timeUp) return;
      for (const m of this.members.values()) {
        const i = m.ultPick ?? this.rng.int(m.ultOptions.length);
        m.ult = (m.ultOptions[i] ?? m.ultOptions[0] ?? "overdrive") as UltId;
      }
      this.startDraft(1);
      return;
    }
    if (this.phase === "draft") {
      const all = [...this.members.values()].every((m) => m.draftPick !== null || !m.connected);
      if (!all && !timeUp) return;
      for (const m of this.members.values()) {
        const i = m.draftPick ?? this.rng.int(m.draftOptions.length);
        const pick = m.draftOptions[i] ?? m.draftOptions[0];
        if (pick) m.loadout = applyPick(m.loadout, pick);
      }
      if (this.draftPickNumber < this.draftPicksThisRound) {
        this.startDraft(this.draftPickNumber + 1);
        return;
      }
      this.broadcast({
        type: S2C.draftReveal,
        loadouts: [...this.members.values()].map((m) => ({ playerId: m.id, slots: [...m.loadout.slots], ult: m.ult })),
      });
      this.startCountdown();
    }
  }

  private startCountdown() {
    this.round++;
    this.seed = this.rng.int(2 ** 30);
    this.layout = this.settings.layout === "auto" ? (LAYOUTS[(this.round - 1) % LAYOUTS.length] ?? "shatteredGrid") : this.settings.layout;
    const w = new World(this.layout, this.members.size, this.seed);
    for (const m of this.members.values()) {
      const p = w.addPlayer(m.id, m.name, m.color, m.bot);
      p.slots = [0, 1].map((i) => {
        const id = m.loadout.slots[i];
        return id ? { id, cd: 0, recast: 0 } : null;
      });
      p.slots.push(null);
      p.ult = m.ult ? { id: m.ult, charge: 0 } : null;
      p.connected = m.connected;
      m.inputs = [];
      m.dtBudget = 0;
      m.ackTick = -1;
      m.baselines.clear();
      m.spectate = 0;
      m.hauntReadyAt = 0;
    }
    w.placeSpawns();
    for (const m of this.members.values()) w.points.set(m.id, m.points);
    this.world = w;
    this.setPhase("countdown", MATCH.countdownSeconds);
  }

  private startRound() {
    this.roundStartTick = this.world?.tick ?? 0;
    this.setPhase("round", 600);
  }

  private endRound() {
    const w = this.world;
    if (!w) return;
    const ids = [...w.players.keys()];
    const kills = new Map(ids.map((id) => [id, w.stat(id).kills] as const));
    const pl = placements(ids, w.deaths, kills);
    for (const p of pl) {
      const m = this.members.get(p.playerId);
      if (!m) continue;
      m.points += p.points;
      m.placements.push(p.place);
      if (p.place === 1) m.roundWins++;
      const s = w.stat(m.id);
      m.totalKills += s.kills;
      m.totalDamage += s.damage;
      m.totalShots += s.shots;
      m.totalHits += s.hits;
      m.totalCombos += s.combos;
      for (const u of s.powersUsed) m.powersUsed.add(u);
    }
    this.updateChaos(w);
    const lastDeath = w.deaths[w.deaths.length - 1];
    const winner = pl[0]?.playerId ?? 0;
    this.lastRoundEnd = { killTick: lastDeath?.tick ?? w.tick, killerId: lastDeath?.killer ?? 0, victimId: lastDeath?.id ?? 0, winnerId: winner };
    const totals: Record<number, number> = {};
    for (const m of this.members.values()) totals[m.id] = m.points;
    this.broadcast({ type: S2C.roundEnd, placements: pl, totals, round: this.round, ...this.lastRoundEnd });
    this.setPhase("replay", MATCH.replaySeconds);
  }

  /** Most damage any one player dealt in a 3-second window this round. */
  private updateChaos(w: World) {
    const win = 3 * NET.tickRate;
    const byPlayer = new Map<number, { tick: number; amount: number }[]>();
    for (const d of w.damageLog) {
      const list = byPlayer.get(d.by) ?? [];
      list.push(d);
      byPlayer.set(d.by, list);
    }
    for (const [id, list] of byPlayer) {
      let sum = 0;
      let j = 0;
      for (let i = 0; i < list.length; i++) {
        sum += list[i]?.amount ?? 0;
        while ((list[i]?.tick ?? 0) - (list[j]?.tick ?? 0) > win) sum -= list[j++]?.amount ?? 0;
        if (!this.chaos || sum > this.chaos.damage) this.chaos = { playerId: id, damage: Math.round(sum), round: this.round };
      }
    }
  }

  private afterStandings() {
    const points = new Map([...this.members.values()].map((m) => [m.id, m.points] as const));
    if (matchOver(points) || this.round >= MATCH.maxRounds) {
      const ids = [...this.members.keys()];
      const winner = matchLeader(ids, points, new Map([...this.members.values()].map((m) => [m.id, m.roundWins] as const)), new Map([...this.members.values()].map((m) => [m.id, m.totalKills] as const)));
      const stats: PlayerMatchStats[] = [...this.members.values()].map((m) => ({
        playerId: m.id, points: m.points, kills: m.totalKills, damage: Math.round(m.totalDamage), shots: m.totalShots, hits: m.totalHits,
        powersUsed: m.powersUsed.size, combos: m.totalCombos, roundWins: m.roundWins, placements: [...m.placements], chaos: this.chaos?.playerId === m.id ? this.chaos.damage : 0,
      }));
      this.world = null;
      this.setPhase("matchEnd", 3600);
      this.broadcast({ type: S2C.matchEnd, winnerId: winner, stats, chaosMoment: this.chaos });
      this.broadcastRoom();
    } else {
      this.world = null;
      this.startDraft(1);
    }
  }

  private toLobby() {
    this.world = null;
    for (const m of this.members.values()) {
      resetMatchProgress(m);
      m.ready = m.bot;
    }
    // Drop bots that were only fill-ins; the host can fill again.
    for (const m of [...this.members.values()]) if (m.bot) this.removeMember(m.id);
    this.setPhase("lobby", 0);
    this.broadcastRoom();
  }

  // ---- ghosts + debug ----------------------------------------------------------------

  private haunt(m: Member, kind: unknown, x: unknown, y: unknown) {
    const w = this.world;
    if (!w || this.phase !== "round" || (kind !== "lava" && kind !== "slow") || !isNum(x) || !isNum(y)) return;
    const self = w.players.get(m.id);
    if (!self || self.alive || this.tick < m.hauntReadyAt) return;
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
    if (power === "fullUlt") {
      if (p.ult) p.ult.charge = 100;
    } else if (power === "heal") {
      p.hp = 100;
    } else if (typeof power === "string" && (POWER_IDS as readonly string[]).includes(power)) {
      const slot = p.slots[0] && p.slots[1] ? 2 : p.slots[0] ? 1 : 0;
      p.slots[slot] = { id: power as PowerId, cd: 0, recast: 0 };
    } else if (typeof power === "string") {
      p.ult = { id: power as UltId, charge: 100 };
    }
    log.info(`debug grant ${String(power)} to ${p.name} by ${m.name}`);
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

  private step() {
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

    const timeUp = this.phase !== "lobby" && this.phase !== "round" && this.phase !== "matchEnd" && this.tick >= this.phaseEndsAt;
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
        // Everyone sees the arena and spawn positions while counting down.
        if (this.world && this.tick % 3 === 0) this.sendSnapshots(this.world, []);
        if (timeUp) this.startRound();
        break;
      case "round":
        this.stepRound();
        break;
      case "replay":
        if (timeUp) this.setPhase("standings", MATCH.standingsSeconds);
        break;
      case "standings":
        if (timeUp) this.afterStandings();
        break;
      default:
        break;
    }
  }

  private stepRound() {
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
      // Anti speed-hack: a player can't simulate more time than has passed.
      m.dtBudget = Math.min(m.dtBudget + w.dt, 0.25);
      const frames: InputFrame[] = [];
      const rest: InputFrame[] = [];
      let lastSeq = p.ackSeq;
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
      inputs.set(m.id, frames);
      w.latencyTicks.set(m.id, Math.round(((m.rttMs / 2 + 100) / 1000) * NET.tickRate));
    }
    w.step(inputs);
    const events: GameEvent[] = w.events;
    this.sendSnapshots(w, events);
    if (w.alivePlayers().length <= 1) this.endRound();
  }

  private sendSnapshots(w: World, events: GameEvent[]) {
    const roundTime = this.phase === "round" ? (w.tick - this.roundStartTick) / NET.tickRate : 0;
    for (const m of this.members.values()) {
      if (m.bot || !m.ws) continue;
      this.send(m, { type: S2C.snapshot, snap: buildSnapshot(w, m, events, roundTime) });
    }
  }

  setRtt(m: Member, rtt: number) {
    m.rttMs = m.rttMs * 0.7 + Math.min(1000, Math.max(0, rtt)) * 0.3;
  }

  static difficulty(d: unknown): Difficulty {
    return d === "easy" || d === "hard" ? d : "normal";
  }
}
