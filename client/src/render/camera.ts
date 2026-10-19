// Camera: follows the local player with a critically damped spring, leads toward the
// mouse, scales to fit the window (letterboxed world units), and adds trauma shake.

import { FX } from "@prism/shared";

export class Camera {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  zoom = 1;
  /** Extra zoom from punches (decays). */
  punch = 0;
  trauma = 0;
  shakeScale = 1;
  w = 1;
  h = 1;
  dpr = 1;
  private seed = Math.random() * 1000;
  ox = 0;
  oy = 0;
  /** Override target (replays, spectating). */
  focusZoom = 1;

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }

  /** World units per screen pixel at base zoom: fit FX.viewHeight vertically (and a sane width). */
  get baseScale() {
    const byH = this.h / FX.viewHeight;
    const byW = this.w / (FX.viewHeight * 1.9);
    return Math.max(byH, byW) * 1;
  }

  get scale() {
    return this.baseScale * this.zoom * (1 + this.punch) * this.focusZoom;
  }

  follow(tx: number, ty: number, dt: number, snap = false) {
    if (snap) {
      this.x = tx;
      this.y = ty;
      this.vx = this.vy = 0;
      return;
    }
    const k = FX.camStiffness;
    // Critically damped spring.
    const ax = k * k * (tx - this.x) - 2 * k * this.vx;
    const ay = k * k * (ty - this.y) - 2 * k * this.vy;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  addTrauma(t: number) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  update(dt: number, time: number) {
    this.trauma = Math.max(0, this.trauma - FX.shakeDecay * dt);
    this.punch *= Math.exp(-dt * 7);
    const s = this.trauma * this.trauma * FX.shakeMax * this.shakeScale;
    const n = (o: number) => Math.sin(time * 37 + this.seed + o) * 0.6 + Math.sin(time * 61 + o * 3) * 0.4;
    this.ox = s * n(1);
    this.oy = s * n(7);
  }

  /** Applies the world transform to a context (call inside save/restore). */
  apply(ctx: CanvasRenderingContext2D) {
    const sc = this.scale * this.dpr;
    ctx.setTransform(sc, 0, 0, sc, (this.w / 2 + this.ox) * this.dpr - this.x * sc, (this.h / 2 + this.oy) * this.dpr - this.y * sc);
  }

  toWorld(sx: number, sy: number) {
    const sc = this.scale;
    return { x: (sx - this.w / 2 - this.ox) / sc + this.x, y: (sy - this.h / 2 - this.oy) / sc + this.y };
  }

  toScreen(wx: number, wy: number) {
    const sc = this.scale;
    return { x: (wx - this.x) * sc + this.w / 2 + this.ox, y: (wy - this.y) * sc + this.h / 2 + this.oy };
  }

  /** Visible world rect (for culling), with margin. */
  bounds(margin = 100) {
    const sc = this.scale;
    const hw = this.w / 2 / sc + margin;
    const hh = this.h / 2 / sc + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
