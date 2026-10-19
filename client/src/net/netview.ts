// The client's view of the round:
//  - a buffer of decoded snapshots (also used for the slow-mo replay)
//  - interpolation of everything else ~100 ms in the past
//  - prediction + reconciliation of the local player (same shared movement code)
//  - predicted own shots that appear instantly and hand over to the server's real ones

import {
  applyDelta, buildArena, BTN, decodeEffect, decodeGlobal, decodePickup, decodePillar, decodePlayer, decodeProjectile, decodeSelf,
  EK, hasStatusBit, lerp, lerpAngle, movePlayer, NET, PLAYER, POWERS, SHOT, STATUS_IDS,
  type ArenaDef, type EntityMap, type GameEvent, type InputFrame, type LayoutId, type NetEffect, type NetGlobal, type NetPickup,
  type NetPillar, type NetPlayer, type NetProjectile, type NetSelf, type Pillar, type Player, type SnapshotWire, type Statuses,
} from "@prism/shared";

const TICK_MS = 1000 / NET.tickRate;
const KEEP_TICKS = NET.tickRate * 6;

export interface SnapState {
  tick: number;
  ents: EntityMap;
  g: NetGlobal;
  self: NetSelf | null;
  events: GameEvent[];
}

export interface PredictedShot {
  shotId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  born: number;
  alpha: number;
  matched: boolean;
  dead: boolean;
}

export interface View {
  tick: number;
  players: NetPlayer[];
  projectiles: NetProjectile[];
  effects: NetEffect[];
  pillars: Map<number, NetPillar>;
  pickups: NetPickup[];
  g: NetGlobal;
}

export interface NetDebug {
  corrections: number;
  correctionsPerMin: number;
  maxCorrection: number;
  lastCorrection: number;
  interpDelayTicks: number;
  estServerTick: number;
  renderTick: number;
  late: number;
}

function statusFromBits(bits: number): Statuses {
  const st: Statuses = {};
  STATUS_IDS.forEach((s, i) => {
    if (bits & (1 << i)) st[s] = 0.2;
  });
  return st;
}

export class NetView {
  arena: ArenaDef;
  states: SnapState[] = [];
  latest: SnapState | null = null;
  myId: number;
  /** Predicted local player (null when dead/spectating). */
  me: Player | null = null;
  self: NetSelf | null = null;
  private pending: InputFrame[] = [];
  private seq = 0;
  private shotSeq = 1;
  /** Visual smoothing of prediction corrections. */
  offX = 0;
  offY = 0;
  shots: PredictedShot[] = [];
  private tickOffset = 0;
  private offsetInit = false;
  private jitter = 0;
  delayTicks: number = NET.interpDelayTicks;
  debug: NetDebug = { corrections: 0, correctionsPerMin: 0, maxCorrection: 0, lastCorrection: 0, interpDelayTicks: 3, estServerTick: 0, renderTick: 0, late: 0 };
  private corrWindow: number[] = [];
  private pendingEvents: { tick: number; e: GameEvent }[] = [];
  /** Mirror of the server's ammo/fire timing so predicted shots match real ones. */
  private ammo: number = SHOT.ammoMax;
  private ammoT = 0;
  private fireCd = 0;
  onEvent: (e: GameEvent, immediate: boolean) => void = () => {};

  constructor(layout: LayoutId, playerCount: number, seed: number, myId: number) {
    this.arena = buildArena(layout, playerCount, seed, 100000);
    this.myId = myId;
  }

  // ---- snapshots ---------------------------------------------------------------------

