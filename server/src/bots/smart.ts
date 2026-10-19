// The bot brain: perceive (10 Hz) → pick a mode (zone, heal, fight, loot, crate, roam)
// → steer around terrain, aim with human-like error and reaction delay, fire the gun in
// hand the way it wants to be fired, loot better gear, heal, and use powers by their hints.
// Layout: steering.ts (local obstacle avoidance), looting.ts (what to pick up, which gun
// for the range, when to heal), tactics.ts (power and ultimate casts).

import {
  activeWeapon, BOTS, BTN, magSize, NET, powerDef, Rng, sweepSolids, WEAPONS,
  type Difficulty, type InputFrame, type Player, type PowerId, type Projectile, type Solid, type UltId, type World,
} from "@prism/shared";
import { bestSlotFor, pickLoot, shouldHeal, wantsInteract, weaponRange, worstSlot } from "./looting";
import { Steering } from "./steering";
import { chooseCast } from "./tactics";

type Mode = "fight" | "cover" | "zone" | "heal" | "loot" | "crate" | "roam";

interface Threat {
  pr: Projectile;
  t: number;
}

export class SmartBrain {
  private rng: Rng;
  private cfg: (typeof BOTS.difficulty)[Difficulty];
  private seq = 0;
  private thinkT = 0;
  mode: Mode = "roam";
  private target: Player | null = null;
  private moveX = 0;
  private moveY = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private aimErr = 0;
  /** Where we believe the target is (lags by reaction time). */
  private seen: { x: number; y: number; vx: number; vy: number; at: number } | null = null;
  private wantDash = false;
  private castQueue: { slot: number; aim: number | null }[] = [];
  /** One-shot button presses decided while perceiving (interact, swap, reload, throw). */
  private press = 0;
  private throwAim: number | null = null;
  private healing = false;
  private crate: Solid | null = null;
  private chargeGoal = 0.85;
  /** Seconds since each slot started its recast window (for recast timing). */
  private slotAge = [0, 0];
  private threatCount = 0;
  private myId = 0;
  private roamX = 0;
  private roamY = 0;
  private steering: Steering;

  constructor(difficulty: Difficulty, seed: number) {
    this.rng = new Rng(seed);
    this.cfg = BOTS.difficulty[difficulty];
    this.steering = new Steering(this.rng);
  }

  pickUlt(options: readonly UltId[]): number {
    return this.rng.int(Math.max(1, options.length));
  }

