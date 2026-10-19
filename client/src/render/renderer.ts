// Draws one frame of the arena from an interpolated View plus the locally predicted player
// and predicted shots. Layers: backdrop → floor → zone → floor hazards → pillars → pickups →
// projectiles → cores → overhead effects → particles/text → post (chromatic, flash, vignette).

import { hasStatusBit, PF, PFLAG, PICKUPS, PROJ, type ArenaDef, type NetEffect, type NetPlayer, type NetProjectile, type Player } from "@prism/shared";
import type { Fx } from "../fx/fx";
import type { PredictedShot, View } from "../net/netview";
import { Background } from "./background";
import type { Camera } from "./camera";
import { drawCore } from "./core";
import { Floor } from "./floor";
import { drawGlow, rainbow, withAlpha } from "./glow";
import { colorHex, PAL } from "./palette";
import { drawEffect, drawProjectileCustom, FLOOR_EFFECTS } from "./powers";
import { drawPortalLinks } from "./powers/portal";
import type { RenderCtx } from "./powers/types";

export interface FrameInput {
  view: View | null;
  me: Player | null;
  meOff: { x: number; y: number };
  shots: readonly PredictedShot[];
  myId: number;
  myColor: number;
  names: (id: number) => string;
  colors: (id: number) => number;
  time: number;
  dt: number;
  colorblind: boolean;
  /** Music/zone intensity 0..1 (brightens the backdrop). */
  intensity: number;
  /** Hunter's Eye / spectating: show cloaked players clearly. */
  seeCloaked: boolean;
  debugHitboxes: boolean;
}

interface Trail {
  pts: number[];
  seen: number;
}

