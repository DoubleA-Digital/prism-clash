// The bot brain. Every tick it listens (sounds and hits from the last step) and moves along
// its nav path; ten times a second it perceives honestly (perception.ts), scores its options
// (utility.ts: fight, flee, heal, loot, crate, rotate, supply, investigate, ambush, roam),
// turns the winner into a goal plus fight micro (fight.ts), and plans throws, weapon swaps
// and power casts (tactics.ts). Aim lags by the reaction time and carries difficulty-based
// error that settles while tracking the same target. Inputs go through the same validation
// and cooldowns as a human's, so bots can't cheat.

import {
  activeWeapon, BOTS, BTN, magSize, pickHeal, Rng, sweepSolids, WEAPONS,
  type Difficulty, type InputFrame, type Player, type PowerId, type Solid, type UltId, type World,
} from "@prism/shared";
import { backOff, findCover, nearCrate, pickTarget, winChance, type Spot } from "./combat";
import { pickPowerIndex, pickUltIndex } from "./draft";
import { FightMicro } from "./fight";
import { Hands } from "./hands";
import { armedLevel, bestSlotFor, lootValue, pickLoot, wantsInteract, weaponRange, worstSlot } from "./looting";
import { Nav } from "./nav";
import { Perception, type Contact } from "./perception";
import { findAmbush, pickRoam, supplySpot } from "./places";
import { makeProfile, type PersonalityId, type Profile } from "./personality";
import { avoidHazards, dodge, incoming } from "./reflexes";
import { Steering } from "./steering";
import { chooseCast } from "./tactics";
import { planThrow } from "./throws";
import { chooseState, zoneInfo, type BotState } from "./utility";

const C = BOTS.combat;

export class SmartBrain {
  readonly profile: Profile;
  state: BotState = "roam";
  private rng: Rng;
  private seed: number;
  private per: Perception;
  private steering: Steering;
  private fight = new FightMicro();
  private hands: Hands;
  private seq = 0;
  private thinkT = 0;
  // Intent decided at think rate, applied every tick.
  private goal: Spot | null = null;
  private strafe = 0;
  private stop = false;
  private holdFire = false;
  private reflexX = 0;
  private reflexY = 0;
  private wantDash = false;
  private healing = false;
  private crate: Solid | null = null;
  // Targeting and aim.
  private targetId = 0;
  // One-shot buttons decided while thinking.
  private press = 0;
  private throwAim: number | null = null;
  private castQueue: { slot: number; aim: number | null }[] = [];
  private slotAge = [0, 0];
  private threatCount = 0;
  // State memory.
  private roam: Spot | null = null;
  private roamT = 0;
  private cover: Spot | null = null;
  private coverT = 0;
  private ambushSpot: Spot | null = null;
  private ambushScanT = 0;
  private ambushUntil = 0;
  private ambushCd = 0;
  private ambushFight = false;
  /** Loot items / crates we gave up on (id → until when). */
  private ignore = new Map<number, number>();
  private goalKey = 0;
  private goalSince = 0;
  private goalBest = 0;
  private goalBestAt = 0;
  /** How close counts as arrived (loot needs precision to stand on the right item). */
  private goalReach: number = BOTS.nav.waypointReach;

