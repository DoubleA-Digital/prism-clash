// The authoritative game world. The server runs one per room at 30 ticks/s. Systems run in
// a fixed order each tick; everything visual the clients need is emitted as events.

import { ARENA, KILL_CREDIT_SECONDS, NET, PICKUPS, PLAYER, POWERS, SHOT, ULT_CHARGE, ULTIMATES, ZONE } from "../config";
import { Rng } from "../math/rng";
import { dist2, sweepCircle } from "../math/vec";
import { buildArena, insideNebula, spawnPoints, type ArenaDef, type LayoutId } from "./arena";
import { collideArena, movePlayer, type MoveInput } from "./movement";
import { effectHooks, powerDef, projectileExpireHook, projectileHitHook, ultDef } from "./hooks";
import type { Effect, EffectKind, GameEvent, InputFrame, Pickup, PickupKind, Player, PowerId, Projectile, ProjKind, SourceId, StatusId } from "./types";
import { BTN, PF, POWER_IDS } from "./types";

export interface ZoneState {
  x: number;
  y: number;
  r: number;
  fromX: number;
  fromY: number;
  fromR: number;
  toX: number;
  toY: number;
  toR: number;
  /** -1 before the first stage starts; otherwise the current stage index. */
  stage: number;
  phase: "wait" | "warn" | "shrink" | "done";
  timer: number;
  /** Seconds until the current phase ends (for the HUD). */
  remaining: number;
}

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
}

export interface DamageOpts {
  crit?: boolean;
  /** Ground hazards don't hurt airborne players. */
  ground?: boolean;
  /** Don't count toward ult charge (zone damage). */
  noCharge?: boolean;
  /** Ignore invulnerability (zone). */
  pierce?: boolean;
  x?: number;
  y?: number;
}

const HISTORY_TICKS = 3 * NET.tickRate;

export class World {
  readonly dt = 1 / NET.tickRate;
  tick = 0;
  time = 0;
  rng: Rng;
  arena: ArenaDef;
  players = new Map<number, Player>();
  projectiles: Projectile[] = [];
  private projPool: Projectile[] = [];
  effects = new Map<number, Effect>();
  pickups = new Map<number, Pickup>();
  events: GameEvent[] = [];
  zone: ZoneState;
  /** Death order this round (first to die first). */
  deaths: { id: number; tick: number; killer: number }[] = [];
  stats = new Map<number, RoundStats>();
  /** Total points this match by player, set by the room (Bounty Beacon reads it). */
  points = new Map<number, number>();
  /** Latency (ticks) per player for lag compensation, set by the room. */
  latencyTicks = new Map<number, number>();
  history = new Map<number, HistoryEntry[]>();
  /** Last tick a player fired (minimap reveal + nebula reveal). */
  firedAt = new Map<number, number>();
  /** When the next pickup spawns. */
  private pickupT: number;
  private nextId = 1;
  /** Which combos fired this round per player (stats). */
  comboLog: { by: number; name: string; stolen: boolean; tick: number }[] = [];
  /** Damage log for "Most Chaotic Moment" (tick, attacker, amount). */
  damageLog: { tick: number; by: number; amount: number }[] = [];
  /** Previous distinct attacker per player (see hurtByOther). */
  private prevDamager = new Map<number, { by: number; at: number }>();