  /** Returns false when the delta couldn't be applied (missing baseline): stay on the old ack. */
  receive(s: SnapshotWire, now: number): boolean {
    let base: EntityMap | null = null;
    if (s.b >= 0) {
      const b = this.states.find((x) => x.tick === s.b);
      if (!b) return false;
      base = b.ents;
    }
    let ents: EntityMap;
    try {
      ents = applyDelta(base, s.e, s.r);
    } catch {
      return false;
    }
    if (this.latest && s.t < this.latest.tick) return true;
    const state: SnapState = { tick: s.t, ents, g: decodeGlobal(s.g), self: decodeSelf(s.y), events: s.ev };
    // Replace a same-tick state (countdown snapshots repeat the tick).
    this.states = this.states.filter((x) => x.tick !== s.t);
    this.states.push(state);
    while (this.states.length && (this.states[0]?.tick ?? 0) < s.t - KEEP_TICKS) this.states.shift();
    const prevLatest = this.latest;
    this.latest = state;

    // Server tick clock: the snapshot's tick "is" now (minus jitter). Track the offset.
    const sample = s.t - now / TICK_MS;
    if (!this.offsetInit) {
      this.tickOffset = sample;
      this.offsetInit = true;
    } else {
      const err = sample - this.tickOffset;
      this.jitter = this.jitter * 0.9 + Math.abs(err) * 0.1;
      // Snapshots arriving later than expected pull the clock back slowly; early ones jump it forward.
      this.tickOffset += err > 0 ? err * 0.25 : err * 0.03;
    }
    const want = Math.min(NET.interpDelayMaxTicks, Math.max(NET.interpDelayTicks, Math.ceil(2 + this.jitter * 2.2)));
    this.delayTicks += (want - this.delayTicks) * 0.05;

    for (const e of s.ev) this.pendingEvents.push({ tick: s.t, e });
    if (state.self) this.reconcile(state.self, prevLatest === null);
    else this.me = null;
    this.matchShots(state);
    return true;
  }

  estServerTick(now: number): number {
    return now / TICK_MS + this.tickOffset;
  }

  renderTick(now: number): number {
    return this.estServerTick(now) - this.delayTicks;
  }

  // ---- prediction ------------------------------------------------------------------------

  private pillarsLive(): Pillar[] {
    const st = this.latest;
    return this.arena.pillars.map((p) => {
      const a = st?.ents.get(p.id);
      return a ? { ...p, hp: a[1] ?? p.hp, dead: a[2] === 1 } : p;
    });
  }

  private reconcile(self: NetSelf, first: boolean) {
    this.self = self;
    if (!self.alive) {
      this.me = null;
      this.pending = [];
      return;
    }
    const oldX = this.me ? this.me.x + this.offX : self.x;
    const oldY = this.me ? this.me.y + this.offY : self.y;
    const me = this.me ?? this.blankMe();
    me.x = self.x;
    me.y = self.y;
    me.vx = self.vx;
    me.vy = self.vy;
    me.px = self.px;
    me.py = self.py;
    me.dashT = self.dashT;
    me.dashCd = self.dashCd;
    me.dashX = self.dashX;
    me.dashY = self.dashY;
    me.status = statusFromBits(self.status);
    me.hp = self.hp;
    me.alive = true;
    this.pending = this.pending.filter((f) => f.seq > self.ackSeq);
    const pillars = this.pillarsLive();
    const ts = hasStatusBit(self.status, "timeBubble") ? POWERS.timeBubble.slow : 1;
    for (const f of this.pending) movePlayer(me, f, this.arena, pillars, f.dt, ts);
    this.me = me;

    // Ammo mirror: server value minus shots we fired that it hasn't processed yet.
    const unackedShots = this.pending.filter((f) => f.shotId > 0).length;
    this.ammo = Math.max(0, self.ammo - unackedShots);
    this.ammoT = self.ammoT;
    this.fireCd = Math.max(this.fireCd, self.fireCd);

    // Smooth the correction instead of snapping (unless it's a teleport or huge).
    const ex = oldX - me.x;
    const ey = oldY - me.y;
    const err = Math.hypot(ex, ey);
    const warped = this.latest?.ents.get(this.myId)?.[9] === 1;
    if (first || warped || err > NET.correctionSnapUnits) {
      this.offX = 0;
      this.offY = 0;
    } else {
      this.offX = ex;
      this.offY = ey;
      if (err > 2) {
        this.debug.corrections++;
        this.corrWindow.push(performance.now());
        this.debug.lastCorrection = err;
        this.debug.maxCorrection = Math.max(this.debug.maxCorrection * 0.995, err);
      }
    }
  }

  private blankMe(): Player {
    return {
      id: this.myId, kind: "player", name: "", color: 0, bot: false, x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, r: PLAYER.radius, aim: 0, hp: 100, alive: true,
      connected: true, dashT: 0, dashCd: 0, dashX: 0, dashY: 0, fireCd: 0, ammo: SHOT.ammoMax, ammoT: 0, sinceDamage: 0, sinceShot: 0, slots: [], ult: null,
      status: {}, lastHitBy: 0, lastHitSource: "shot", lastHitTick: 0, warp: 0, ackSeq: 0, absorbed: 0, cloakCrit: false, damagedAt: 0, damagedBy: 0,
    };
  }

