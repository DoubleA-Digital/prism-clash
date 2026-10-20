// A bot's aim and trigger finger. The target's movement is only re-read every reaction
// interval (in between, the bot extrapolates what it last saw), each read carries fresh aim
// error scaled by difficulty, settling a little while it keeps tracking the same target. The
// trigger knows each gun: hold for bullets, charge-and-release the lance, swing the blade up close.

import { activeWeapon, BTN, sweepSolids, WEAPONS, type Player, type Rng, type World } from "@prism/shared";
import type { Profile } from "./personality";

export class Hands {
  private seen: { x: number; y: number; vx: number; vy: number; at: number } | null = null;
  private aimErr = 0;
  private trackT = 0;
  private chargeGoal = 0.85;

  constructor(private profile: Profile, private rng: Rng) {}

  /** Start fresh on a new target (aim settles again from scratch). */
  reset() {
    this.seen = null;
    this.trackT = 0;
  }

  /** Every tick: follow the visible target `t` (null when there's nothing in sight to aim at). */
  track(w: World, me: Player, t: Player | null) {
    if (!t || !t.alive) {
      this.reset();
      return;
    }
    const now = w.time;
    this.trackT += w.dt;
    if (!this.seen || now - this.seen.at >= this.profile.reaction) {
      this.seen = { x: t.x, y: t.y, vx: t.vx + t.px, vy: t.vy + t.py, at: now };
      const blind = (me.status.blinded ?? 0) > 0 ? 4 : 1;
      const settle = 1 - this.profile.aimSettle * Math.min(1, this.trackT / 2);
      const scoped = activeWeapon(me)?.id === "sniper" && Math.hypot(me.vx, me.vy) < 120 ? 0.6 : 1;
      this.aimErr = ((this.rng.next() * 2 - 1) * this.profile.aimErrorDeg * blind * settle * scoped * Math.PI) / 180;
    } else {
      this.seen.x += this.seen.vx * w.dt;
      this.seen.y += this.seen.vy * w.dt;
    }
  }

  /** Aim at where we believe the target is, leading it by the bullet's flight time. */
  aim(me: Player): { aim: number; dist: number } | null {
    const s = this.seen;
    if (!s) return null;
    const gun = activeWeapon(me);
    const def = gun ? WEAPONS[gun.id] : WEAPONS.pistol;
    const dist = Math.hypot(s.x - me.x, s.y - me.y);
    const speed = def.kind === "lance" || def.kind === "blade" ? 0 : def.speed;
    const tt = speed > 0 ? dist / speed : 0;
    const lead = this.profile.leadSkill;
    return { aim: Math.atan2(s.y + s.vy * tt * lead - me.y, s.x + s.vx * tt * lead - me.x) + this.aimErr, dist };
  }

  /** Trigger bits for the gun in hand at distance d. */
  trigger(me: Player, d: number): number {
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

  /** Can a shot reach the target? Breakable props in the way are fine (they'll break). */
  shotClear(w: World, me: Player, t: Player): boolean {
    const hit = sweepSolids(w.map, me.x, me.y, t.x, t.y, 0);
    if (!hit || hit.t >= 1) return true;
    if (activeWeapon(me)?.id === "rocket") return true;
    return hit.solid.maxHp > 0 && !hit.solid.tough && hit.t > 0.15;
  }
}
