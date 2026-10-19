// The bot brain: perceive (10 Hz) → score actions (fight, cover, dodge, zone, pickup)
// → steer, aim with human-like error and reaction delay, and use powers by their hints.

import {
  BOTS, BTN, NET, powerDef, Rng, SHOT, ultDef,
  type Difficulty, type InputFrame, type Player, type PowerId, type Projectile, type UltId, type World,
} from "@prism/shared";

type Mode = "fight" | "cover" | "zone" | "pickup" | "roam";

interface Threat {
  pr: Projectile;
  t: number;
}

export class SmartBrain {
  private rng: Rng;
  private cfg: (typeof BOTS.difficulty)[Difficulty];
  private seq = 0;
  private thinkT = 0;
  private mode: Mode = "roam";
  private target: Player | null = null;
  private moveX = 0;
  private moveY = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private aimErr = 0;
  /** Where we believe the target is (lags by reaction time). */
  private seen: { x: number; y: number; vx: number; vy: number; at: number } | null = null;
  private wantDash = false;
  private castQueue: number[] = [];
  private roamX = 0;
  private roamY = 0;
  private stuckT = 0;
  private lastPos = { x: 0, y: 0 };

  constructor(difficulty: Difficulty, seed: number) {
    this.rng = new Rng(seed);
    this.cfg = BOTS.difficulty[difficulty];
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
    const dt = w.dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 1 / BOTS.thinkHz;
      this.perceive(w, me);
    }
    this.updateSeen(w);
    let pressed = 0;
    let buttons = 0;

    // Aim: lead the remembered position by the shot's travel time, plus error.
    let aim = me.aim;
    if (this.target && this.seen) {
      const d = Math.hypot(this.seen.x - me.x, this.seen.y - me.y);
      const tt = d / SHOT.speed;
      const lead = this.cfg.dodgeSkill > 0.6 ? 0.85 : 0.5;
      const ax = this.seen.x + this.seen.vx * tt * lead;
      const ay = this.seen.y + this.seen.vy * tt * lead;
      aim = Math.atan2(ay - me.y, ax - me.x) + this.aimErr;
      const los = !w.blocked(me.x, me.y, this.seen.x, this.seen.y);
      if (los && d < 820 && this.mode !== "zone") {
        // Fire in bursts, keep 1 ammo back unless the target is low.
        if (me.ammo > 1 || this.target.hp < 30) buttons |= BTN.shoot;
      }
    }

