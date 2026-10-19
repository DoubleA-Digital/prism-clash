// Local steering for bots on the big map: feeler rays around the wanted direction pick the
// closest heading that isn't blocked by terrain, and a stuck detector shakes them loose.
// This is deliberately local (no pathfinding): a future nav-grid/A* layer can feed
// waypoints into `steer` without changing anything else.

import { sweepSolids, type Player, type Rng, type World } from "@prism/shared";

const FEELER = 110;
const ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.9, -1.9, 2.5, -2.5];

export class Steering {
  private side = 1;
  private stuckT = 0;
  private escapeT = 0;
  private escapeX = 0;
  private escapeY = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(private rng: Rng) {}

  /** Is the straight line from `me` toward angle `a` clear for `len` units? */
  clear(w: World, me: Player, a: number, len = FEELER): boolean {
    const hit = sweepSolids(w.map, me.x, me.y, me.x + Math.cos(a) * len, me.y + Math.sin(a) * len, me.r + 4);
    return !hit || hit.t >= 1;
  }

  /**
   * Turns a wanted movement vector into one that slides around obstacles. Returns the
   * vector to feed into the input frame (length ≤ 1).
   */
  steer(w: World, me: Player, mx: number, my: number, dt: number): { x: number; y: number } {
    const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
    this.lastX = me.x;
    this.lastY = me.y;
    const want = Math.hypot(mx, my);
    if (want < 0.05) return { x: 0, y: 0 };
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      return { x: this.escapeX, y: this.escapeY };
    }
    if (moved < 1.2) {
      this.stuckT += dt;
      if (this.stuckT > 0.5) {
        this.stuckT = 0;
        this.side *= -1;
        const a = Math.atan2(my, mx) + this.side * this.rng.range(1.2, 2.6);
        this.escapeX = Math.cos(a);
        this.escapeY = Math.sin(a);
        this.escapeT = this.rng.range(0.35, 0.7);
      }
    } else this.stuckT = 0;
    const base = Math.atan2(my, mx);
    const k = Math.min(1, want);
    for (const off of ANGLES) {
      const a = base + off * this.side;
      if (this.clear(w, me, a)) return { x: Math.cos(a) * k, y: Math.sin(a) * k };
    }
    return { x: -Math.cos(base) * k, y: -Math.sin(base) * k };
  }
}