  constructor(difficulty: Difficulty, seed: number, personality?: PersonalityId) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.profile = makeProfile(difficulty, this.rng, personality);
    this.per = new Perception(this.profile.reaction, this.profile.hearing, this.rng);
    this.steering = new Steering(this.rng);
    this.hands = new Hands(this.profile, this.rng);
    this.ambushCd = this.rng.range(10, 40);
    // Stagger the 10 Hz thinking so a lobby of bots doesn't all think on the same tick.
    this.thinkT = this.rng.range(0, 1 / BOTS.thinkHz);
  }

  pickUlt(options: readonly UltId[]): number {
    return pickUltIndex(options, this.profile.personality, this.rng);
  }

  pickPower(options: readonly PowerId[], held: readonly (PowerId | null)[]): number {
    return pickPowerIndex(options, held, this.profile.personality, this.rng);
  }

  /** A stable per-bot random in [0, 1) for an id (noisy loot judgement). */
  private hash = (id: number): number => {
    let h = Math.imul(id ^ this.seed, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };

  think(w: World, me: Player): InputFrame {
    const dt = w.dt;
    this.per.listen(w, me);
    this.thinkT -= dt;
    let look = false;
    if (this.thinkT <= 0) {
      this.thinkT = 1 / BOTS.thinkHz;
      look = true;
      this.perceive(w, me);
    }
    const target = this.targetId ? this.per.contacts.get(this.targetId) ?? null : null;
    const tp = target?.visible ? w.players.get(target.id) : undefined;
    this.hands.track(w, me, tp ?? null);

    // Movement: nav path toward the goal, plus weaving and reflexes, then local steering.
    let mx = 0;
    let my = 0;
    if (this.goal && !this.stop) {
      const dir = this.steering.toward(w, me, this.goal.x, this.goal.y, dt, look, this.goalReach);
      mx += dir.x;
      my += dir.y;
    } else this.steering.noGoal();
    if (this.strafe > 0 && tp) {
      const a = Math.atan2(tp.y - me.y, tp.x - me.x) + (Math.PI / 2) * this.fight.strafeDir;
      if (!look || this.steering.clear(w, me, a)) {
        mx += Math.cos(a) * this.strafe;
        my += Math.sin(a) * this.strafe;
      } else this.fight.strafeDir *= -1;
    }
    mx += this.reflexX;
    my += this.reflexY;
    const l = Math.hypot(mx, my);
    const s = this.steering.steer(w, me, l > 1 ? mx / l : mx, l > 1 ? my / l : my, dt);

    // Hands.
    let pressed = this.press;
    let buttons = this.press;
    this.press = 0;
    const gun = activeWeapon(me);
    const def = gun ? WEAPONS[gun.id] : WEAPONS.pistol;
    let aim = Math.hypot(s.x, s.y) > 0.1 ? Math.atan2(s.y, s.x) : me.aim;
    const sight = tp && target ? this.hands.aim(me) : null;
    if (sight && tp && target) {
      const d = sight.dist;
      aim = sight.aim;
      if (gun?.id === "sniper" && d > 500) buttons |= BTN.scope;
      // Only open fire when we chose to fight (or are fleeing, or were just shot): a bot out
      // looting doesn't start a duel by plinking at everyone it sees.
      const hostile = (this.state === "fight" && !this.holdFire) || this.state === "flee" || w.time - this.per.lastHitAt < 2;
      if (hostile && !this.healing && w.time >= target.noticeAt && d < weaponRange(gun?.id ?? "pistol") * 1.25 && this.hands.shotClear(w, me, tp)) {
        buttons |= this.hands.trigger(me, d);
      }
    } else if (this.crate && !this.healing && this.state === "crate") {
      const c = this.crate;
      const cx = (c.x0 + c.x1) / 2;
      const cy = (c.y0 + c.y1) / 2;
      aim = Math.atan2(cy - me.y, cx - me.x);
      const hit = sweepSolids(w.map, me.x, me.y, cx, cy, 0);
      const reach = def.kind === "blade" ? def.reach + me.r : 460;
      if (!c.dead && hit?.solid === c && Math.hypot(cx - me.x, cy - me.y) < reach) buttons |= this.hands.trigger(me, 0);
    }
    if (this.healing) buttons |= BTN.heal;
    if (this.throwAim !== null && (pressed & BTN.throw)) aim = this.throwAim;
    this.throwAim = null;
    if (this.wantDash && me.dashCd <= 0 && !this.healing) {
      pressed |= BTN.dash;
      buttons |= BTN.dash;
      this.wantDash = false;
    }
    const cast = this.castQueue.shift();
    if (cast !== undefined) {
      const btn = cast.slot === 0 ? BTN.p1 : cast.slot === 1 ? BTN.p2 : BTN.ult;
      pressed |= btn;
      buttons |= btn;
      if (cast.aim !== null) aim = cast.aim + ((this.rng.next() * 2 - 1) * this.profile.aimErrorDeg * 0.8 * Math.PI) / 180;
    }
    for (let i = 0; i < 2; i++) {
      const sl = me.slots[i];
      this.slotAge[i] = sl && sl.recast > 0 ? (this.slotAge[i] ?? 0) + dt : 0;
    }
    return { seq: ++this.seq, mx: s.x, my: s.y, aim, buttons, pressed, dt, shotId: 0 };
  }

  private perceive(w: World, me: Player) {
    const now = w.time;
    const dt = 1 / BOTS.thinkHz;
    const p = this.profile;
    this.per.look(w, me);
    const nav = Nav.of(w);
    const grid = nav.grid;
    const visible = this.per.visible();
    const busy = (id: number) => {
      const o = w.players.get(id);
      return !!o && this.per.contacts.get(id)?.visible === true && w.hurtByOther(o, me.id);
    };

    // Who to focus: someone in sight, else the one we were fighting, else whoever shot us.
    let target: Contact | null = pickTarget(me, visible, this.targetId, busy);
    if (!target && this.targetId) {
      const c = this.per.contacts.get(this.targetId);
      if (c && now - Math.max(c.seenAt, c.heardAt) < C.pursueSeconds) target = c;
    }
    if (!target) {
      for (const c of this.per.contacts.values()) if (c.hitUsAt > now - 2 && (!target || c.hitUsAt > target.hitUsAt)) target = c;
    }
    if (target?.id !== this.targetId) this.hands.reset();
    this.targetId = target?.id ?? 0;
    const gun = activeWeapon(me);
    const gid = gun?.id ?? "pistol";
    const others = visible.length - (target?.visible ? 1 : 0);
    const win = target ? winChance(me, gid, gun?.rarity ?? 0, target, others, busy(target.id)) : 1;
    const tDist = target ? Math.hypot(target.x - me.x, target.y - me.y) : Infinity;
    const zi = zoneInfo(w, me.x, me.y, p.rotateEarly);
    const skip = (id: number) => (this.ignore.get(id) ?? 0) > now;
    const loot = pickLoot(w, me, BOTS.lootRange, p.lootSmarts, this.hash, skip);
    const crate = nearCrate(w, me, BOTS.crateRange, skip);
    const supply = supplySpot(w, me);
    const noise = this.per.latestFight(now, BOTS.investigate.memory);
    this.ambushCd -= dt;
    this.ambushScanT -= dt;
    if (this.ambushScanT <= 0) {
      this.ambushScanT = 2;
      this.ambushSpot = findAmbush(grid, me, zi, this.hash);
    }
    const healKind = pickHeal(me);
    const threats = incoming(w, me);
    this.threatCount = threats.length;

    const prev = this.state;
    let next = chooseState(
      {
        hp: me.hp, armor: me.armor, canHeal: healKind !== null,
        quiet: this.per.quietFor(now, me), quietNeeded: healKind === "medkit" ? BOTS.medkitQuietSeconds : BOTS.bandageQuietSeconds,
        target: target ? {
          visible: target.visible, dist: tDist, win, sinceSeen: now - Math.max(target.seenAt, target.heardAt),
          engaged: target.hitUsAt > now - 4 || tDist < Math.min(weaponRange(gid), BOTS.combat.engageRange) || this.state === "fight",
        } : null,
        hitRecently: now - this.per.lastHitAt < 1.5,
        lootValue: loot ? lootValue(me, loot) : 0, lootDist: loot ? Math.hypot(loot.x - me.x, loot.y - me.y) : Infinity,
        crateDist: crate ? Math.hypot((crate.x0 + crate.x1) / 2 - me.x, (crate.y0 + crate.y1) / 2 - me.y) : Infinity,
        armed: armedLevel(me), zoneOutside: zi.outside, zonePressure: zi.pressure,
        supplyDist: supply ? Math.hypot(supply.x - me.x, supply.y - me.y) : Infinity,
        noiseDist: noise ? Math.hypot(noise.x - me.x, noise.y - me.y) : Infinity, noiseAge: noise ? now - noise.at : Infinity,
        ambushSpot: !!this.ambushSpot, ambushReady: this.ambushCd <= 0 || (prev === "ambush" && now < this.ambushUntil),
        lateGame: w.zone.stage >= 2, early: w.time < BOTS.lootPhaseSeconds, current: prev,
      },
      p,
    );
    if (prev === "ambush" && next !== "ambush") this.ambushCd = BOTS.ambush.cooldown * this.rng.range(0.7, 1.3);
    if (next === "fight" && !target) next = "roam";
    if (next !== prev) {
      if (next === "fight") {
        this.fight.reset();
        this.ambushFight = prev === "ambush";
      }
      if (next === "ambush") this.ambushUntil = now + this.rng.range(BOTS.ambush.seconds[0], BOTS.ambush.seconds[1]);
      this.cover = null;
      this.goalKey = 0;
    }
    this.state = next;
    this.goal = null;
    this.strafe = 0;
    this.stop = false;
    this.holdFire = false;
    this.crate = null;
    this.goalReach = BOTS.nav.waypointReach;
    if (this.healing && (next !== "heal" || !me.healKind && healKind === null)) this.healing = false;
    let holding = false;

    switch (next) {
      case "fight": {
        if (!target) break;
        const fi = this.fight.plan({
          w, me, grid, p, target, now, dt, rng: this.rng, inZone: zi.safe, burst: this.per.damageWithin(now, 1.5),
          ambushing: this.ambushFight && now - this.per.lastHitAt > 3,
        });
        if (fi.drop) this.targetId = 0;
        this.goal = fi.goal;
        this.strafe = fi.strafe;
        this.stop = fi.stop;
        this.holdFire = fi.holdFire;
        holding = fi.stop || this.fight.inCover;
        // Grab something good lying right here.
        if (!this.goal && loot && Math.hypot(loot.x - me.x, loot.y - me.y) < 160 && lootValue(me, loot) > 2) this.goal = { x: loot.x, y: loot.y };
        break;
      }
      case "flee": {
        const t = target;
        if (t) {
          this.coverT -= dt;
          if (!this.cover || this.coverT <= 0) {
            this.cover = findCover(w, grid, me, t.x, t.y, zi.safe) ?? backOff(grid, me, t.x, t.y, 450);
            this.coverT = 1;
          }
          this.goal = this.cover;
          this.strafe = 0.3;
        } else this.goal = { x: zi.goalX, y: zi.goalY };
        break;
      }
      case "heal": {
        const quiet = this.per.quietFor(now, me);
        const need = healKind === "medkit" ? BOTS.medkitQuietSeconds : BOTS.bandageQuietSeconds;
        const threat = this.per.recent(now, 5).sort((a, b) => Math.max(b.seenAt, b.heardAt) - Math.max(a.seenAt, a.heardAt))[0];
        if (threat && !this.cover) this.cover = findCover(w, grid, me, threat.x, threat.y, zi.safe);
        const atCover = !this.cover || Math.hypot(this.cover.x - me.x, this.cover.y - me.y) < 50;
        if (me.healKind || (quiet >= need && atCover) || (quiet >= need * 2)) this.healing = true;
        else this.goal = this.cover;
        holding = true;
        break;
      }
      case "loot":
        if (loot && this.watchGoal(loot.id, now, BOTS.goalTimeout.loot, Math.hypot(loot.x - me.x, loot.y - me.y), 60)) {
          this.goal = { x: loot.x, y: loot.y };
          // Stand right on it, so F picks this item and not its neighbour in a pile.
          this.goalReach = 6;
        }
        break;
      case "crate":
        if (crate && this.watchGoal(crate.id, now, BOTS.goalTimeout.crate, Math.hypot((crate.x0 + crate.x1) / 2 - me.x, (crate.y0 + crate.y1) / 2 - me.y), 430)) {
          this.crate = crate;
          const cx = (crate.x0 + crate.x1) / 2;
          const cy = (crate.y0 + crate.y1) / 2;
          const d = Math.hypot(cx - me.x, cy - me.y);
          // Stop once we have a clear shot (or are in blade reach); otherwise walk up to it.
          const hit = sweepSolids(w.map, me.x, me.y, cx, cy, 0);
          const inReach = gid === "blade" ? d < WEAPONS.blade.reach + me.r : d < 420 && hit?.solid === crate;
          this.goal = inReach ? null : { x: cx, y: cy };
        }
        break;
      case "rotate":
        this.goal = { x: zi.goalX, y: zi.goalY };
        break;
      case "supply":
        if (supply) this.goal = supply;
        break;
      case "investigate":
        if (noise) {
          const d = Math.hypot(noise.x - me.x, noise.y - me.y);
          if (d > BOTS.investigate.stopShort) this.goal = { x: noise.x, y: noise.y };
          else this.stop = true;
        }
        break;
      case "ambush":
        if (this.ambushSpot) {
          if (Math.hypot(this.ambushSpot.x - me.x, this.ambushSpot.y - me.y) > 30) this.goal = this.ambushSpot;
          else this.stop = true;
          holding = true;
        }
        if (now >= this.ambushUntil) this.ambushCd = BOTS.ambush.cooldown;
        break;
      default: {
        this.roamT -= dt;
        if (!this.roam || this.roamT <= 0 || Math.hypot(this.roam.x - me.x, this.roam.y - me.y) < 120 || !zi.safe(this.roam.x, this.roam.y)) {
          this.roam = pickRoam(w, me, zi, this.rng, p.personality === "looter");
          this.roamT = this.rng.range(12, 25);
        }
        this.goal = this.roam;
      }
    }

    // Reflexes: dodge what's flying at us, step out of hazards.
    const dg = dodge(me, threats, p.dodgeSkill, this.rng);
    const hz = avoidHazards(w, me, p.dodgeSkill, p.reaction);
    this.reflexX = this.healing ? 0 : dg.x + hz.x;
    this.reflexY = this.healing ? 0 : dg.y + hz.y;
    if (dg.dash && !this.healing) this.wantDash = true;

    this.planInventory(w, me, target);
    const aim = planThrow({
      w, me, grid, visible, target, now, fleeing: next === "flee", healing: next === "heal", holding, skill: p.throwSkill, rand: () => this.rng.next(),
    });
    if (aim !== null) {
      this.press |= BTN.throw;
      this.throwAim = aim;
    }
    this.planCasts(w, me, visible, target);
  }

  /** Swap to the right gun for the range, pick up better gear, reload when it's safe. */
  private planInventory(w: World, me: Player, target: Contact | null) {
    // F swaps out the gun in hand, so hold the worst one first, then take the new gun.
    if (wantsInteract(w, me)) {
      const worst = worstSlot(me);
      if (worst === me.inv.active || me.inv.weapons.some((g) => !g)) this.press |= BTN.interact;
      else this.press |= worst === 0 ? BTN.slot1 : BTN.slot2;
      return;
    }
    const d = target ? Math.hypot(target.x - me.x, target.y - me.y) : 500;
    const slot = bestSlotFor(me, d);
    if (slot !== null && me.reloadT <= 0 && !me.healKind && me.charge <= 0) this.press |= slot === 0 ? BTN.slot1 : BTN.slot2;
    const gun = activeWeapon(me);
    if (!gun || me.reloadT > 0 || WEAPONS[gun.id].mag <= 0) return;
    const fill = gun.mag / Math.max(1, magSize(gun));
    const quiet = !target?.visible;
    if ((quiet && fill < 0.5) || (this.fight.inCover && fill < 0.75)) this.press |= BTN.reload;
  }

  private planCasts(w: World, me: Player, visible: readonly Contact[], target: Contact | null) {
    if (this.castQueue.length || this.healing) return;
    const past = w.pastState(me, 2.5);
    const z = w.zone;
    const seenPlayers: Player[] = [];
    for (const c of visible) {
      const o = w.players.get(c.id);
      if (o) seenPlayers.push(o);
    }
    const tp = target?.visible ? w.players.get(target.id) ?? null : null;
    const plan = chooseCast(
      {
        w, me, target: tp, visible: seenPlayers, threats: this.threatCount, recentLoss: past ? Math.max(0, past.hp - me.hp) : 0,
        inZoneDanger: z.stage >= 0 && Math.hypot(me.x - z.x, me.y - z.y) > z.r - 60, eagerness: this.profile.castChance * 0.4,
        rand: () => this.rng.next(),
      },
      this.slotAge,
    );
    if (plan) this.castQueue.push(plan);
  }

  /**
   * Tracks how long we've chased the same loot item or crate; past `timeout` seconds it's
   * probably out of reach, so it's ignored for a while. Returns false when giving up.
   */
  private watchGoal(id: number, now: number, timeout: number, dist: number, near: number): boolean {
    if (id !== this.goalKey) {
      this.goalKey = id;
      this.goalSince = now;
      this.goalBest = dist;
      this.goalBestAt = now;
      return true;
    }
    if (dist < this.goalBest - 40) {
      this.goalBest = dist;
      this.goalBestAt = now;
    }
    // Standing within `near` (in pickup or shooting range) counts as getting there.
    const stalled = now - this.goalBestAt > BOTS.goalTimeout.noProgress && dist > near;
    if (now - this.goalSince <= timeout && !stalled) return true;
    this.ignore.set(id, now + BOTS.goalTimeout.ignore);
    this.goalKey = 0;
    if (this.ignore.size > 64) for (const [k, until] of this.ignore) if (until <= now) this.ignore.delete(k);
    return false;
  }
}