  pickPower(options: readonly PowerId[], held: readonly (PowerId | null)[]): number {
    // Prefer an attack power if we hold none, otherwise anything (slight random taste).
    let best = 0;
    let bestScore = -1;
    const hasAttack = held.some((h) => h && powerDef(h)?.bot.role === "attack");
    options.forEach((o, i) => {
      const role = powerDef(o)?.bot.role;
      const s = this.rng.next() + (!hasAttack && role === "attack" ? 0.8 : 0) + (role === "defend" ? 0.2 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return best;
  }

  think(w: World, me: Player): InputFrame {
    this.myId = me.id;
    const dt = w.dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 1 / BOTS.thinkHz;
      this.perceive(w, me);
    }
    this.updateSeen(w);
    let pressed = this.press;
    let buttons = this.press;
    this.press = 0;
    let aim = me.aim;
    const gun = activeWeapon(me);
    const def = gun ? WEAPONS[gun.id] : WEAPONS.pistol;

    if (this.target && this.seen) {
      const d = Math.hypot(this.seen.x - me.x, this.seen.y - me.y);
      const speed = def.kind === "lance" ? 0 : def.speed;
      const tt = speed > 0 ? d / speed : 0;
      const lead = this.cfg.dodgeSkill > 0.6 ? 0.85 : 0.5;
      aim = Math.atan2(this.seen.y + this.seen.vy * tt * lead - me.y, this.seen.x + this.seen.vx * tt * lead - me.x) + this.aimErr;
      const clear = !w.blocked(me.x, me.y, this.seen.x, this.seen.y);
      if (clear && !this.healing && d < weaponRange(gun?.id ?? "pistol") * 1.2) buttons |= this.trigger(me, d);
    } else if (this.crate && !this.healing) {
      const c = this.crate;
      const cx = (c.x0 + c.x1) / 2;
      const cy = (c.y0 + c.y1) / 2;
      aim = Math.atan2(cy - me.y, cx - me.x);
      const hit = sweepSolids(w.map, me.x, me.y, cx, cy, 0);
      if (!c.dead && hit?.solid === c && Math.hypot(cx - me.x, cy - me.y) < 420) buttons |= this.trigger(me, 0);
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
      // Aimed casts use the tactic's lead aim plus this difficulty's error.
      if (cast.aim !== null) aim = cast.aim + ((this.rng.next() * 2 - 1) * this.cfg.aimErrorDeg * 0.8 * Math.PI) / 180;
    }
    for (let i = 0; i < 2; i++) {
      const s = me.slots[i];
      this.slotAge[i] = s && s.recast > 0 ? (this.slotAge[i] ?? 0) + dt : 0;
    }
    return { seq: ++this.seq, mx: this.moveX, my: this.moveY, aim, buttons, pressed, dt, shotId: 0 };
  }

  /** The trigger bits for the gun in hand: hold for guns, charge-and-release the lance, swing the blade up close. */
  private trigger(me: Player, d: number): number {
    const gun = activeWeapon(me);
    if (!gun) return 0;
    const def = WEAPONS[gun.id];
    if (def.kind === "lance") {
      if (me.charge >= this.chargeGoal) {
        this.chargeGoal = this.rng.range(0.6, 1);
        return 0;
      }
      return BTN.shoot;
    }
    if (def.kind === "blade") return d < def.reach + me.r + 20 ? BTN.shoot : 0;
    return BTN.shoot;
  }

  private updateSeen(w: World) {
    const t = this.target;
    if (!t || !t.alive) {
      this.seen = null;
      return;
    }
    // Reaction delay: only "notice" the target's new movement every reaction interval.
    const now = w.time;
    if (!this.seen || now - this.seen.at >= this.cfg.reaction) {
      this.seen = { x: t.x, y: t.y, vx: t.vx + t.px, vy: t.vy + t.py, at: now };
      const blind = (w.players.get(this.myId)?.status.blinded ?? 0) > 0 ? 4 : 1;
      this.aimErr = ((this.rng.next() * 2 - 1) * this.cfg.aimErrorDeg * blind * Math.PI) / 180;
    } else {
      const k = 1 / NET.tickRate;
      this.seen.x += this.seen.vx * k;
      this.seen.y += this.seen.vy * k;
    }
  }

  private perceive(w: World, me: Player) {
    // Target: nearest visible enemy, preferring weak ones.
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const o of w.enemiesOf(me)) {
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      if (d > 1600 || !w.visibleTo(me, o)) continue;
      if ((o.status.cloaked ?? 0) > 0 && d > 160) continue;
      const score = d + o.hp * 3 - (o.id === this.target?.id ? 140 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    this.target = best;
    const t = this.target;
    const dT = t ? Math.hypot(t.x - me.x, t.y - me.y) : Infinity;

    const threats: Threat[] = [];
    for (const pr of w.projectiles) {
      if (pr.owner === me.id || pr.dead) continue;
      const rx = me.x - pr.x;
      const ry = me.y - pr.y;
      const vv = pr.vx * pr.vx + pr.vy * pr.vy || 1;
      const tt = (rx * pr.vx + ry * pr.vy) / vv;
      if (tt < 0 || tt > 0.6) continue;
      const cx = pr.x + pr.vx * tt - me.x;
      const cy = pr.y + pr.vy * tt - me.y;
      if (cx * cx + cy * cy < (me.r + pr.r + 18) ** 2) threats.push({ pr, t: tt });
    }
    this.threatCount = threats.length;
    const z = w.zone;
    const outside = z.stage >= 0 && Math.hypot(me.x - z.x, me.y - z.y) > z.r - 140;
    const nextOutside = (z.phase === "warn" || z.phase === "shrink") && Math.hypot(me.x - z.toX, me.y - z.toY) > z.toR - 120;
    const threatened = (!!t && dT < 900) || me.sinceDamage < 1.5 || threats.length > 0;
    this.healing = !outside && shouldHeal(me, threatened);
    const loot = this.healing ? null : pickLoot(w, me);

    if (outside || (nextOutside && !t)) this.mode = "zone";
    else if (this.healing) this.mode = "heal";
    else if (me.hp < 35 && t && this.rng.next() < 0.6) this.mode = "cover";
    else if (t) this.mode = "fight";
    else if (loot) this.mode = "loot";
    else if ((this.crate = this.nearCrate(w, me))) this.mode = "crate";
    else this.mode = "roam";
    if (this.mode !== "crate") this.crate = null;

    let mx = 0;
    let my = 0;
    const toward = (x: number, y: number, k = 1) => {
      const dx = x - me.x;
      const dy = y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      mx += (dx / d) * k;
      my += (dy / d) * k;
    };

    if (this.mode === "zone") toward(nextOutside ? z.toX : z.x, nextOutside ? z.toY : z.y, 1.4);
    else if (this.mode === "heal") {
      // Shuffle slowly away from the last attacker while the channel runs.
      const a = w.players.get(me.lastHitBy);
      if (a?.alive) toward(me.x - (a.x - me.x), me.y - (a.y - me.y), 0.4);
    } else if (this.mode === "cover" && t) {
      const cover = this.findCover(w, me, t);
      if (cover) toward(cover.x, cover.y, 1.2);
      else toward(me.x - (t.x - me.x), me.y - (t.y - me.y), 1);
    } else if (this.mode === "fight" && t) {
      const gun = activeWeapon(me);
      const want = weaponRange(gun?.id ?? "pistol") * this.cfg.rangeMult;
      if (dT > want + 60) toward(t.x, t.y, 1);
      else if (dT < want * 0.55) toward(me.x - (t.x - me.x), me.y - (t.y - me.y), 0.9);
      this.strafeT -= 1 / BOTS.thinkHz;
      if (this.strafeT <= 0) {
        this.strafeDir *= -1;
        this.strafeT = this.rng.range(0.5, 1.4);
      }
      const ang = Math.atan2(t.y - me.y, t.x - me.x) + (Math.PI / 2) * this.strafeDir;
      mx += Math.cos(ang) * 0.8;
      my += Math.sin(ang) * 0.8;
      // Grab good loot that's right here mid-fight.
      if (loot && Math.hypot(loot.x - me.x, loot.y - me.y) < 200) toward(loot.x, loot.y, 0.6);
      this.planThrow(w, me, t, dT);
    } else if (this.mode === "loot" && loot) toward(loot.x, loot.y);
    else if (this.mode === "crate" && this.crate) {
      const c = this.crate;
      const cx = (c.x0 + c.x1) / 2;
      const cy = (c.y0 + c.y1) / 2;
      if (Math.hypot(cx - me.x, cy - me.y) > 260) toward(cx, cy);
    } else {
      if (Math.hypot(this.roamX - me.x, this.roamY - me.y) < 160 || this.rng.next() < 0.015) this.pickRoam(w);
      toward(this.roamX, this.roamY);
    }

    this.planInventory(w, me, dT);
    const dodge = this.dodge(me, threats);
    mx += dodge.x;
    my += dodge.y;
    const hz = this.hazards(w, me);
    mx += hz.x;
    my += hz.y;
    const l = Math.hypot(mx, my);
    const s = this.steering.steer(w, me, l > 1 ? mx / l : mx, l > 1 ? my / l : my, 1 / BOTS.thinkHz);
    const sl = Math.hypot(s.x, s.y);
    this.moveX = sl > 0.05 ? s.x / Math.max(sl, this.mode === "heal" ? 2 : 1) : 0;
    this.moveY = sl > 0.05 ? s.y / Math.max(sl, this.mode === "heal" ? 2 : 1) : 0;
    this.planCasts(w, me);
  }

  /** Swap to the right gun for the range, pick up better gear, reload when quiet. */
  private planInventory(w: World, me: Player, dT: number) {
    // F swaps out the gun in hand, so hold the worst one first, then take the new gun.
    if (wantsInteract(w, me)) {
      const worst = worstSlot(me);
      if (worst === me.inv.active || me.inv.weapons.some((g) => !g)) this.press |= BTN.interact;
      else this.press |= worst === 0 ? BTN.slot1 : BTN.slot2;
      return;
    }
    const slot = bestSlotFor(me, Number.isFinite(dT) ? dT : 500);
    if (slot !== null && me.reloadT <= 0 && !me.healKind) this.press |= slot === 0 ? BTN.slot1 : BTN.slot2;
    const gun = activeWeapon(me);
    if (gun && !this.target && me.reloadT <= 0 && WEAPONS[gun.id].mag > 0 && gun.mag < magSize(gun) * 0.5) this.press |= BTN.reload;
  }

  private planThrow(w: World, me: Player, t: Player, d: number) {
    if (!me.inv.throwable || me.inv.throws <= 0 || me.throwCd > 0) return;
    const smoke = me.inv.throwable === "smoke";
    const ok = smoke ? me.hp < 45 && d < 700 : d > 220 && d < 620 && !w.blocked(me.x, me.y, t.x, t.y);
    if (!ok || this.rng.next() > 0.12 * this.cfg.castChance + 0.03) return;
    this.press |= BTN.throw;
    this.throwAim = Math.atan2(t.y - me.y, t.x - me.x);
  }

  private dodge(me: Player, threats: Threat[]): { x: number; y: number } {
    const urgent = threats.sort((a, b) => a.t - b.t)[0];
    if (!urgent || this.rng.next() >= this.cfg.dodgeSkill) return { x: 0, y: 0 };
    const pv = Math.hypot(urgent.pr.vx, urgent.pr.vy) || 1;
    let px = -urgent.pr.vy / pv;
    let py = urgent.pr.vx / pv;
    if (px * (me.x - urgent.pr.x) + py * (me.y - urgent.pr.y) < 0) {
      px = -px;
      py = -py;
    }
    if (urgent.t < 0.22 && me.dashCd <= 0 && this.rng.next() < this.cfg.dodgeSkill * 0.7) this.wantDash = true;
    return { x: px * 1.6, y: py * 1.6 };
  }

  /** Get out of lava, black holes, rifts and warning circles (if not our own). */
  private hazards(w: World, me: Player): { x: number; y: number } {
    let mx = 0;
    let my = 0;
    for (const e of w.effects.values()) {
      if (e.owner === me.id) continue;
      if (e.kind === "rift" || (e.kind === "singularity" && Math.hypot(me.x - e.x, me.y - e.y) < e.r)) {
        if (e.age < this.cfg.reaction + 0.3) continue;
        let hx = e.x;
        let hy = e.y;
        if (e.kind === "rift") {
          const dx = e.x2 - e.x;
          const dy = e.y2 - e.y;
          const l2 = dx * dx + dy * dy || 1;
          const k = Math.max(0, Math.min(1, ((me.x - e.x) * dx + (me.y - e.y) * dy) / l2));
          hx = e.x + dx * k;
          hy = e.y + dy * k;
          if (Math.hypot(me.x - hx, me.y - hy) > 320) continue;
        }
        const d = Math.hypot(me.x - hx, me.y - hy) || 1;
        mx += ((me.x - hx) / d) * 2.2 * this.cfg.dodgeSkill;
        my += ((me.y - hy) / d) * 2.2 * this.cfg.dodgeSkill;
        continue;
      }
      if (e.kind === "lava" || e.kind === "molten" || e.kind === "slowField" || e.kind === "meteorWarn" || (e.kind === "shockwave" && e.n === 0) || e.kind === "bubble" || e.kind === "mine") {
        const dx = me.x - e.x;
        const dy = me.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d < e.r + 40) {
          mx += (dx / (d || 1)) * 1.5;
          my += (dy / (d || 1)) * 1.5;
        }
      }
    }
    return { x: mx, y: my };
  }

  /** A random reachable point inside the zone (or the next one). */
  private pickRoam(w: World) {
    const z = w.zone;
    const cx = z.phase === "warn" || z.phase === "shrink" ? z.toX : z.x;
    const cy = z.phase === "warn" || z.phase === "shrink" ? z.toY : z.y;
    const r = Math.min(z.phase === "warn" || z.phase === "shrink" ? z.toR : z.r, w.map.half) * 0.7;
    for (let i = 0; i < 10; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = r * Math.sqrt(this.rng.next());
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      if (w.insideArena(x, y, 40)) {
        this.roamX = x;
        this.roamY = y;
        return;
      }
    }
    this.roamX = cx;
    this.roamY = cy;
  }

  /** The nearest unbroken crate worth shooting open. */
  private nearCrate(w: World, me: Player): Solid | null {
    let best: Solid | null = null;
    let bd = 520;
    w.map.grid.query(me.x - bd, me.y - bd, me.x + bd, me.y + bd, (i) => {
      const s = w.map.solids[i];
      if (!s || s.dead || s.kind !== "crate") return;
      const d = Math.hypot((s.x0 + s.x1) / 2 - me.x, (s.y0 + s.y1) / 2 - me.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    });
    return best;
  }

  /** A spot behind the nearest sight-blocking solid, away from the threat. */
  private findCover(w: World, me: Player, threat: Player): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bd = 700;
    w.map.grid.query(me.x - 700, me.y - 700, me.x + 700, me.y + 700, (i) => {
      const s = w.map.solids[i];
      if (!s || s.dead || !s.vision) return;
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      const dx = cx - threat.x;
      const dy = cy - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / 2 + me.r + 24;
      const px = cx + (dx / d) * reach;
      const py = cy + (dy / d) * reach;
      const dm = Math.hypot(px - me.x, py - me.y);
      if (dm < bd && w.insideArena(px, py, me.r)) {
        bd = dm;
        best = { x: px, y: py };
      }
    });
    return best;
  }

  private planCasts(w: World, me: Player) {
    if (this.castQueue.length || this.healing) return;
    const past = w.pastState(me, 2.5);
    const z = w.zone;
    const plan = chooseCast(
      {
        w, me, target: this.target, threats: this.threatCount, recentLoss: past ? Math.max(0, past.hp - me.hp) : 0,
        inZoneDanger: z.stage >= 0 && Math.hypot(me.x - z.x, me.y - z.y) > z.r - 60, eagerness: this.cfg.castChance * 0.4,
        rand: () => this.rng.next(),
      },
      this.slotAge,
    );
    if (plan) this.castQueue.push(plan);
  }
}