  /** Runs one local frame: predicts movement and maybe a shot, returns the frame to send. */
  predict(mx: number, my: number, aim: number, held: number, pressed: number, dt: number): InputFrame | null {
    const me = this.me;
    const self = this.self;
    let shotId = 0;
    if (me && self) {
      const od = hasStatusBit(self.status, "overdrive");
      const air = hasStatusBit(self.status, "airborne");
      this.fireCd = Math.max(0, this.fireCd - dt);
      if (this.ammo < SHOT.ammoMax) {
        this.ammoT += dt * (od ? 2.2 : 1);
        if (this.ammoT >= SHOT.ammoReload) {
          this.ammoT = 0;
          this.ammo++;
        }
      }
      if ((held & BTN.shoot) && this.fireCd <= 0 && this.ammo > 0 && me.dashT <= 0 && !air) {
        shotId = this.shotSeq++;
        this.fireCd = SHOT.fireCooldown / (od ? 2 : 1);
        if (!od) this.ammo--;
        const c = Math.cos(aim);
        const s = Math.sin(aim);
        this.shots.push({
          shotId, x: me.x + c * SHOT.spawnOffset, y: me.y + s * SHOT.spawnOffset, vx: c * SHOT.speed + me.vx * 0.15, vy: s * SHOT.speed + me.vy * 0.15,
          life: SHOT.life, born: performance.now(), alpha: 1, matched: false, dead: false,
        });
      }
    }
    const frame: InputFrame = { seq: ++this.seq, mx, my, aim, buttons: held, pressed, dt, shotId };
    if (me) {
      const ts = self && hasStatusBit(self.status, "timeBubble") ? POWERS.timeBubble.slow : 1;
      movePlayer(me, frame, this.arena, this.pillarsLive(), dt, ts);
      this.pending.push(frame);
      if (this.pending.length > 240) this.pending.shift();
    }
    // Decay the visual correction.
    const k = Math.exp(-dt / (NET.correctionSmoothMs / 1000 / 3));
    this.offX *= k;
    this.offY *= k;
    return frame;
  }

  /** Visible ammo for the HUD (predicted). */
  get hudAmmo() {
    return { ammo: this.ammo, reload: this.ammoT / SHOT.ammoReload };
  }

  // ---- predicted shots -----------------------------------------------------------------

  private matchShots(st: SnapState) {
    for (const arr of st.ents.values()) {
      if (arr[0] !== EK.projectile) continue;
      const shotId = arr[9] ?? 0;
      if (!shotId || arr[5] !== this.myId) continue;
      const s = this.shots.find((x) => x.shotId === shotId);
      if (s) s.matched = true;
    }
  }