export class Renderer {
  private bg = new Background();
  floor: Floor | null = null;
  private trails = new Map<number, Trail>();
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement, private ctx: CanvasRenderingContext2D, public cam: Camera, public fx: Fx) {}

  setArena(arena: ArenaDef) {
    this.floor = new Floor(arena);
    this.trails.clear();
  }

  private trail(id: number, x: number, y: number, max: number): number[] {
    let t = this.trails.get(id);
    if (!t) {
      t = { pts: [], seen: this.frame };
      this.trails.set(id, t);
    }
    t.seen = this.frame;
    const p = t.pts;
    const lx = p[p.length - 2];
    const ly = p[p.length - 1];
    if (lx === undefined || ly === undefined || Math.hypot(x - lx, y - ly) > 3) {
      p.push(x, y);
      while (p.length > max * 2) p.splice(0, 2);
    }
    return p;
  }

  private drawTrail(pts: readonly number[], color: string, width: number, alpha: number) {
    const ctx = this.ctx;
    const n = pts.length / 2;
    if (n < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      ctx.strokeStyle = withAlpha(color, alpha * t * t);
      ctx.lineWidth = width * (0.25 + 0.75 * t);
      ctx.beginPath();
      ctx.moveTo(pts[(i - 1) * 2] ?? 0, pts[(i - 1) * 2 + 1] ?? 0);
      ctx.lineTo(pts[i * 2] ?? 0, pts[i * 2 + 1] ?? 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  render(f: FrameInput) {
    const { ctx, cam } = this;
    this.frame++;
    const dpr = cam.dpr;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PAL.void;
    ctx.fillRect(0, 0, w, h);
    this.bg.draw(ctx, w, h, cam.x, cam.y, f.time, f.intensity);
    if (!this.floor) return;

    cam.apply(ctx);
    const bounds = cam.bounds(160);
    const invScale = 1 / cam.scale;
    const view = f.view;
    const rc: RenderCtx = {
      ctx, time: f.time, dt: f.dt, myId: f.myId, fx: this.fx, invScale,
      color: (id) => colorHex(f.colors(id)),
      player: (id) => view?.players.find((p) => p.id === id),
      playerName: f.names,
    };

    this.floor.draw(ctx, f.time, bounds);
    this.floor.drawEdge(ctx, f.time);

    if (view) {
      this.drawZone(view.g.zx, view.g.zy, view.g.zr, view.g.phase === "warn" ? { x: view.g.tx, y: view.g.ty, r: view.g.tr } : null, f.time);
      // Floor-level effects (hazards, bubbles, rifts).
      for (const e of view.effects) if (FLOOR_EFFECTS.has(e.kind)) drawEffect(rc, e);
      drawPortalLinks(rc, view.effects);
      this.drawPillars(this.floor.arena, view, f.time);
      this.drawPickups(view, f.time);
      for (const e of view.effects) if (!FLOOR_EFFECTS.has(e.kind)) drawEffect(rc, e);
      this.drawProjectiles(rc, view.projectiles, f);
      this.drawPlayers(rc, view.players, f);
    }
    // Predicted local shots on top of everything else's timing.
    for (const s of f.shots) {
      const col = colorHex(f.myColor);
      const pts = this.trail(-s.shotId, s.x, s.y, 7);
      this.drawTrail(pts, col, 9, 0.85 * s.alpha);
      drawGlow(ctx, s.x, s.y, 24, col, 0.9 * s.alpha);
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.fx.drawWorld(ctx, bounds, invScale);

    // Garbage-collect trails we didn't touch this frame.
    if (this.frame % 30 === 0) for (const [id, t] of this.trails) if (this.frame - t.seen > 30) this.trails.delete(id);

    if (f.debugHitboxes && view) this.drawHitboxes(view, f);

    // Post effects in screen space.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.post(w, h, dpr);
  }

  private drawZone(x: number, y: number, r: number, next: { x: number; y: number; r: number } | null, time: number) {
    const ctx = this.ctx;
    if (r > 6000) return;
    ctx.save();
    // Tint everything outside the safe circle.
    const outside = new Path2D();
    outside.rect(-1e5, -1e5, 2e5, 2e5);
    outside.arc(x, y, r, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(255,30,90,0.10)";
    ctx.fill(outside, "evenodd");
    ctx.globalCompositeOperation = "lighter";
    // Crackling energy wall: jittered arc segments.
    const segs = Math.max(48, Math.round(r / 12));
    for (let layer = 0; layer < 2; layer++) {
      ctx.strokeStyle = withAlpha(layer ? "#ffffff" : PAL.zone, layer ? 0.5 : 0.85);
      ctx.lineWidth = layer ? 1.5 : 5;
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const j = Math.sin(a * 23 + time * 9 + layer) * 4 + Math.sin(a * 57 - time * 13) * 3;
        const px = x + Math.cos(a) * (r + j);
        const py = y + Math.sin(a) * (r + j);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = withAlpha(PAL.zone, 0.12);
    ctx.lineWidth = 60;
    ctx.beginPath();
    ctx.arc(x, y, r + 30, 0, Math.PI * 2);
    ctx.stroke();
    // Random lightning arcs along the wall
    for (let k = 0; k < 3; k++) {
      const a = (Math.floor(time * 8) * 1.7 + k * 2.3) % (Math.PI * 2);
      ctx.strokeStyle = withAlpha("#ffd0e0", 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath();
      let px = x + Math.cos(a) * r;
      let py = y + Math.sin(a) * r;
      ctx.moveTo(px, py);
      for (let s = 0; s < 5; s++) {
        px += Math.cos(a) * 14 + (Math.random() - 0.5) * 22;
        py += Math.sin(a) * 14 + (Math.random() - 0.5) * 22;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    if (next) {
      ctx.strokeStyle = withAlpha(PAL.zoneSafe, 0.7);
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 14]);
      ctx.lineDashOffset = -time * 40;
      ctx.beginPath();
      ctx.arc(next.x, next.y, next.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawPillars(arena: ArenaDef, view: View, time: number) {
    const ctx = this.ctx;
    for (const p of arena.pillars) {
      const live = view.pillars.get(p.id);
      if (live?.dead) continue;
      const hpF = live ? live.hp / p.maxHp : 1;
      const sides = p.r > 80 ? 8 : 6;
      const rot = p.id * 0.7;
      // Base shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(p.x + 6, p.y + 10, p.r * 1.02, 0, Math.PI * 2);
      ctx.fill();
      drawGlow(ctx, p.x, p.y, p.r * 2, PAL.crystal, 0.22 + 0.1 * Math.sin(time * 1.5 + p.id));
      // Crystal body
      const g = ctx.createLinearGradient(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r);
      g.addColorStop(0, "#9ff0ff");
      g.addColorStop(0.45, "#3c6fd6");
      g.addColorStop(1, "#1a1f6a");
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2;
        const rr = p.r * (i % 2 ? 0.92 : 1);
        const x = p.x + Math.cos(a) * rr;
        const y = p.y + Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(210,250,255,0.9)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Facets
      ctx.strokeStyle = "rgba(200,245,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < sides; i += 2) {
        const a = rot + (i / sides) * Math.PI * 2;
        ctx.moveTo(p.x + Math.cos(a) * p.r * 0.35, p.y + Math.sin(a) * p.r * 0.35);
        ctx.lineTo(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r);
      }
      ctx.stroke();
      // Top highlight
      drawGlow(ctx, p.x - p.r * 0.25, p.y - p.r * 0.3, p.r * 0.7, "#e6fbff", 0.35);
      // Damage cracks
      if (hpF < 0.99) {
        ctx.strokeStyle = `rgba(255,255,255,${0.4 + (1 - hpF) * 0.5})`;
        ctx.lineWidth = 1.6;
        const n = Math.ceil((1 - hpF) * 6);
        for (let k = 0; k < n; k++) {
          const a = rot * 3 + k * 2.4;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a) * p.r * 0.1, p.y + Math.sin(a) * p.r * 0.1);
          ctx.lineTo(p.x + Math.cos(a + 0.4) * p.r * 0.55, p.y + Math.sin(a + 0.4) * p.r * 0.55);
          ctx.lineTo(p.x + Math.cos(a + 0.1) * p.r * 0.95, p.y + Math.sin(a + 0.1) * p.r * 0.95);
          ctx.stroke();
        }
      }
    }
  }

  private drawPickups(view: View, time: number) {
    const ctx = this.ctx;
    for (const pk of view.pickups) {
      const bob = Math.sin(time * 3 + pk.id) * 5;
      const col = pk.kind === "heal" ? PAL.heal : pk.kind === "cooldown" ? PAL.cooldown : pk.kind === "ult" ? PAL.ult : rainbow(time * 0.4);
      const x = pk.x;
      const y = pk.y + bob;
      drawGlow(ctx, x, y, PICKUPS.radius * 3.2, col, 0.75);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * (pk.kind === "prism" ? 2 : 0.8));
      ctx.fillStyle = withAlpha(col, 0.25);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const s = PICKUPS.radius;
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.8, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-time * (pk.kind === "prism" ? 2 : 0.8));
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (pk.kind === "heal") {
        ctx.moveTo(-7, 0);
        ctx.lineTo(7, 0);
        ctx.moveTo(0, -7);
        ctx.lineTo(0, 7);
        ctx.stroke();
      } else if (pk.kind === "cooldown") {
        ctx.arc(0, 0, 7, -Math.PI / 2, Math.PI * 1.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -5);
        ctx.stroke();
      } else if (pk.kind === "ult") {
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 4) / 5;
          if (i) ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
          else ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.moveTo(0, -8);
        ctx.lineTo(7, 6);
        ctx.lineTo(-7, 6);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawProjectiles(rc: RenderCtx, list: readonly NetProjectile[], f: FrameInput) {
    const ctx = this.ctx;
    for (const p of list) {
      // Hide the server copy of our own shot while the predicted one is still showing.
      if (p.owner === f.myId && p.shotId && f.shots.some((s) => s.shotId === p.shotId && s.alpha > 0.5)) continue;
      if (drawProjectileCustom(rc, p)) continue;
      let col = colorHex(f.colors(p.owner));
      if ((p.flags & PF.ricochet) !== 0) col = p.bounces >= 4 ? rainbow(f.time * 2 + p.id * 0.1) : ["#ffffff", "#7cf6ff", "#ff7bf2", "#ffd34d", "#9dff3a"][p.bounces] ?? col;
      const crit = (p.flags & PF.crit) !== 0;
      const pts = this.trail(p.id, p.x, p.y, crit ? 10 : 7);
      this.drawTrail(pts, crit ? "#ffd34d" : col, p.kind === PROJ.clone ? 6 : 9, 0.8);
      drawGlow(ctx, p.x, p.y, crit ? 34 : 24, crit ? "#ffd34d" : col, 0.9);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, p.r * 0.65), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayers(rc: RenderCtx, list: readonly NetPlayer[], f: FrameInput) {
    const ctx = this.ctx;
    for (const p of list) {
      if (!(p.flags & PFLAG.alive)) continue;
      const isMe = p.id === f.myId;
      const me = isMe ? f.me : null;
      const x = me ? me.x + f.meOff.x : p.x;
      const y = me ? me.y + f.meOff.y : p.y;
      const cloaked = hasStatusBit(p.status, "cloaked");
      const alpha = cloaked ? (isMe ? 0.45 : f.seeCloaked ? 0.6 : 0.07) : 1;
      const col = colorHex(p.color);
      const dashing = (p.flags & PFLAG.dashing) !== 0 || (me ? me.dashT > 0 : false);
      const pts = this.trail(p.id, x, y, dashing ? 14 : 10);
      this.drawTrail(pts, col, dashing ? 30 : 18, (dashing ? 0.7 : 0.35) * alpha);
      if (dashing && Math.random() < 0.8) this.fx.particles.spawn(x, y, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.35, 10, col);
      if (cloaked && !isMe && Math.random() < 0.15) this.fx.particles.spawn(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30, 0, -20, 0.5, 4, "#ffffff");
      drawCore(ctx, {
        x, y, color: col, colorIndex: p.color, hp: me ? Math.max(0, p.hp) : p.hp, aim: me ? me.aim : p.aim, time: f.time,
        name: f.names(p.id), isMe, alpha, dashing, ultReady: (p.flags & PFLAG.ultReady) !== 0, bountied: hasStatusBit(p.status, "bountied"),
        slowed: hasStatusBit(p.status, "slowed") || hasStatusBit(p.status, "timeBubble"), inverted: hasStatusBit(p.status, "inverted"),
        airborne: hasStatusBit(p.status, "airborne") ? 1 : 0, invulnerable: hasStatusBit(p.status, "invulnerable") && !dashing,
        disconnected: (p.flags & PFLAG.connected) === 0, colorblind: f.colorblind, invScale: rc.invScale, showBar: !isMe,
      });
      if (hasStatusBit(p.status, "overdrive")) {
        // White-hot lightning aura
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          let a = Math.random() * Math.PI * 2;
          ctx.moveTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30);
          for (let s = 0; s < 4; s++) {
            a += (Math.random() - 0.5) * 1.2;
            const rr = 30 + Math.random() * 22;
            ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  private drawHitboxes(view: View, f: FrameInput) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,120,0.9)";
    ctx.lineWidth = 1.5;
    for (const p of view.players) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (f.me) {
      ctx.strokeStyle = "rgba(255,255,0,0.9)";
      ctx.beginPath();
      ctx.arc(f.me.x, f.me.y, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,80,80,0.9)";
    for (const p of view.projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(80,160,255,0.9)";
    for (const e of view.effects as readonly NetEffect[]) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private post(w: number, h: number, dpr: number) {
    const ctx = this.ctx;
    const fx = this.fx;
    if (fx.chroma > 0.02) {
      // Chromatic aberration: shifted red/blue copies of the frame, added on top.
      const shift = fx.chroma * 9 * dpr;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.33 * fx.chroma;
      ctx.drawImage(this.canvas, -shift, 0);
      ctx.globalAlpha = 0.33 * fx.chroma;
      ctx.drawImage(this.canvas, shift, 0);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgba(255,${Math.round(255 - fx.chroma * 40)},255,1)`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (fx.flash > 0.01) {
      ctx.fillStyle = withAlpha(fx.flashColor, Math.min(0.6, fx.flash * 0.6));
      ctx.fillRect(0, 0, w, h);
    }
    // Vignette
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,6,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