  constructor(layout: LayoutId, playerCount: number, seed: number) {
    this.rng = new Rng(seed);
    this.arena = buildArena(layout, playerCount, seed, 100000);
    this.zone = { x: 0, y: 0, r: this.arena.radius * 1.2, fromX: 0, fromY: 0, fromR: 0, toX: 0, toY: 0, toR: 0, stage: -1, phase: "wait", timer: 0, remaining: ZONE.startDelay };
    this.pickupT = PICKUPS.firstAt;
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
      hp: PLAYER.maxHp, alive: true, connected: true, dashT: 0, dashCd: 0, dashX: 0, dashY: 0, fireCd: 0,
      ammo: SHOT.ammoMax, ammoT: 0, sinceDamage: 99, sinceShot: 99, slots: [null, null, null], ult: null, status: {},
      lastHitBy: 0, lastHitSource: "shot", lastHitTick: -9999, warp: 0, ackSeq: 0, absorbed: 0, cloakCrit: false,
      damagedAt: -9999, damagedBy: 0,
    };
    this.players.set(id, p);
    this.stats.set(id, { damage: 0, kills: 0, shots: 0, hits: 0, casts: 0, combos: 0, powersUsed: new Set() });
    return p;
  }

  /** Places everyone evenly around the edge (random rotation per round). */
  placeSpawns() {
    const list = [...this.players.values()];
    const pts = spawnPoints(this.arena, list.length, this.rng.range(0, Math.PI * 2));
    this.rng.shuffle(list).forEach((p, i) => {
      const s = pts[i];
      if (!s) return;
      p.x = s.x;
      p.y = s.y;
      p.aim = s.aim;
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
    p.x = x;
    p.y = y;
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
      s = { damage: 0, kills: 0, shots: 0, hits: 0, casts: 0, combos: 0, powersUsed: new Set() };
      this.stats.set(id, s);
    }
    return s;
  }

  // ---- damage --------------------------------------------------------------------

  /** The one place damage happens. Returns the damage actually dealt. */
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
      this.emit({ t: "hit", target: target.id, by, amount: 0, crit: false, source, x: target.x, y: target.y });
      return 0;
    }
    if ((st.cloaked ?? 0) > 0) {
      st.cloaked = 0;
      target.cloakCrit = false;
    }
    dmg = Math.min(dmg, target.hp);
    target.hp -= dmg;
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
        if (!opts.noCharge) this.chargeUlt(attacker, dmg * ULT_CHARGE.perDamageDealt);
        const s = this.stat(attacker.id);
        s.damage += dmg;
        this.damageLog.push({ tick: this.tick, by: attacker.id, amount: dmg });
      }
    }
    if (!opts.noCharge) this.chargeUlt(target, dmg * ULT_CHARGE.perDamageTaken);
    this.emit({ t: "hit", target: target.id, by, amount: Math.round(dmg), crit, source, x: opts.x ?? target.x, y: opts.y ?? target.y });
    if (target.hp <= 0.0001) this.kill(target);
    return dmg;
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
    const credited = this.tick - p.lastHitTick <= KILL_CREDIT_SECONDS * NET.tickRate && p.lastHitBy !== p.id ? p.lastHitBy : 0;
    if (credited) this.stat(credited).kills++;
    this.deaths.push({ id: p.id, tick: this.tick, killer: credited });
    this.emit({ t: "kill", victim: p.id, killer: credited, source: credited ? p.lastHitSource : "zone", x: p.x, y: p.y });
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
    p.r = o.r ?? SHOT.radius;
    p.damage = o.damage ?? SHOT.damage;
    p.life = o.life ?? SHOT.life;
    p.bounces = 0;
    p.maxBounces = o.maxBounces ?? 0;
    p.flags = o.flags ?? 0;
    p.source = o.source ?? "shot";
    p.shotId = o.shotId ?? 0;
    p.portalCd = 0;
    p.portalOwner = 0;
    p.dead = false;
    this.projectiles.push(p);
    return p;
  }

  /** A basic shot from a player, with lag compensation catch-up. */
  fireShot(p: Player, shotId: number) {
    const ang = p.aim;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    let flags = 0;
    let damage = SHOT.damage;
    let maxBounces = 0;
    if ((p.status.ricochet ?? 0) > 0) {
      flags |= PF.ricochet;
      maxBounces = POWERS.ricochetPrism.maxBounces;
    }
    if (p.cloakCrit || (p.status.cloaked ?? 0) > 0) {
      flags |= PF.crit;
      damage *= SHOT.critMult;
      p.cloakCrit = false;
      p.status.cloaked = 0;
    }
    if ((p.status.hunter ?? 0) > 0) flags |= PF.homing;
    const proj = this.spawnProjectile({
      owner: p.id, x: p.x + cos * SHOT.spawnOffset, y: p.y + sin * SHOT.spawnOffset,
      vx: cos * SHOT.speed + p.vx * 0.15, vy: sin * SHOT.speed + p.vy * 0.15, damage, flags, maxBounces, shotId, source: "shot",
    });
    this.stat(p.id).shots++;
    this.firedAt.set(p.id, this.tick);
    p.sinceShot = 0;
    this.emit({ t: "shoot", by: p.id, x: proj.x, y: proj.y, angle: ang });
    this.lagCompensate(proj);
  }

  /** Runs a new projectile through the past positions of other players (shooter's view). */
  lagCompensate(proj: Projectile) {
    const lat = Math.min(this.latencyTicks.get(proj.owner) ?? 0, Math.round((NET.lagCompMaxMs / 1000) * NET.tickRate));
    for (let k = lat; k > 0 && !proj.dead; k--) {
      this.stepProjectile(proj, this.dt, this.tick - k);
    }
  }

  private positionAt(p: Player, tick: number): { x: number; y: number } {
    if (tick >= this.tick) return p;
    const h = this.history.get(p.id);
    if (!h) return p;
    for (let i = h.length - 1; i >= 0; i--) {
      const e = h[i];
      if (e && e.tick <= tick) return e;
    }
    return p;
  }

  /** Moves one projectile, handling walls, pillars, fields, decoys and players. */
  stepProjectile(pr: Projectile, dt: number, asOfTick = this.tick) {
    // Held in orbit by an effect (Magnetar), which moves it; it fizzles if nothing refreshes it.
    if ((pr.flags & PF.captured) !== 0) {
      pr.life -= dt;
      if (pr.life <= 0) this.killProjectile(pr);
      return;
    }
    let scale = 1;
    for (const e of this.effects.values()) {
      const h = effectHooks(e.kind);
      if (h?.affectProjectile && !e.dead) {
        const s = h.affectProjectile(this, e, pr, dt);
        if (typeof s === "number") scale *= s;
        if (pr.dead) return;
      }
    }
    if ((pr.flags & PF.homing) !== 0) this.steerHoming(pr, dt);
    const sdt = dt * scale;
    const ox = pr.x;
    const oy = pr.y;
    const nx = ox + pr.vx * sdt;
    const ny = oy + pr.vy * sdt;
    pr.life -= sdt;
    if (pr.portalCd > 0) pr.portalCd -= dt;

    // Players (swept), using rewound positions during lag compensation.
    let bestT = 2;
    let bestP: Player | null = null;
    for (const pl of this.players.values()) {
      if (!pl.alive || pl.id === pr.owner || (pl.status.airborne ?? 0) > 0) continue;
      const pos = this.positionAt(pl, asOfTick);
      const t = sweepCircle(ox, oy, nx, ny, pos.x, pos.y, pl.r + pr.r);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestP = pl;
      }
    }
    // Decoys and clones absorb hits too.
    let bestE: Effect | null = null;
    for (const e of this.effects.values()) {
      if (e.dead || (e.kind !== "decoy" && e.kind !== "clone") || e.owner === pr.owner) continue;
      const t = sweepCircle(ox, oy, nx, ny, e.x, e.y, e.r + pr.r);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestP = null;
        bestE = e;
      }
    }
    if (bestT <= 1) {
      const hx = ox + (nx - ox) * bestT;
      const hy = oy + (ny - oy) * bestT;
      if (bestE) {
        effectHooks(bestE.kind)?.onProjectileHit?.(this, bestE, pr);
        this.emit({ t: "impact", x: hx, y: hy, color: this.colorOf(pr.owner), size: 1 });
        this.killProjectile(pr);
        return;
      }
      if (bestP) {
        this.hitPlayer(pr, bestP, hx, hy);
        return;
      }
    }

    pr.x = nx;
    pr.y = ny;
    // Pillars
    for (const pl of this.arena.pillars) {
      if (pl.dead) continue;
      if (dist2(pr.x, pr.y, pl.x, pl.y) < (pl.r + pr.r) ** 2) {
        this.damagePillar(pl.id, pr.kind === 0 ? SHOT.pillarDamage : 3, pr.x, pr.y);
        if (pr.bounces < pr.maxBounces && !pl.dead) {
          const dx = pr.x - pl.x;
          const dy = pr.y - pl.y;
          const d = Math.hypot(dx, dy) || 1;
          const nX = dx / d;
          const nY = dy / d;
          pr.x = pl.x + nX * (pl.r + pr.r + 0.5);
          pr.y = pl.y + nY * (pl.r + pr.r + 0.5);
          const vn = pr.vx * nX + pr.vy * nY;
          pr.vx -= 2 * vn * nX;
          pr.vy -= 2 * vn * nY;
          this.bounce(pr);
        } else {
          this.emit({ t: "impact", x: pr.x, y: pr.y, color: this.colorOf(pr.owner), size: 1 });
          this.killProjectile(pr);
          return;
        }
      }
    }
    // Walls
    const body = { x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy };
    const wall = collideArena(this.arena, body, pr.r, 1);
    if (wall) {
      if (pr.bounces < pr.maxBounces) {
        pr.x = body.x;
        pr.y = body.y;
        pr.vx = body.vx;
        pr.vy = body.vy;
        this.bounce(pr);
      } else {
        this.emit({ t: "impact", x: body.x, y: body.y, color: this.colorOf(pr.owner), size: 1 });
        this.killProjectile(pr);
        return;
      }
    }
    if (pr.life <= 0) {
      const h = pr.source !== "shot" ? projectileExpireHook(pr.source) : undefined;
      h?.(this, pr);
      this.killProjectile(pr);
    }
  }

  private bounce(pr: Projectile) {
    pr.bounces++;
    pr.damage *= 1 + POWERS.ricochetPrism.damagePerBounce;
    pr.life = Math.max(pr.life, 0.5);
    this.emit({ t: "bounce", x: pr.x, y: pr.y, n: pr.bounces });
  }

  private steerHoming(pr: Projectile, dt: number) {
    let best: Player | null = null;
    let bd = ULTIMATES.huntersEye.homingRange ** 2;
    for (const p of this.players.values()) {
      if (!p.alive || p.id === pr.owner) continue;
      const d = dist2(pr.x, pr.y, p.x, p.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    const sp = Math.hypot(pr.vx, pr.vy);
    const want = Math.atan2(best.y - pr.y, best.x - pr.x);
    const cur = Math.atan2(pr.vy, pr.vx);
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const maxTurn = ULTIMATES.huntersEye.homingTurn * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, d));
    pr.vx = Math.cos(cur + turn) * sp;
    pr.vy = Math.sin(cur + turn) * sp;
  }

  hitPlayer(pr: Projectile, target: Player, x: number, y: number) {
    const crit = (pr.flags & PF.crit) !== 0;
    const owner = this.players.get(pr.owner);
    const hook = pr.source !== "shot" ? projectileHitHook(pr.source) : undefined;
    if (hook) {
      hook(this, pr, target, x, y);
    } else {
      const dealt = this.damage(target, pr.damage, pr.owner, pr.source, { crit, x, y });
      if (dealt > 0 && owner) this.stat(owner.id).hits++;
      // Phantom Mark: a basic shot on a marked target doubles the sigil.
      if (pr.source === "shot" && pr.kind === 0) {
        for (const e of this.effects.values()) {
          if (e.kind === "sigil" && e.link === target.id && e.owner === pr.owner && !e.dead) e.n = 1;
        }
      }
    }
    this.emit({ t: "impact", x, y, color: this.colorOf(pr.owner), size: crit ? 2 : 1 });
    this.killProjectile(pr);
  }

  killProjectile(pr: Projectile) {
    pr.dead = true;
  }

  colorOf(id: number): number {
    return this.players.get(id)?.color ?? 0;
  }

  // ---- pillars, pickups, effects -----------------------------------------------------

  damagePillar(id: number, amount: number, x: number, y: number) {
    const p = this.arena.pillars.find((q) => q.id === id);
    if (!p || p.dead) return;
    p.hp -= amount;
    if (p.hp <= 0) {
      p.dead = true;
      this.emit({ t: "pillarBroken", id, x: p.x, y: p.y, r: p.r });
    } else this.emit({ t: "pillarHit", id, x, y });
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

  /** Damages everyone in a circle (explosions). */
  explode(x: number, y: number, r: number, damage: number, by: number, source: SourceId, opts: { knock?: number; hitOwner?: boolean } = {}) {
    for (const p of this.playersNear(x, y, r, opts.hitOwner ? 0 : by)) {
      this.damage(p, damage, by, source, { x: p.x, y: p.y });
      if (opts.knock) {
        const dx = p.x - x;
        const dy = p.y - y;
        const d = Math.hypot(dx, dy) || 1;
        this.impulse(p, (dx / d) * opts.knock, (dy / d) * opts.knock);
      }
    }
    for (const pl of this.arena.pillars) {
      if (!pl.dead && dist2(x, y, pl.x, pl.y) < (r + pl.r) ** 2) this.damagePillar(pl.id, Math.ceil(damage / 4), pl.x, pl.y);
    }
    this.emit({ t: "explode", x, y, r, source, by });
  }

  /** Is the point inside the arena's walls? */
  insideArena(x: number, y: number, margin = 0): boolean {
    for (const w of this.arena.walls) if ((x - w.ax) * w.nx + (y - w.ay) * w.ny < margin) return false;
    return true;
  }

  /** Line of sight blocked by a live pillar? */
  blocked(ax: number, ay: number, bx: number, by: number): boolean {
    for (const p of this.arena.pillars) {
      if (p.dead) continue;
      if (sweepCircle(ax, ay, bx, by, p.x, p.y, p.r * 0.92) >= 0) return true;
    }
    return false;
  }

  /** Nebula hiding (Brawl Stars bushes): hidden unless close, or they just fired. */
  hiddenFrom(viewer: Player | null, target: Player): boolean {
    if (!viewer || viewer.id === target.id || !target.alive) return false;
    if ((viewer.status.hunter ?? 0) > 0) return false;
    if ((target.status.bountied ?? 0) > 0) return false;
    const fired = this.firedAt.get(target.id) ?? -999;
    if (this.tick - fired < 1.1 * NET.tickRate) return false;
    if (!insideNebula(this.arena, target.x, target.y)) return false;
    return dist2(viewer.x, viewer.y, target.x, target.y) > 230 * 230;
  }

  // ---- the tick ------------------------------------------------------------------

  /**
   * Advances the world one tick. `inputs` holds the input frames each player sent since the
   * last tick. Movement runs once per frame with that frame's own dt, exactly like the
   * client's prediction, so predicted and authoritative movement match. Shooting and casting
   * use the frames merged together (a tap in any frame counts).
   */
  step(inputs: Map<number, InputFrame[]>) {
    const dt = this.dt;
    this.events = [];
    this.tick++;
    this.time += dt;

    // Status timers
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

    // Players: movement, shooting, casting
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const frames = p.connected ? (inputs.get(p.id) ?? []) : [];
      const ts = timeScale.get(p.id) ?? 1;
      // A connected player only moves on their own input frames (exactly what their client
      // predicted). A tick without frames is normal network timing, not "standing still".
      // Disconnected players (and the room's starved-input fallback) drift idle instead.
      const moves: { mi: MoveInput; dt: number }[] = frames.length
        ? frames.map((f) => ({ mi: f, dt: f.dt }))
        : p.connected ? [] : [{ mi: { mx: 0, my: 0, aim: p.aim, buttons: 0, pressed: 0 }, dt }];
      for (const m of moves) {
        const res = movePlayer(p, m.mi, this.arena, this.arena.pillars, m.dt, ts);
        if (res.dashed) this.emit({ t: "dash", by: p.id, x: p.x, y: p.y });
        const impact = Math.max(res.wall?.impact ?? 0, res.pillarImpact?.impact ?? 0);
        if (impact > ARENA.wallSlamMinSpeed && p.lastHitTick > this.tick - 15) {
          const dmg = ARENA.wallSlamDamage * Math.min(1.6, impact / 900);
          this.damage(p, dmg, p.lastHitBy, "wall", {});
          this.emit({ t: "wallSlam", target: p.id, x: p.x, y: p.y });
          if (res.pillarImpact) this.damagePillar(res.pillarImpact.pillar.id, 6, p.x, p.y);
        }
        if (!p.alive) break;
      }
      const last = frames[frames.length - 1];
      if (last) p.ackSeq = last.seq;
      let input: InputFrame | undefined;
      if (last) {
        let buttons = 0;
        let pressed = 0;
        let shotId = 0;
        for (const f of frames) {
          buttons |= f.buttons;
          pressed |= f.pressed;
          if (f.shotId) shotId = f.shotId;
        }
        input = { ...last, buttons, pressed, shotId };
      }

      // Ammo + fire
      const sdt = dt * ts;
      p.fireCd = Math.max(0, p.fireCd - sdt);
      if (p.ammo < SHOT.ammoMax) {
        p.ammoT += sdt * ((p.status.overdrive ?? 0) > 0 ? 2.2 : 1);
        if (p.ammoT >= SHOT.ammoReload) {
          p.ammoT = 0;
          p.ammo++;
        }
      } else p.ammoT = 0;
      p.sinceDamage += dt;
      p.sinceShot += dt;
      if (p.sinceDamage > PLAYER.regenDelay && p.sinceShot > 1.2 && p.hp < PLAYER.maxHp) this.heal(p, PLAYER.regenPerSecond * dt);

      const airborne = (p.status.airborne ?? 0) > 0;
      if (input && !airborne && p.connected && p.alive) {
        if ((input.buttons & BTN.shoot) && p.fireCd <= 0 && p.ammo > 0 && p.dashT <= 0) {
          const od = (p.status.overdrive ?? 0) > 0;
          p.fireCd = SHOT.fireCooldown / (od ? 2 : 1);
          if (!od) p.ammo--;
          this.fireShot(p, input.shotId);
        }
        this.handleCasts(p, input);
      }
      // Power cooldowns and recast windows
      for (const s of p.slots) {
        if (!s) continue;
        s.cd = Math.max(0, s.cd - dt);
        if (s.recast > 0) {
          s.recast = Math.max(0, s.recast - dt);
          if (s.recast === 0) powerDef(s.id)?.onRecastExpire?.(this, p, s);
        }
      }
      // Per-player power ticks (molten trail etc.)
      for (const s of p.slots) if (s) powerDef(s.id)?.onPlayerTick?.(this, p, dt);
    }

    // Projectiles
    for (const pr of this.projectiles) if (!pr.dead) this.stepProjectile(pr, dt);
    this.projectiles = this.projectiles.filter((pr) => {
      if (pr.dead) this.projPool.push(pr);
      return !pr.dead;
    });

    // Effects
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

    this.stepZone(dt);
    this.stepPickups(dt);
    this.collectPickups();
    this.recordHistory();
  }

  private handleCasts(p: Player, input: InputFrame) {
    const keys: [number, number][] = [[BTN.p1, 0], [BTN.p2, 1], [BTN.p3, 2]];
    for (const [btn, idx] of keys) {
      if (!(input.pressed & btn)) continue;
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
        // Echo Storm: cast it again shortly after.
        if ((p.status.echo ?? 0) > 0) {
          this.spawnEffect({ kind: "flash", owner: p.id, x: p.x, y: p.y, life: ULTIMATES.echoStorm.echoDelay, source: "echoStorm", n: POWER_IDS.indexOf(slot.id), v: -1 });
        }
      }
    }
    if ((input.pressed & BTN.ult) && p.ult && p.ult.charge >= ULT_CHARGE.max) {
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

  private stepZone(dt: number) {
    const z = this.zone;
    z.timer += dt;
    const stages = ZONE.stages;
    if (z.phase === "wait") {
      z.remaining = ZONE.startDelay - z.timer;
      if (z.timer >= ZONE.startDelay) this.beginZoneStage(0);
    } else if (z.phase === "warn") {
      const st = stages[z.stage];
      if (!st) return;
      z.remaining = st.warn - z.timer;
      if (z.timer >= st.warn) {
        z.phase = "shrink";
        z.timer = 0;
      }
    } else if (z.phase === "shrink") {
      const st = stages[z.stage];
      if (!st) return;
      const t = Math.min(1, z.timer / st.shrink);
      const e = t * t * (3 - 2 * t);
      z.x = z.fromX + (z.toX - z.fromX) * e;
      z.y = z.fromY + (z.toY - z.fromY) * e;
      z.r = z.fromR + (z.toR - z.fromR) * e;
      z.remaining = st.shrink - z.timer;
      if (t >= 1) {
        if (z.stage + 1 < stages.length) this.beginZoneStage(z.stage + 1);
        else {
          z.phase = "done";
          z.remaining = 0;
        }
      }
    }
    // Damage outside, applied in chunks.
    if (z.stage >= 0) {
      const dps = stages[Math.min(z.stage, stages.length - 1)]?.dps ?? 0;
      if (this.tick % Math.round(NET.tickRate * 0.5) === 0) {
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          if (dist2(p.x, p.y, z.x, z.y) > z.r * z.r) this.damage(p, dps * 0.5, 0, "zone", { pierce: true, noCharge: true });
        }
      }
    }
  }

  private beginZoneStage(i: number) {
    const z = this.zone;
    const st = ZONE.stages[i];
    if (!st) return;
    if (i === 0) {
      z.x = 0;
      z.y = 0;
      z.r = this.arena.radius * 1.05;
    }
    z.stage = i;
    z.phase = "warn";
    z.timer = 0;
    z.fromX = z.x;
    z.fromY = z.y;
    z.fromR = z.r;
    z.toR = this.arena.radius * st.radiusFrac;
    // New center inside the current circle, so the final position is random but reachable.
    const maxOff = Math.max(0, z.r - z.toR) * 0.75;
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(0, maxOff);
    let tx = z.x + Math.cos(a) * d;
    let ty = z.y + Math.sin(a) * d;
    const lim = this.arena.radius * 0.8 - z.toR;
    const l = Math.hypot(tx, ty);
    if (l > lim && l > 0) {
      tx *= Math.max(0, lim) / l;
      ty *= Math.max(0, lim) / l;
    }
    z.toX = tx;
    z.toY = ty;
    this.emit({ t: "zoneStage", stage: i });
  }

  private stepPickups(dt: number) {
    this.pickupT -= dt;
    if (this.pickupT > 0) return;
    this.pickupT = PICKUPS.interval;
    if (this.pickups.size >= PICKUPS.maxOnMap) return;
    for (let attempt = 0; attempt < 20; attempt++) {
      const z = this.zone;
      const r = Math.min(z.r, this.arena.radius * 0.85) * Math.sqrt(this.rng.next());
      const a = this.rng.range(0, Math.PI * 2);
      const x = z.x + Math.cos(a) * r;
      const y = z.y + Math.sin(a) * r;
      if (!this.insideArena(x, y, 60)) continue;
      if (this.arena.pillars.some((p) => !p.dead && dist2(x, y, p.x, p.y) < (p.r + 40) ** 2)) continue;
      if ([...this.players.values()].some((p) => p.alive && dist2(x, y, p.x, p.y) < PICKUPS.minDistFromPlayers ** 2)) continue;
      const kind = this.rng.weighted(PICKUPS.weights) as PickupKind;
      const id = this.id();
      this.pickups.set(id, { id, kind, x, y, dead: false });
      break;
    }
  }

  /** Called every tick for pickups so collection is immediate. */
  collectPickups() {
    for (const pk of this.pickups.values()) {
      if (pk.dead) continue;
      for (const p of this.players.values()) {
        if (p.alive && dist2(p.x, p.y, pk.x, pk.y) < (p.r + PICKUPS.radius) ** 2) {
          this.collect(p, pk);
          break;
        }
      }
    }
    for (const [id, pk] of this.pickups) if (pk.dead) this.pickups.delete(id);
  }

  private collect(p: Player, pk: Pickup) {
    if (pk.dead) return;
    pk.dead = true;
    if (pk.kind === "heal") this.heal(p, PICKUPS.heal);
    else if (pk.kind === "cooldown") for (const s of p.slots) { if (s) s.cd = 0; }
    else if (pk.kind === "ult") this.chargeUlt(p, PICKUPS.ultCharge);
    else if (pk.kind === "prism") {
      const owned = new Set(p.slots.filter((s) => s).map((s) => s?.id));
      const pool = POWER_IDS.filter((id) => !owned.has(id));
      p.slots[2] = { id: this.rng.pick(pool), cd: 0, recast: 0 };
    }
    this.emit({ t: "pickup", by: p.id, kind: pk.kind, x: pk.x, y: pk.y });
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
