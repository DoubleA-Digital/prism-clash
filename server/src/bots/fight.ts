// Fight micro for one target: hold the gun's preferred range (shotguns close in, snipers
// keep their distance), strafe, break line of sight to reload or after a burst of damage,
// then peek back out from where we last saw them, chase or hold when they vanish.

import { activeWeapon, BOTS, type Player, type Rng, type World } from "@prism/shared";
import { backOff, findCover, prefRange, type Spot } from "./combat";
import type { NavGrid } from "./nav";
import type { Contact } from "./perception";
import type { Profile } from "./personality";

const C = BOTS.combat;

export type FightPhase = "engage" | "cover" | "peek" | "pursue" | "hold";

export interface FightIntent {
  goal: Spot | null;
  /** Sideways weaving weight (0 = none). */
  strafe: number;
  /** Stand still (waiting in ambush or holding an angle). */
  stop: boolean;
  /** Give up on this target. */
  drop: boolean;
  /** Lying in wait: don't give the position away by shooting yet. */
  holdFire: boolean;
}

export interface FightContext {
  w: World;
  me: Player;
  grid: NavGrid;
  p: Profile;
  target: Contact;
  now: number;
  dt: number;
  rng: Rng;
  inZone: (x: number, y: number) => boolean;
  /** Damage taken in the last 1.5 s. */
  burst: number;
  /** We started this fight from an ambush and haven't been spotted. */
  ambushing: boolean;
}

export class FightMicro {
  phase: FightPhase = "engage";
  private phaseT = 0;
  private cover: Spot | null = null;
  private peek: Spot | null = null;
  private coverCd = 0;
  strafeDir = 1;
  private strafeT = 0;

  reset() {
    this.phase = "engage";
    this.phaseT = 0;
    this.cover = null;
    this.peek = null;
  }

  /** In cover and waiting (reload behind it). */
  get inCover(): boolean {
    return this.phase === "cover";
  }

  plan(c: FightContext): FightIntent {
    const { me, target: t, p, rng } = c;
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    const gun = activeWeapon(me);
    const id = gun?.id ?? "pistol";
    const pref = prefRange(id, p.range);
    this.coverCd -= c.dt;
    this.strafeT -= c.dt;
    if (this.strafeT <= 0) {
      this.strafeDir *= -1;
      this.strafeT = rng.range(C.strafeSeconds[0], C.strafeSeconds[1]);
    }
    if (t.visible && this.phase !== "cover") this.peek = { x: me.x, y: me.y };
    const none: FightIntent = { goal: null, strafe: 0, stop: false, drop: false, holdFire: false };

    switch (this.phase) {
      case "cover": {
        this.phaseT -= c.dt;
        // Rushed while hiding: fight back.
        if (t.visible && d < 220) this.phase = "engage";
        else if (this.phaseT <= 0 && me.reloadT <= 0) this.phase = t.visible ? "engage" : "peek";
        else return { ...none, goal: this.cover };
        break;
      }
      case "peek": {
        if (t.visible) {
          this.phase = "engage";
          break;
        }
        const spot = this.peek;
        if (spot && Math.hypot(spot.x - me.x, spot.y - me.y) > 40) return { ...none, goal: spot };
        this.phase = p.aggression >= 1 ? "pursue" : "hold";
        this.phaseT = rng.range(1.5, 3);
        break;
      }
      case "hold": {
        if (t.visible) {
          this.phase = "engage";
          break;
        }
        this.phaseT -= c.dt;
        if (c.now - Math.max(t.seenAt, t.heardAt) > C.pursueSeconds) return { ...none, drop: true };
        if (this.phaseT <= 0) this.phase = "pursue";
        return { ...none, stop: true };
      }
      case "pursue": {
        if (t.visible) {
          this.phase = "engage";
          break;
        }
        if (c.now - Math.max(t.seenAt, t.heardAt) > C.pursueSeconds) return { ...none, drop: true };
        if (d < Math.max(120, pref * 0.5)) return { ...none, drop: c.now - t.seenAt > 1 };
        return { ...none, goal: { x: t.x, y: t.y } };
      }
      default:
        break;
    }

    // Engage.
    if (!t.visible) {
      this.phase = c.now - t.seenAt < 0.8 && this.peek ? "peek" : p.aggression >= 1 ? "pursue" : "hold";
      this.phaseT = rng.range(1.2, 2.5);
      return { ...none, goal: this.phase === "pursue" ? { x: t.x, y: t.y } : this.peek, stop: this.phase === "hold" };
    }
    const reloading = me.reloadT > 0.45 || (gun && gun.mag <= 0 && me.reloadT > 0);
    const slowGun = (id === "sniper" || id === "rocket") && me.fireCd > 0.6;
    const hurt = c.burst >= C.burstDamage && d > 200;
    if ((reloading || slowGun || hurt) && this.coverCd <= 0 && d > 160) {
      this.coverCd = 2.5;
      if (rng.next() < p.coverUse) {
        const spot = findCover(c.w, c.grid, me, t.x, t.y, c.inZone);
        if (spot) {
          this.cover = spot;
          this.phase = "cover";
          this.phaseT = Math.max(me.reloadT + 0.15, rng.range(C.coverHold[0], C.coverHold[1]));
          return { ...none, goal: spot };
        }
      }
    }
    if (c.ambushing && d > pref && c.burst <= 0) return { ...none, stop: true, holdFire: true };
    if (id === "blade") return { ...none, goal: { x: t.x, y: t.y }, strafe: d > 260 ? 0.6 : 0.2 };
    if (d > pref * 1.15) return { ...none, goal: { x: t.x, y: t.y }, strafe: 0.35 };
    if (d < pref * 0.6) return { ...none, goal: backOff(c.grid, me, t.x, t.y, 220), strafe: 0.5 };
    return { ...none, strafe: 0.9 };
  }
}
