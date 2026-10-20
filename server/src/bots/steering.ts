// Movement for one bot: follows a nav path toward the goal the brain picked (cached, and
// re-planned on a budget when the goal moves, the grid changes, the bot strays or gets
// stuck), then local feelers bend the final vector around anything in the way and a stuck
// detector shakes the bot loose.

import { BOTS, sweepSolids, type Player, type Rng, type World } from "@prism/shared";
import { gridLineClear, Nav, type NavPath } from "./nav";

const N = BOTS.nav;
const FEELER = 70;
const STUCK_WINDOW = 0.6;
const STUCK_DIST = 30;
const ANGLES = [0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.9, -1.9, 2.5, -2.5];

export interface Vec {
  x: number;
  y: number;
}

const unit = (x: number, y: number): Vec => {
  const l = Math.hypot(x, y);
  return l > 1e-6 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
};

export class Steering {
  private path: NavPath | null = null;
  private idx = 0;
  private age = 0;
  private cooldown = 0;
  private side = 1;
  private stuckT = 0;
  private escapeT = 0;
  private escapeX = 0;
  private escapeY = 0;
  private lastX = 0;
  private lastY = 0;
  /** Distance to the waypoint being walked to (limits feeler length). */
  private wpDist = Infinity;

  constructor(private rng: Rng) {}

  /** Forget the current path (it will be re-planned on the next call). */
  invalidate() {
    this.path = null;
    this.cooldown = 0;
  }

  /** No goal this tick (just weaving or standing): feelers use their full length. */
  noGoal() {
    this.wpDist = Infinity;
  }

  /** Remaining waypoints (debugging and tests). */
  get waypoints(): readonly Vec[] {
    return this.path ? this.path.pts.slice(this.idx) : [];
  }

  /** Is the straight line from `me` toward angle `a` clear for `len` units? */
  clear(w: World, me: Player, a: number, len = FEELER): boolean {
    const hit = sweepSolids(w.map, me.x, me.y, me.x + Math.cos(a) * len, me.y + Math.sin(a) * len, N.clearRadius);
    return !hit || hit.t >= 1;
  }

  /** Can a body walk straight from `me` to (x, y)? */
  straight(w: World, me: Player, x: number, y: number): boolean {
    const hit = sweepSolids(w.map, me.x, me.y, x, y, N.clearRadius);
    return !hit || hit.t >= 1;
  }

  /**
   * Unit direction to walk toward (gx, gy) along the nav path; zero when there. `look` allows
   * the (slightly pricier) skip-ahead check this call.
   */
  toward(w: World, me: Player, gx: number, gy: number, dt: number, look: boolean, reach: number = N.waypointReach): Vec {
    const d = Math.hypot(gx - me.x, gy - me.y);
    this.wpDist = d;
    this.age += dt;
    this.cooldown -= dt;
    if (d < reach) return { x: 0, y: 0 };
    if (d < N.directRange && look && this.straight(w, me, gx, gy)) {
      this.path = null;
      return unit(gx - me.x, gy - me.y);
    }
    if (!this.path && d < N.directRange && this.cooldown > 0) return unit(gx - me.x, gy - me.y);
    const nav = Nav.of(w);
    const p = this.path;
    let need = !p || p.version !== nav.grid.version || this.age > N.repathSeconds || Math.hypot(p.goalX - gx, p.goalY - gy) > N.goalDrift;
    if (p && !need) {
      const wp = p.pts[this.idx];
      const prev = this.idx > 0 ? p.pts[this.idx - 1] : null;
      if (wp && prev && Math.hypot(me.x - wp.x, me.y - wp.y) > Math.hypot(prev.x - wp.x, prev.y - wp.y) + N.offPath) need = true;
    }
    if (need && this.cooldown <= 0) {
      const np = nav.path(me.x, me.y, gx, gy);
      if (np) {
        this.path = np;
        this.idx = 0;
        // A partial path (goal walled off or past the search budget) is re-planned less often.
        this.age = np.complete ? 0 : -N.repathSeconds;
        this.cooldown = N.repathMinSeconds * (0.8 + this.rng.next() * 0.4);
      }
    }
    const path = this.path;
    if (!path) return unit(gx - me.x, gy - me.y);
    const pts = path.pts;
    while (this.idx < pts.length - 1) {
      const wp = pts[this.idx]!;
      if (Math.hypot(wp.x - me.x, wp.y - me.y) < N.waypointReach) this.idx++;
      else break;
    }
    if (look && this.idx < pts.length - 1) {
      const nx = pts[this.idx + 1]!;
      if (gridLineClear(nav.grid, me.x, me.y, nx.x, nx.y) && this.straight(w, me, nx.x, nx.y)) this.idx++;
    }
    const wp = pts[this.idx];
    if (!wp) return { x: 0, y: 0 };
    if (this.idx === pts.length - 1 && Math.hypot(wp.x - me.x, wp.y - me.y) < N.waypointReach) {
      // The grid ends short of the goal (tucked against a wall, or a partial path out of a
      // pocket): head straight for it and let collisions slide us; the stuck check and a
      // re-plan take over if that goes nowhere.
      return unit(gx - me.x, gy - me.y);
    }
    this.wpDist = Math.hypot(wp.x - me.x, wp.y - me.y);
    return unit(wp.x - me.x, wp.y - me.y);
  }

  /**
   * Turns a wanted movement vector into one that slides around obstacles, with the stuck
   * detector. Returns the vector for the input frame (length ≤ 1).
   */
  steer(w: World, me: Player, mx: number, my: number, dt: number): Vec {
    const want = Math.hypot(mx, my);
    if (want < 0.05) {
      this.stuckT = 0;
      this.lastX = me.x;
      this.lastY = me.y;
      return { x: 0, y: 0 };
    }
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      return { x: this.escapeX, y: this.escapeY };
    }
    // Trying to move but going nowhere over a short window (wedged, or jittering in place):
    // pick a sideways escape and re-plan. Slows from healing or statuses don't count.
    const slow = me.healKind || (me.status.slowed ?? 0) > 0 || (me.status.shocked ?? 0) > 0 || (me.status.timeBubble ?? 0) > 0;
    this.stuckT += dt;
    if (this.stuckT >= STUCK_WINDOW) {
      const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
      this.stuckT = 0;
      this.lastX = me.x;
      this.lastY = me.y;
      if (!slow && want > 0.3 && moved < STUCK_DIST) {
        this.side *= -1;
        const a = Math.atan2(my, mx) + this.side * this.rng.range(1.2, 2.6);
        this.escapeX = Math.cos(a);
        this.escapeY = Math.sin(a);
        this.escapeT = this.rng.range(0.25, 0.55);
        this.invalidate();
        return { x: this.escapeX, y: this.escapeY };
      }
    }
    // Feel ahead only as far as the next waypoint (the path itself is already clear).
    const len = Math.max(30, Math.min(FEELER, this.wpDist));
    const base = Math.atan2(my, mx);
    const k = Math.min(1, want);
    if (this.clear(w, me, base, len)) return { x: Math.cos(base) * k, y: Math.sin(base) * k };
    for (const off of ANGLES) {
      const a = base + off * this.side;
      if (this.clear(w, me, a, len)) return { x: Math.cos(a) * k, y: Math.sin(a) * k };
    }
    // Boxed in: push on and let collisions slide us (the stuck check covers real wedges).
    return { x: Math.cos(base) * k, y: Math.sin(base) * k };
  }
}
