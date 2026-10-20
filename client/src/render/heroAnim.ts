// Turns networked / predicted fighter state into chibi animation progress values. Remote
// fighters only send flags (reloading, healing, dashing, swinging) and events (shoot, hit,
// slash, throw, heal, reload, kill), so this remembers when each started; the local player
// reads its own predicted timers directly so its animations never lag behind input.
// It also keeps a short-lived "corpse" per elimination so the death pop plays out after the
// fighter has left the alive list.

import { CHIBI_TIMING, idleAnim, type ChibiAnim } from "./chibi";
import { ITEMS, PLAYER, WEAPONS, type GameEvent, type HealKind, type Player, type WeaponId } from "@prism/shared";

interface Track {
  x: number;
  y: number;
  walk: number;
  seen: number;
  aim: number;
  weapon: WeaponId | null;
  rarity: number;
  shotAt: number;
  hitAt: number;
  slashAt: number;
  slashSide: number;
  throwAt: number;
  reloadAt: number;
  healAt: number;
  healKind: HealKind;
  dashAt: number;
  dashAngle: number;
  spawnAt: number;
  wasReloading: boolean;
  wasHealing: boolean;
  wasDashing: boolean;
}

export interface Corpse {
  id: number;
  x: number;
  y: number;
  aim: number;
  weapon: WeaponId | null;
  rarity: number;
  at: number;
}

/** What a remote fighter's flags say this frame. */
export interface RemoteActs {
  vx: number;
  vy: number;
  reloading: boolean;
  healing: boolean;
  dashing: boolean;
  charge: number;
  cloak: number;
}

/** Seconds after the match view starts during which a first sighting plays the drop-in. */
const SPAWN_WINDOW = 2.5;
const SPAWN_STAGGER = 0.45;
const TELEPORT = 220;

const prog = (now: number, at: number, dur: number) => (at > 0 && dur > 0 ? (now - at) / 1000 / dur : -1);
const live = (t: number) => (t >= 0 && t < 1 ? t : -1);

export class HeroAnimator {
  private tracks = new Map<number, Track>();
  private matchStart = 0;
  readonly corpses: Corpse[] = [];

  /** A new match view: forget everyone (the next sightings play the drop-in). */
  reset(now: number) {
    this.tracks.clear();
    this.corpses.length = 0;
    this.matchStart = now;
  }

  private track(id: number, x: number, y: number, now: number): Track {
    let t = this.tracks.get(id);
    if (!t) {
      const fresh = (now - this.matchStart) / 1000 < SPAWN_WINDOW;
      const stagger = (((id * 0.6180339) % 1) + 1) % 1;
      t = {
        x, y, walk: (id % 7) * 0.9, seen: now, aim: 0, weapon: null, rarity: 0, shotAt: 0, hitAt: 0, slashAt: 0, slashSide: 1, throwAt: 0, reloadAt: 0, healAt: 0,
        healKind: "bandage", dashAt: 0, dashAngle: 0, spawnAt: fresh ? now + stagger * SPAWN_STAGGER * 1000 : 0, wasReloading: false, wasHealing: false, wasDashing: false,
      };
      this.tracks.set(id, t);
    }
    return t;
  }

  onEvent(e: GameEvent, now: number) {
    switch (e.t) {
      case "shoot": {
        const t = this.tracks.get(e.by);
        if (t) {
          t.shotAt = now;
          if (e.weapon !== "blade") t.aim = e.angle;
        }
        break;
      }
      case "slash": {
        const t = this.tracks.get(e.by);
        if (t) {
          t.slashAt = now;
          t.slashSide = -t.slashSide;
        }
        break;
      }
      case "hit":
        if (e.amount > 0) {
          const t = this.tracks.get(e.target);
          if (t) t.hitAt = now;
        }
        break;
      case "throw": {
        const t = this.tracks.get(e.by);
        if (t) t.throwAt = now;
        break;
      }
      case "reload": {
        const t = this.tracks.get(e.by);
        if (t) t.reloadAt = now;
        break;
      }
      case "heal": {
        const t = this.tracks.get(e.by);
        if (t && !e.done && e.item !== "shield") {
          t.healKind = e.item;
          t.healAt = now;
        }
        break;
      }
      case "kill": {
        const t = this.tracks.get(e.victim);
        this.corpses.push({ id: e.victim, x: e.x, y: e.y, aim: t?.aim ?? 0, weapon: t?.weapon ?? null, rarity: t?.rarity ?? 0, at: now });
        if (this.corpses.length > 16) this.corpses.shift();
        this.tracks.delete(e.victim);
        break;
      }
      default:
        break;
    }
  }

