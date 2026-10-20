// The authoritative game world. The server runs one per room at 30 ticks/s. Systems run in
// a fixed order each tick; everything visual the clients need is emitted as events.
// Subsystems live in their own modules (weapons, projectiles, loot, destructibles, zone,
// throwables); this class owns the state and the public API powers and bots use.

import { INTEREST, KILL_CREDIT_SECONDS, NET, PLAYER, POWERS, TERRAIN, ULT_CHARGE, ULTIMATES } from "../config";
import { Rng } from "../math/rng";
import { dist2 } from "../math/vec";
import { actFrame } from "./actions";
import { circleBlocked, resolveCircle, solidsInCircle, type Body } from "./collision";
import { damageSolid, explode, stepBlasts, type ExplodeOpts, type PendingBlast } from "./destructibles";
import { effectHooks, powerDef, ultDef } from "./hooks";
import { bulletBlocked, canSeePoint, segmentNearPoint, visionBlocked } from "./los";
import { autoPickup, dropLoadout, interact, LootIndex, spawnInitialLoot, stepSupply } from "./loot";
import { buildMap, inBush, type MapDef, type MapId, type Solid } from "./map";
import { movePlayer, type MoveInput } from "./movement";
import { lagCompensate, stepProjectile } from "./projectiles";
import type { Effect, EffectKind, GameEvent, InputFrame, Inventory, Loot, Player, PowerId, Projectile, ProjKind, SourceId, StatusId } from "./types";
import { BTN, POWER_IDS } from "./types";
import { onFrameActions } from "./weapons";
import { initialZone, stepZone, type ZoneState } from "./zone";

export type { ZoneState } from "./zone";

interface HistoryEntry {
  tick: number;
  x: number;
  y: number;
  hp: number;
}

export interface RoundStats {
  damage: number;
  kills: number;
  shots: number;
  hits: number;
  casts: number;
  combos: number;
  powersUsed: Set<string>;
  healed: number;
  looted: number;
}

export interface DamageOpts {
  crit?: boolean;
  /** Ground hazards don't hurt airborne players. */
  ground?: boolean;
  /** Don't count toward ult charge (zone damage). */
  noCharge?: boolean;
  /** Ignore invulnerability and armor (zone). */
  pierce?: boolean;
  x?: number;
  y?: number;
}

const HISTORY_TICKS = 3 * NET.tickRate;

export function newInventory(): Inventory {
  return { weapons: [{ id: "pistol", rarity: 0, mag: 12, reserve: 0 }, null], active: 0, throwable: null, throws: 0, bandages: 0, medkits: 0 };
}

/**
 * World entities (projectiles, effects, loot) take ids from here up, so they never share an id
 * with a fighter: human player ids count up from 1 and bots live in 1e6..2e6. Snapshots key
 * every entity by id, so a clash would hide a player behind a loot item.
 */
export const ENTITY_ID_BASE = 1 << 21;

export class World {
  readonly dt = 1 / NET.tickRate;
  tick = 0;
  time = 0;
  rng: Rng;
  map: MapDef;
  players = new Map<number, Player>();
  projectiles: Projectile[] = [];
  private projPool: Projectile[] = [];
  effects = new Map<number, Effect>();
  loot = new Map<number, Loot>();
  lootIndex = new LootIndex();
  events: GameEvent[] = [];
  zone: ZoneState;
  /** Death order (first to die first). */
  deaths: { id: number; tick: number; killer: number }[] = [];
  stats = new Map<number, RoundStats>();
  /** Score-like ranking powers can read (Bounty Beacon): kills this match, set as they happen. */
  points = new Map<number, number>();
  /** Latency (ticks) per player for lag compensation, set by the room. */
  latencyTicks = new Map<number, number>();
  history = new Map<number, HistoryEntry[]>();
  /** Last tick a player fired (minimap reveal + bush reveal). */
  firedAt = new Map<number, number>();
  /** Barrel explosions waiting to go off (chain reactions). */
  blasts: PendingBlast[] = [];
  /** Supply drops already announced (index into SUPPLY.times). */
  supplyIndex = 0;
  private nextId = ENTITY_ID_BASE;
  /** Which combos fired per player (stats). */
  comboLog: { by: number; name: string; stolen: boolean; tick: number }[] = [];
  /** Damage log for "Most Chaotic Moment" (tick, attacker, amount). */
  damageLog: { tick: number; by: number; amount: number }[] = [];
  /** Previous distinct attacker per player (see hurtByOther). */
  private prevDamager = new Map<number, { by: number; at: number }>();