    if (this.wantDash && me.dashCd <= 0) {
      pressed |= BTN.dash;
      buttons |= BTN.dash;
      this.wantDash = false;
    }
    const cast = this.castQueue.shift();
    if (cast !== undefined) {
      const btn = cast === 0 ? BTN.p1 : cast === 1 ? BTN.p2 : cast === 2 ? BTN.p3 : BTN.ult;
      pressed |= btn;
      buttons |= btn;
    }
    return { seq: ++this.seq, mx: this.moveX, my: this.moveY, aim, buttons, pressed, dt, shotId: 0 };
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
      this.aimErr = ((this.rng.next() * 2 - 1) * this.cfg.aimErrorDeg * Math.PI) / 180;
    } else {
      // Dead-reckon between updates.
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
      if (w.hiddenFrom(me, o)) continue;
      if ((o.status.cloaked ?? 0) > 0 && Math.hypot(o.x - me.x, o.y - me.y) > 160) continue;
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      const score = d + o.hp * 3 - (o.id === this.target?.id ? 120 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    this.target = best;

    // Threats: projectiles that will pass near us soon.
    const threats: Threat[] = [];
    for (const pr of w.projectiles) {
      if (pr.owner === me.id || pr.dead) continue;
      const rx = me.x - pr.x;
      const ry = me.y - pr.y;
      const vv = pr.vx * pr.vx + pr.vy * pr.vy || 1;
      const t = (rx * pr.vx + ry * pr.vy) / vv;
      if (t < 0 || t > 0.6) continue;
      const cx = pr.x + pr.vx * t - me.x;
      const cy = pr.y + pr.vy * t - me.y;
      if (cx * cx + cy * cy < (me.r + pr.r + 18) ** 2) threats.push({ pr, t });
    }

    const z = w.zone;
    const dz = Math.hypot(me.x - z.x, me.y - z.y);
    const zoneDanger = z.stage >= 0 && dz > z.r - 140;
    const nextZoneDanger = z.phase === "warn" && Math.hypot(me.x - z.toX, me.y - z.toY) > z.toR - 100;

    // Pick a mode.
    if (zoneDanger || nextZoneDanger) this.mode = "zone";
    else if (me.hp < 40 && this.target && this.rng.next() < 0.7) this.mode = "cover";
    else if (this.target) this.mode = "fight";
    else if (w.pickups.size > 0) this.mode = "pickup";
    else this.mode = "roam";

    let mx = 0;
    let my = 0;
    const toward = (x: number, y: number, k = 1) => {
      const dx = x - me.x;
      const dy = y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      mx += (dx / d) * k;
      my += (dy / d) * k;
    };

    if (this.mode === "zone") {
      toward(z.phase === "warn" ? z.toX : z.x, z.phase === "warn" ? z.toY : z.y, 1.4);
    } else if (this.mode === "cover" && this.target) {
      const cover = this.findCover(w, me, this.target);
      if (cover) toward(cover.x, cover.y, 1.2);
      else toward(me.x - (this.target.x - me.x), me.y - (this.target.y - me.y), 1);
    } else if (this.mode === "fight" && this.target) {
      const t = this.target;
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      const want = this.cfg.preferredRange;
      if (d > want + 80) toward(t.x, t.y, 1);
      else if (d < want - 100) toward(me.x - (t.x - me.x), me.y - (t.y - me.y), 0.9);
      // Strafe perpendicular, switching direction now and then (harder to hit).
      this.strafeT -= 1 / BOTS.thinkHz;
      if (this.strafeT <= 0) {
        this.strafeDir *= -1;
        this.strafeT = this.rng.range(0.5, 1.4);
      }
      const ang = Math.atan2(t.y - me.y, t.x - me.x) + (Math.PI / 2) * this.strafeDir;
      mx += Math.cos(ang) * 0.8;
      my += Math.sin(ang) * 0.8;
      // Grab a nearby pickup mid-fight if it's close.
      for (const pk of w.pickups.values()) if (Math.hypot(pk.x - me.x, pk.y - me.y) < 220) toward(pk.x, pk.y, 0.6);
    } else if (this.mode === "pickup") {
      let near: { x: number; y: number } | null = null;
      let nd = Infinity;
      for (const pk of w.pickups.values()) {
        const d = Math.hypot(pk.x - me.x, pk.y - me.y);
        if (d < nd) {
          nd = d;
          near = pk;
        }
      }
      if (near) toward(near.x, near.y);
    } else {
      if (Math.hypot(this.roamX - me.x, this.roamY - me.y) < 120 || this.rng.next() < 0.02) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(0, Math.min(z.r, w.arena.radius) * 0.6);
        this.roamX = z.x + Math.cos(a) * r;
        this.roamY = z.y + Math.sin(a) * r;
      }
      toward(this.roamX, this.roamY);
    }

    // Dodge: step sideways from the most urgent projectile, dash if it's about to hit.
    const urgent = threats.sort((a, b) => a.t - b.t)[0];
    if (urgent && this.rng.next() < this.cfg.dodgeSkill) {
      const pv = Math.hypot(urgent.pr.vx, urgent.pr.vy) || 1;
      let px = -urgent.pr.vy / pv;
      let py = urgent.pr.vx / pv;
      if (px * (me.x - urgent.pr.x) + py * (me.y - urgent.pr.y) < 0) {
        px = -px;
        py = -py;
      }
      mx += px * 1.6;
      my += py * 1.6;
      if (urgent.t < 0.22 && me.dashCd <= 0 && this.rng.next() < this.cfg.dodgeSkill * 0.7) this.wantDash = true;
    }

    // Avoid walls and pillars.
    for (const p of w.arena.pillars) {
      if (p.dead) continue;
      const dx = me.x - p.x;
      const dy = me.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < p.r + 70) {
        mx += (dx / (d || 1)) * 0.7;
        my += (dy / (d || 1)) * 0.7;
      }
    }
    for (const wl of w.arena.walls) {
      const d = (me.x - wl.ax) * wl.nx + (me.y - wl.ay) * wl.ny;
      if (d < 110) {
        mx += wl.nx * 0.9;
        my += wl.ny * 0.9;
      }
    }
    // Hazards: get out of lava and slow fields (if not our own).
    for (const e of w.effects.values()) {
      if ((e.kind === "lava" || e.kind === "molten" || e.kind === "slowField" || e.kind === "meteorWarn") && e.owner !== me.id) {
        const dx = me.x - e.x;
        const dy = me.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d < e.r + 40) {
          mx += (dx / (d || 1)) * 1.5;
          my += (dy / (d || 1)) * 1.5;
        }
      }
    }

    // Unstick
    if (Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y) < 4 && Math.hypot(mx, my) > 0.3) {
      this.stuckT += 1 / BOTS.thinkHz;
      if (this.stuckT > 0.6) {
        const a = this.rng.range(0, Math.PI * 2);
        mx = Math.cos(a);
        my = Math.sin(a);
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
    this.lastPos = { x: me.x, y: me.y };

    const l = Math.hypot(mx, my);
    this.moveX = l > 0.05 ? mx / Math.max(1, l) : 0;
    this.moveY = l > 0.05 ? my / Math.max(1, l) : 0;
    if (l > 0.05 && l < 1) {
      this.moveX = mx / l;
      this.moveY = my / l;
    }

    this.planCasts(w, me);
  }

  private findCover(w: World, me: Player, threat: Player): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const p of w.arena.pillars) {
      if (p.dead) continue;
      const dx = p.x - threat.x;
      const dy = p.y - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      const cx = p.x + (dx / d) * (p.r + me.r + 20);
      const cy = p.y + (dy / d) * (p.r + me.r + 20);
      const dm = Math.hypot(cx - me.x, cy - me.y);
      if (dm < bd && dm < 700) {
        bd = dm;
        best = { x: cx, y: cy };
      }
    }
    return best;
  }

  private planCasts(w: World, me: Player) {
    if (this.castQueue.length) return;
    if (this.rng.next() > this.cfg.castChance * 0.35) return;
    const t = this.target;
    const dist = t ? Math.hypot(t.x - me.x, t.y - me.y) : Infinity;
    for (let i = 0; i < me.slots.length; i++) {
      const s = me.slots[i];
      if (!s) continue;
      const def = powerDef(s.id);
      if (!def) continue;
      if (s.recast > 0) {
        if (this.rng.next() < 0.25) this.castQueue.push(i);
        continue;
      }
      if (s.cd > 0) continue;
      const hint = def.bot;
      const ok =
        (hint.role === "attack" && t && dist < (hint.range ?? 600) && !w.blocked(me.x, me.y, t.x, t.y)) ||
        (hint.role === "defend" && me.hp < (hint.hpBelow ?? 45)) ||
        (hint.role === "mobility" && (this.mode === "zone" || this.mode === "cover" || (t && dist < 260))) ||
        (hint.role === "buff" && t && dist < 650) ||
        (hint.role === "zone" && t && dist < 450);
      if (ok) {
        this.castQueue.push(i);
        return;
      }
    }
    if (me.ult && me.ult.charge >= 100) {
      const def = ultDef(me.ult.id);
      const near = w.enemiesOf(me).filter((o) => Math.hypot(o.x - me.x, o.y - me.y) < 600).length;
      if (def && (near >= def.bot.minTargets || (def.bot.hpBelow !== undefined && me.hp < def.bot.hpBelow) || (t && t.hp < 35 && dist < 500))) this.castQueue.push(3);
    }
  }
}