  /** Corpses whose death pop is still playing (drops finished ones). */
  dying(now: number): Corpse[] {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (c && (now - c.at) / 1000 >= CHIBI_TIMING.death) this.corpses.splice(i, 1);
    }
    return this.corpses;
  }

  deathT(c: Corpse, now: number): number {
    return Math.max(0.0001, (now - c.at) / 1000 / CHIBI_TIMING.death);
  }

  isDying(id: number): boolean {
    return this.corpses.some((c) => c.id === id);
  }

  /** Walk phase, recoil, hit and drop-in shared by every fighter. */
  private base(t: Track, x: number, y: number, aim: number, weapon: WeaponId | null, rarity: number, speed: number, now: number): ChibiAnim {
    const d = Math.hypot(x - t.x, y - t.y);
    if (d < TELEPORT) t.walk += d * CHIBI_TIMING.stridePerUnit;
    t.x = x;
    t.y = y;
    t.seen = now;
    t.aim = aim;
    t.weapon = weapon;
    t.rarity = rarity;
    const a = idleAnim();
    a.walkPhase = t.walk;
    a.speed = speed;
    a.recoilT = weapon && weapon !== "blade" ? live(prog(now, t.shotAt, CHIBI_TIMING.recoil[weapon])) : -1;
    a.hitT = live(prog(now, t.hitAt, CHIBI_TIMING.hit));
    a.throwT = live(prog(now, t.throwAt, CHIBI_TIMING.throw));
    if (t.spawnAt > 0) {
      const s = prog(now, t.spawnAt, CHIBI_TIMING.spawn);
      if (s >= 1) t.spawnAt = 0;
      a.spawnT = s < 0 ? 0 : live(s);
    }
    return a;
  }

  /** The local player, from its predicted state (timers count down in the shared sim). */
  self(id: number, me: Player, x: number, y: number, cloak: number, now: number): ChibiAnim {
    const t = this.track(id, x, y, now);
    const gun = me.inv.weapons[me.inv.active] ?? null;
    const w = gun?.id ?? null;
    const a = this.base(t, x, y, me.aim, w, gun?.rarity ?? 0, Math.hypot(me.vx, me.vy), now);
    if (w && me.reloadT > 0) a.reloadT = live(1 - me.reloadT / Math.max(0.05, WEAPONS[w].reload));
    if (me.healKind) {
      a.healT = live(1 - me.healT / ITEMS[me.healKind].time);
      a.healKind = me.healKind;
    }
    if (me.throwCd > 0) a.throwT = live((ITEMS.throwCd - me.throwCd) / CHIBI_TIMING.throw);
    if (w === "blade" && me.swingT > 0) {
      const sw = WEAPONS.blade.swingTime;
      a.slashT = live(1 - me.swingT / sw);
      if (me.swingT >= sw - 0.02 && now - t.slashAt > 100) {
        t.slashAt = now;
        t.slashSide = -t.slashSide;
      }
      a.slashSide = t.slashSide;
    }
    if (me.dashT > 0) {
      a.dashT = live(1 - me.dashT / PLAYER.dash.duration);
      a.dashAngle = Math.atan2(me.dashY, me.dashX);
    }
    a.cloak = cloak;
    a.charge = me.charge;
    return a;
  }

  /** A remote fighter (or a lookalike) from interpolated state, flags and remembered events. */
  remote(id: number, x: number, y: number, aim: number, weapon: WeaponId | null, rarity: number, r: RemoteActs, now: number): ChibiAnim {
    const t = this.track(id, x, y, now);
    const a = this.base(t, x, y, aim, weapon, rarity, Math.hypot(r.vx, r.vy), now);
    if (r.reloading && !t.wasReloading && now - t.reloadAt > 300) t.reloadAt = now;
    t.wasReloading = r.reloading;
    if (r.reloading && weapon) a.reloadT = Math.min(0.97, Math.max(0, prog(now, t.reloadAt, WEAPONS[weapon].reload)));
    if (r.healing && !t.wasHealing && now - t.healAt > 300) t.healAt = now;
    t.wasHealing = r.healing;
    if (r.healing) {
      a.healT = Math.min(0.97, Math.max(0, prog(now, t.healAt, ITEMS[t.healKind].time)));
      a.healKind = t.healKind;
    }
    if (r.dashing && !t.wasDashing) {
      t.dashAt = now;
      t.dashAngle = Math.hypot(r.vx, r.vy) > 1 ? Math.atan2(r.vy, r.vx) : aim;
    }
    t.wasDashing = r.dashing;
    const dash = live(prog(now, t.dashAt, Math.max(PLAYER.dash.duration, CHIBI_TIMING.dash)));
    if (dash >= 0) {
      a.dashT = dash;
      a.dashAngle = t.dashAngle;
    }
    a.slashT = live(prog(now, t.slashAt, CHIBI_TIMING.slash));
    a.slashSide = t.slashSide;
    a.cloak = r.cloak;
    a.charge = r.charge;
    return a;
  }

  /** Forget fighters not seen for a while (left sight); keeps the map small. */
  sweep(now: number) {
    for (const [id, t] of this.tracks) if (now - t.seen > 4000) this.tracks.delete(id);
  }
}