  constructor(mapId: MapId, seed: number, opts: { loot?: boolean } = {}) {
    this.rng = new Rng(seed);
    this.map = buildMap(mapId, seed);
    this.zone = initialZone(this.map);
    if (opts.loot !== false) spawnInitialLoot(this);
  }

  id(): number {
    return this.nextId++;
  }

  emit(e: GameEvent) {
    this.events.push(e);
  }

  // ---- players -------------------------------------------------------------------

  addPlayer(id: number, name: string, color: number, bot: boolean): Player {
    const p: Player = {
      id, kind: "player", name, color, bot, x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, r: PLAYER.radius, aim: 0,
      hp: PLAYER.maxHp, armor: 0, alive: true, connected: true, dashT: 0, dashCd: 0, dashX: 0, dashY: 0, inv: newInventory(),
      fireCd: 0, reloadT: 0, bloom: 0, charge: 0, swingT: 0, throwCd: 0, healKind: null, healT: 0,
      sinceDamage: 99, sinceShot: 99, slots: [null, null], ult: null, status: {},
      lastHitBy: 0, lastHitSource: "pistol", lastHitTick: -9999, warp: 0, ackSeq: 0, absorbed: 0, cloakCrit: false,
      damagedAt: -9999, damagedBy: 0,
    };
    this.players.set(id, p);
    this.stat(id);
    return p;
  }

  /** Spreads everyone over the map's spawn points (shuffled each match). */
  placeSpawns() {
    const list = this.rng.shuffle([...this.players.values()]);
    const pts = this.map.spawns;
    list.forEach((p, i) => {
      const s = pts[i % Math.max(1, pts.length)] ?? { x: 0, y: 0 };
      const ring = Math.floor(i / Math.max(1, pts.length));
      p.x = s.x + ring * 60;
      p.y = s.y;
      p.aim = Math.atan2(-p.y, -p.x);
      p.warp = 3;
    });
  }

  alivePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.alive);
  }

  enemiesOf(p: Player): Player[] {
    return [...this.players.values()].filter((o) => o.alive && o.id !== p.id);
  }

  hasStatus(p: Player, s: StatusId) {
    return (p.status[s] ?? 0) > 0;
  }

  addStatus(p: Player, s: StatusId, seconds: number) {
    p.status[s] = Math.max(p.status[s] ?? 0, seconds);
  }

  /** Moves a player instantly (portals, swaps, rewinds); clients skip smoothing for it. */
  teleport(p: Player, x: number, y: number) {
    const body = { x, y, vx: 0, vy: 0 };
    resolveCircle(this.map, body, p.r);
    p.x = body.x;
    p.y = body.y;
    p.warp = 3;
  }

  impulse(p: Player, ix: number, iy: number) {
    if (!p.alive) return;
    p.px += ix;
    p.py += iy;
  }

  stat(id: number): RoundStats {
    let s = this.stats.get(id);
    if (!s) {
      s = { damage: 0, kills: 0, shots: 0, hits: 0, casts: 0, combos: 0, powersUsed: new Set(), healed: 0, looted: 0 };
      this.stats.set(id, s);
    }
    return s;
  }

  // ---- damage --------------------------------------------------------------------

  /** The one place damage happens. Armor soaks it first. Returns the damage actually dealt. */
  damage(target: Player, amount: number, by: number, source: SourceId, opts: DamageOpts = {}): number {
    if (!target.alive || amount <= 0) return 0;
    const st = target.status;
    if (opts.ground && (st.airborne ?? 0) > 0) return 0;
    if (!opts.pierce && (st.invulnerable ?? 0) > 0) return 0;
    const attacker = by ? this.players.get(by) : undefined;
    let dmg = amount;
    let crit = !!opts.crit;
    if (attacker && attacker.id !== target.id) {
      // Third-Party: double damage to someone another player is already hurting.
      if ((attacker.status.thirdParty ?? 0) > 0 && this.hurtByOther(target, attacker.id)) {
        dmg *= POWERS.thirdParty.mult;
        crit = true;
      }
      if ((target.status.bountied ?? 0) > 0) this.chargeUlt(attacker, dmg * POWERS.bountyBeacon.ultPerDamage);
    }
    if (crit && !opts.crit) dmg = Math.round(dmg);
    if ((st.finalStand ?? 0) > 0) {
      target.absorbed += dmg;
      this.emit({ t: "hit", target: target.id, by, amount: 0, crit: false, source, x: target.x, y: target.y, armor: false });
      return 0;
    }
    if ((st.cloaked ?? 0) > 0) {
      st.cloaked = 0;
      target.cloakCrit = false;
    }
    // Healing is interrupted by taking damage.
    if (target.healKind && !opts.pierce) {
      target.healKind = null;
      target.healT = 0;
    }
    let soaked = 0;
    if (!opts.pierce && target.armor > 0) {
      soaked = Math.min(target.armor, dmg);
      target.armor -= soaked;
    }
    const toHp = Math.min(dmg - soaked, target.hp);
    target.hp -= toHp;
    const dealt = toHp + soaked;
    target.sinceDamage = 0;
    if (by && by !== target.id) {
      target.lastHitBy = by;
      target.lastHitSource = source;
      target.lastHitTick = this.tick;
      // Remember the previous distinct attacker too, so a vulture hitting the target doesn't
      // erase the fact that someone else is also hurting them (Third-Party).
      if (target.damagedBy && target.damagedBy !== by) this.prevDamager.set(target.id, { by: target.damagedBy, at: target.damagedAt });
      target.damagedAt = this.time;
      target.damagedBy = by;
      if (attacker) {
        if (!opts.noCharge) this.chargeUlt(attacker, dealt * ULT_CHARGE.perDamageDealt);
        this.stat(attacker.id).damage += dealt;
        this.damageLog.push({ tick: this.tick, by: attacker.id, amount: dealt });
      }
    }
    if (!opts.noCharge) this.chargeUlt(target, dealt * ULT_CHARGE.perDamageTaken);
    this.emit({ t: "hit", target: target.id, by, amount: Math.round(dealt), crit, source, x: opts.x ?? target.x, y: opts.y ?? target.y, armor: soaked > 0 && toHp <= 0 });
    if (target.hp <= 0.0001) this.kill(target);
    return dealt;
  }

  /** Did a player other than `attackerId` damage `target` within Third-Party's window? */
  hurtByOther(target: Player, attackerId: number): boolean {
    const win = POWERS.thirdParty.recentWindow;
    if (target.damagedBy && target.damagedBy !== attackerId && this.time - target.damagedAt <= win) return true;
    const prev = this.prevDamager.get(target.id);
    return !!prev && prev.by !== attackerId && this.time - prev.at <= win;
  }

  chargeUlt(p: Player, amount: number) {
    if (!p.ult || (p.status.echo ?? 0) > 0 || (p.status.overdrive ?? 0) > 0) return;
    p.ult.charge = Math.min(ULT_CHARGE.max, p.ult.charge + amount);
  }

  heal(p: Player, amount: number) {
    p.hp = Math.min(PLAYER.maxHp, p.hp + amount);
  }

  kill(p: Player) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.healKind = null;
    const credited = this.tick - p.lastHitTick <= KILL_CREDIT_SECONDS * NET.tickRate && p.lastHitBy !== p.id ? p.lastHitBy : 0;
    if (credited) {
      this.stat(credited).kills++;
      this.points.set(credited, (this.points.get(credited) ?? 0) + 1);
    }
    this.deaths.push({ id: p.id, tick: this.tick, killer: credited });
    this.emit({ t: "kill", victim: p.id, killer: credited, source: credited ? p.lastHitSource : "zone", x: p.x, y: p.y });
    dropLoadout(this, p);
    // Effects owned by the dead player that shouldn't outlive them.
    for (const e of this.effects.values()) {
      if (e.owner === p.id && (e.kind === "clone" || e.kind === "tether" || e.kind === "magnet" || e.kind === "finalStand")) e.dead = true;
    }
  }

  // ---- projectiles -------------------------------------------------------------------

  spawnProjectile(o: Partial<Projectile> & { owner: number; x: number; y: number; vx: number; vy: number }): Projectile {
    const p = this.projPool.pop() ?? ({} as Projectile);
    p.id = this.id();
    p.kind = o.kind ?? (0 as ProjKind);
    p.owner = o.owner;
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx;
    p.vy = o.vy;
    p.r = o.r ?? 6;
    p.damage = o.damage ?? 10;
    p.life = o.life ?? 0.8;
    p.life0 = p.life;
    p.bounces = 0;
    p.maxBounces = o.maxBounces ?? 0;
    p.flags = o.flags ?? 0;
    p.source = o.source ?? "pistol";
    p.weapon = o.weapon ?? null;
    p.rarity = o.rarity ?? 0;
    p.pierce = o.pierce ?? 0;
    p.lastHit = 0;
    p.shotId = o.shotId ?? 0;
    p.portalCd = 0;
    p.portalOwner = 0;
    p.dead = false;
    this.projectiles.push(p);
    return p;
  }

  /** Runs a new projectile through the past positions of other players (shooter's view). */
  lagCompensate(proj: Projectile) {
    lagCompensate(this, proj);
  }

  stepProjectile(pr: Projectile, dt: number, asOfTick = this.tick) {
    stepProjectile(this, pr, dt, asOfTick);
  }

  /** Where a player was at a past tick (lag compensation). */
  positionAt(p: Player, tick: number): { x: number; y: number } {
    if (tick >= this.tick) return p;
    const h = this.history.get(p.id);
    if (!h) return p;
    for (let i = h.length - 1; i >= 0; i--) {
      const e = h[i];
      if (e && e.tick <= tick) return e;
    }
    return p;
  }

  killProjectile(pr: Projectile) {
    pr.dead = true;
  }

  colorOf(id: number): number {
    return this.players.get(id)?.color ?? 0;
  }

  // ---- terrain, effects, area damage ------------------------------------------------

  damageSolid(s: Solid, amount: number, by: number, explosive: boolean, x = (s.x0 + s.x1) / 2, y = (s.y0 + s.y1) / 2) {
    damageSolid(this, s, amount, by, explosive, x, y);
  }

  /** Damages every destructible overlapping a circle (slams, glaives, meteors). */
  damageArea(x: number, y: number, r: number, amount: number, by: number, explosive = true) {
    for (const s of solidsInCircle(this.map, x, y, r)) damageSolid(this, s, amount, by, explosive, x, y);
  }

  spawnEffect(o: Partial<Effect> & { kind: EffectKind; owner: number; x: number; y: number; life: number; source: SourceId }): Effect {
    const e: Effect = {
      id: this.id(), kind: o.kind, owner: o.owner, source: o.source, x: o.x, y: o.y, vx: o.vx ?? 0, vy: o.vy ?? 0, r: o.r ?? 30,
      age: 0, life: o.life, angle: o.angle ?? 0, link: o.link ?? 0, x2: o.x2 ?? 0, y2: o.y2 ?? 0, n: o.n ?? 0, v: o.v ?? 0, dead: false,
    };
    this.effects.set(e.id, e);
    return e;
  }

  /** Players within radius r of (x, y). */
  playersNear(x: number, y: number, r: number, exceptId = 0): Player[] {
    const out: Player[] = [];
    for (const p of this.players.values()) {
      if (!p.alive || p.id === exceptId) continue;
      if (dist2(x, y, p.x, p.y) <= (r + p.r) * (r + p.r)) out.push(p);
    }
    return out;
  }

  /** Damages everyone in a circle (and breaks destructibles). */
  explode(x: number, y: number, r: number, damage: number, by: number, source: SourceId, opts: ExplodeOpts = {}) {
    explode(this, x, y, r, damage, by, source, opts);
  }

  /** Is the point in the playable area and clear of solids (by `margin`)? */
  insideArena(x: number, y: number, margin = 0): boolean {
    const h = this.map.half - margin;
    if (x < -h || x > h || y < -h || y > h) return false;
    return !circleBlocked(this.map, x, y, Math.max(1, margin));
  }

  /** Pushes a free body (clone, decoy) out of solids. Returns true if it touched something. */
  collideBody(body: Body, r: number, bounce = 0): boolean {
    return resolveCircle(this.map, body, r, bounce) !== null;
  }

  /** Would a bullet from A to B hit terrain? */
  blocked(ax: number, ay: number, bx: number, by: number): boolean {
    return bulletBlocked(this.map, ax, ay, bx, by);
  }

  /** Vision from A to B: walls and smoke block it. */
  canSee(ax: number, ay: number, bx: number, by: number, margin = 0): boolean {
    if (margin > 0 ? !canSeePoint(this.map, ax, ay, bx, by, margin) : visionBlocked(this.map, ax, ay, bx, by)) return false;
    return !this.smokeBetween(ax, ay, bx, by);
  }

  smokeBetween(ax: number, ay: number, bx: number, by: number): boolean {
    for (const e of this.effects.values()) {
      if (e.kind !== "smoke" || e.dead) continue;
      const r = e.r * Math.min(1, e.age / 0.6) * 0.85;
      if (r > 10 && segmentNearPoint(ax, ay, bx, by, e.x, e.y, r)) return true;
    }
    return false;
  }

  /** Bush hiding: hidden unless close, or they just fired. */
  hiddenFrom(viewer: Player | null, target: Player): boolean {
    if (!viewer || viewer.id === target.id || !target.alive) return false;
    if ((viewer.status.hunter ?? 0) > 0) return false;
    if ((target.status.bountied ?? 0) > 0) return false;
    const fired = this.firedAt.get(target.id) ?? -999;
    if (this.tick - fired < TERRAIN.bush.revealAfterShot * NET.tickRate) return false;
    if (!inBush(this.map, target.x, target.y)) return false;
    return dist2(viewer.x, viewer.y, target.x, target.y) > TERRAIN.bush.revealRange ** 2;
  }

  /** What a viewer is allowed to know about: in view range, in sight, not hidden in a bush. */
  visibleTo(viewer: Player, target: Player): boolean {
    if (viewer.id === target.id) return true;
    if ((viewer.status.hunter ?? 0) > 0) return true;
    if (Math.abs(target.x - viewer.x) > INTEREST.halfW || Math.abs(target.y - viewer.y) > INTEREST.halfH) return false;
    if (this.hiddenFrom(viewer, target)) return false;
    if ((target.status.bountied ?? 0) > 0) return true;
    return this.canSee(viewer.x, viewer.y, target.x, target.y, target.r + INTEREST.losMargin);
  }

  // ---- the tick ------------------------------------------------------------------

  /**
   * Advances the world one tick. `inputs` holds the input frames each player sent since the
   * last tick. Movement and hands (shooting, reloading, healing) run once per frame with that
   * frame's own dt, exactly like the client's prediction, so predicted and authoritative
   * state match. Power casts use the frames merged together (a tap in any frame counts).
   */
  step(inputs: Map<number, InputFrame[]>) {
    const dt = this.dt;
    this.events = [];
    this.tick++;
    this.time += dt;

    for (const p of this.players.values()) {
      for (const k in p.status) {
        const key = k as StatusId;
        const v = (p.status[key] ?? 0) - dt;
        if (v <= 0) delete p.status[key];
        else p.status[key] = v;
      }
      if (p.warp > 0) p.warp--;
    }

    // Time Bubble: everyone except the owner inside a bubble moves at 25% speed.
    const timeScale = new Map<number, number>();
    for (const e of this.effects.values()) {
      if (e.kind !== "bubble" || e.dead) continue;
      for (const p of this.playersNear(e.x, e.y, e.r, e.owner)) {
        timeScale.set(p.id, POWERS.timeBubble.slow);
        p.status.timeBubble = 0.1;
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.sinceDamage += dt;
      p.sinceShot += dt;
      const frames = p.connected ? (inputs.get(p.id) ?? []) : [];
      const ts = timeScale.get(p.id) ?? 1;
      // A connected player only acts on their own input frames (exactly what their client
      // predicted). A tick without frames is normal network timing, not "standing still".
      // Disconnected players drift idle instead.
      const list: InputFrame[] = frames.length
        ? frames
        : p.connected ? [] : [{ seq: p.ackSeq, mx: 0, my: 0, aim: p.aim, buttons: 0, pressed: 0, dt, shotId: 0 }];
      let pressed = 0;
      for (const f of list) {
        const res = movePlayer(p, f as MoveInput, this.map, f.dt, ts);
        if (res.dashed) this.emit({ t: "dash", by: p.id, x: p.x, y: p.y });
        const impact = res.wall?.impact ?? 0;
        if (res.wall && impact > TERRAIN.wallSlamMinSpeed && p.lastHitTick > this.tick - 15) {
          this.damage(p, TERRAIN.wallSlamDamage * Math.min(1.6, impact / 900), p.lastHitBy, "wall", {});
          this.emit({ t: "wallSlam", target: p.id, x: p.x, y: p.y });
          damageSolid(this, res.wall.solid, 10, p.lastHitBy, true, p.x, p.y);
        }
        if (!p.alive) break;
        if (p.connected) onFrameActions(this, p, actFrame(p, f, f.dt * ts), f);
        pressed |= f.pressed;
      }
      const last = frames[frames.length - 1];
      if (last) p.ackSeq = last.seq;
      if (!p.alive) continue;
      if (last && (pressed & BTN.interact)) interact(this, p);
      autoPickup(this, p);
      if (last && (p.status.airborne ?? 0) <= 0 && p.connected) this.handleCasts(p, pressed);
      for (const s of p.slots) {
        if (!s) continue;
        s.cd = Math.max(0, s.cd - dt);
        if (s.recast > 0) {
          s.recast = Math.max(0, s.recast - dt);
          if (s.recast === 0) powerDef(s.id)?.onRecastExpire?.(this, p, s);
        }
      }
      for (const s of p.slots) if (s) powerDef(s.id)?.onPlayerTick?.(this, p, dt);
    }

    for (const pr of this.projectiles) if (!pr.dead) stepProjectile(this, pr, dt);
    this.projectiles = this.projectiles.filter((pr) => {
      if (pr.dead) this.projPool.push(pr);
      return !pr.dead;
    });

    for (const e of this.effects.values()) {
      if (e.dead) continue;
      e.age += dt;
      const h = effectHooks(e.kind);
      h?.update?.(this, e, dt);
      if (h?.affectPlayer) for (const p of this.players.values()) if (p.alive) h.affectPlayer(this, e, p, dt);
      if (e.age >= e.life && !e.dead) {
        h?.onExpire?.(this, e);
        e.dead = true;
      }
    }
    for (const [id, e] of this.effects) if (e.dead) this.effects.delete(id);

    stepBlasts(this);
    stepZone(this, dt);
    stepSupply(this);
    for (const [id, l] of this.loot) {
      if (!l.dead) continue;
      this.loot.delete(id);
      this.lootIndex.remove(l);
    }
    this.recordHistory();
  }

  private handleCasts(p: Player, pressed: number) {
    const keys: [number, number][] = [[BTN.p1, 0], [BTN.p2, 1]];
    for (const [btn, idx] of keys) {
      if (!(pressed & btn)) continue;
      const slot = p.slots[idx];
      if (!slot) continue;
      const def = powerDef(slot.id);
      if (!def) continue;
      if (slot.recast > 0 && def.onRecast) {
        def.onRecast(this, p, slot);
        // Echo Storm echoes recasts too (second portal, second swap…).
        if ((p.status.echo ?? 0) > 0) {
          this.spawnEffect({ kind: "flash", owner: p.id, x: p.x, y: p.y, life: ULTIMATES.echoStorm.echoDelay, source: "echoStorm", n: POWER_IDS.indexOf(slot.id), v: -2 });
        }
        continue;
      }
      if (slot.cd > 0) continue;
      if (def.onCast(this, p, slot)) {
        slot.cd = def.cooldown;
        const s = this.stat(p.id);
        s.casts++;
        s.powersUsed.add(slot.id);
        this.emit({ t: "cast", by: p.id, power: slot.id, x: p.x, y: p.y, angle: p.aim });
        if ((p.status.echo ?? 0) > 0) {
          this.spawnEffect({ kind: "flash", owner: p.id, x: p.x, y: p.y, life: ULTIMATES.echoStorm.echoDelay, source: "echoStorm", n: POWER_IDS.indexOf(slot.id), v: -1 });
        }
      }
    }
    if ((pressed & BTN.ult) && p.ult && p.ult.charge >= ULT_CHARGE.max) {
      const def = ultDef(p.ult.id);
      if (def && def.onCast(this, p)) {
        p.ult.charge = 0;
        this.stat(p.id).powersUsed.add(p.ult.id);
        this.emit({ t: "cast", by: p.id, power: p.ult.id, x: p.x, y: p.y, angle: p.aim });
      }
    }
  }

  /** Re-casts a power for Echo Storm (no cooldown, no events loop). */
  echoCast(p: Player, power: PowerId) {
    const def = powerDef(power);
    if (!def || !p.alive) return;
    const fake = { id: power, cd: 0, recast: 0 };
    if (def.onCast(this, p, fake)) this.emit({ t: "cast", by: p.id, power, x: p.x, y: p.y, angle: p.aim });
  }

  private recordHistory() {
    for (const p of this.players.values()) {
      let h = this.history.get(p.id);
      if (!h) {
        h = [];
        this.history.set(p.id, h);
      }
      h.push({ tick: this.tick, x: p.x, y: p.y, hp: p.hp });
      if (h.length > HISTORY_TICKS) h.shift();
    }
  }

  /** Where a player was `seconds` ago (Chrono Rewind). */
  pastState(p: Player, seconds: number): HistoryEntry | null {
    const h = this.history.get(p.id);
    if (!h || h.length === 0) return null;
    const target = this.tick - Math.round(seconds * NET.tickRate);
    for (const e of h) if (e.tick >= target) return e;
    return h[0] ?? null;
  }

  historyPath(p: Player, seconds: number): { x: number; y: number }[] {
    const h = this.history.get(p.id) ?? [];
    const target = this.tick - Math.round(seconds * NET.tickRate);
    return h.filter((e) => e.tick >= target).map((e) => ({ x: e.x, y: e.y }));
  }
}