  stepShots(dt: number, now: number) {
    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.matched) s.alpha -= dt / 0.08;
      else if (now - s.born > 600) s.alpha -= dt / 0.1;
      // Walls and pillars end a predicted shot (the server shows the real impact).
      if (s.life <= 0 || !this.insideArena(s.x, s.y)) s.dead = true;
      for (const p of this.arena.pillars) {
        if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < (p.r + SHOT.radius) ** 2) {
          const live = this.latest?.ents.get(p.id);
          if (!live || live[2] !== 1) s.dead = true;
        }
      }
    }
    this.shots = this.shots.filter((s) => !s.dead && s.alpha > 0);
  }

  private insideArena(x: number, y: number) {
    for (const w of this.arena.walls) if ((x - w.ax) * w.nx + (y - w.ay) * w.ny < SHOT.radius) return false;
    return true;
  }

  // ---- interpolation -----------------------------------------------------------------------

  /** Events whose tick the render clock has reached (or immediate ones about me). */
  drainEvents(renderTick: number) {
    const keep: { tick: number; e: GameEvent }[] = [];
    for (const pe of this.pendingEvents) {
      const mine = this.involvesMe(pe.e);
      if (mine || pe.tick <= renderTick + 0.5) this.onEvent(pe.e, mine);
      else keep.push(pe);
    }
    this.pendingEvents = keep;
  }

  private involvesMe(e: GameEvent): boolean {
    const id = this.myId;
    switch (e.t) {
      case "hit":
        return e.target === id || e.by === id;
      case "kill":
        return e.victim === id || e.killer === id;
      case "combo":
        return e.by === id;
      case "pickup":
      case "dash":
      case "cast":
        return e.by === id;
      default:
        return false;
    }
  }

  clearEvents() {
    this.pendingEvents = [];
  }

  /** The world at a fractional server tick, interpolated between the two snapshots around it. */
  viewAt(t: number, extrapolateOwnTo?: number): View | null {
    const n = this.states.length;
    if (!n) return null;
    let a = this.states[0];
    let b = this.states[0];
    for (let i = 0; i < n; i++) {
      const s = this.states[i];
      if (!s) continue;
      if (s.tick <= t) a = s;
      if (s.tick >= t) {
        b = s;
        break;
      }
      b = s;
    }
    if (!a || !b) return null;
    if (t > b.tick) this.debug.late++;
    const span = b.tick - a.tick;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - a.tick) / span)) : 0;
    // Extrapolate at most one tick past the newest snapshot.
    const ex = t > b.tick ? Math.min(1, t - b.tick) / NET.tickRate : 0;

    const players: NetPlayer[] = [];
    const projectiles: NetProjectile[] = [];
    const effects: NetEffect[] = [];
    const pillars = new Map<number, NetPillar>();
    const pickups: NetPickup[] = [];
    const ownExtra = extrapolateOwnTo !== undefined ? Math.max(0, (extrapolateOwnTo - b.tick) / NET.tickRate) : 0;

    for (const [id, bv] of b.ents) {
      const av = a.ents.get(id) ?? bv;
      switch (bv[0]) {
        case EK.player: {
          const pa = decodePlayer(id, av);
          const pb = decodePlayer(id, bv);
          const jump = pb.warp || Math.hypot(pb.x - pa.x, pb.y - pa.y) > 160;
          players.push({
            ...pb, x: jump ? pb.x : lerp(pa.x, pb.x, f) + pb.vx * ex, y: jump ? pb.y : lerp(pa.y, pb.y, f) + pb.vy * ex,
            aim: lerpAngle(pa.aim, pb.aim, f), hp: f < 0.5 ? pa.hp : pb.hp,
          });
          break;
        }
        case EK.projectile: {
          const qb = decodeProjectile(id, bv);
          if (qb.owner === this.myId && ownExtra > 0) {
            // Own shots render at "now" so they line up with the instant predicted ones.
            projectiles.push({ ...qb, x: qb.x + qb.vx * ownExtra, y: qb.y + qb.vy * ownExtra });
            break;
          }
          const qa = a.ents.has(id) ? decodeProjectile(id, av) : null;
          if (!qa) {
            // Born between a and b: place it back along its velocity.
            const back = (1 - f) / NET.tickRate;
            projectiles.push({ ...qb, x: qb.x - qb.vx * back, y: qb.y - qb.vy * back });
          } else {
            const jump = Math.hypot(qb.x - qa.x, qb.y - qa.y) > 220;
            projectiles.push({ ...qb, x: jump ? qb.x : lerp(qa.x, qb.x, f) + qb.vx * ex, y: jump ? qb.y : lerp(qa.y, qb.y, f) + qb.vy * ex });
          }
          break;
        }
        case EK.effect: {
          const eb = decodeEffect(id, bv);
          const ea = a.ents.has(id) ? decodeEffect(id, av) : eb;
          const jump = Math.hypot(eb.x - ea.x, eb.y - ea.y) > 200;
          effects.push({
            ...eb, x: jump ? eb.x : lerp(ea.x, eb.x, f), y: jump ? eb.y : lerp(ea.y, eb.y, f), r: lerp(ea.r, eb.r, f),
            angle: lerpAngle(ea.angle, eb.angle, f), age: lerp(ea.age, eb.age, f),
          });
          break;
        }
        case EK.pillar:
          pillars.set(id, decodePillar(id, bv));
          break;
        case EK.pickup:
          pickups.push(decodePickup(id, bv));
          break;
        default:
          break;
      }
    }
    const ga = a.g;
    const gb = b.g;
    const g: NetGlobal = { ...gb, zx: lerp(ga.zx, gb.zx, f), zy: lerp(ga.zy, gb.zy, f), zr: lerp(ga.zr, gb.zr, f) };
    return { tick: t, players, projectiles, effects, pillars, pickups, g };
  }

  updateDebug(now: number) {
    const cut = now - 60000;
    this.corrWindow = this.corrWindow.filter((t) => t > cut);
    this.debug.correctionsPerMin = this.corrWindow.length;
    this.debug.interpDelayTicks = this.delayTicks;
    this.debug.estServerTick = this.estServerTick(now);
    this.debug.renderTick = this.renderTick(now);
  }

  get lastTick() {
    return this.latest?.tick ?? -1;
  }
}
