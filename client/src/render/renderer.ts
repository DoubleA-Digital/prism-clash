// Draws one frame of the match from an interpolated View plus the locally predicted player
// and predicted shots. Layers: backdrop → floor/water → zone → floor effects → loot → low
// terrain → projectiles → heroes → effects → line-of-sight shadows → walls → bushes →
// roofs → smoke/supply → labels → particles/text → post (chromatic, flash, vignette).

import {
  canSeePoint, hasStatusBit, ITEMS, PF, PFLAG, PLAYER, PROJ, roofAt, ACT, isThrowableId,
  type GameEvent, type MapDef, type NetEffect, type NetLoot, type NetPlayer, type NetProjectile, type Player,
} from "@prism/shared";
import type { Fx } from "../fx/fx";
import type { PredictedShot, View } from "../net/netview";
import { Background } from "./background";
import type { Camera } from "./camera";
import { Floor } from "./floor";
import { drawGlow, rainbow, withAlpha } from "./glow";
import { drawHero } from "./hero";
import { drawLoot, drawLootLabel } from "./items";
import { colorHex, PAL } from "./palette";
import { drawEffect, drawProjectileCustom, FLOOR_EFFECTS, TOP_EFFECTS } from "./powers";
import { drawPortalLinks } from "./powers/portal";
import type { RenderCtx } from "./powers/types";
import { drawShadows } from "./shadows";
import { Terrain } from "./terrain";

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
  /** Hunter's Eye: show cloaked players clearly. */
  seeCloaked: boolean;
  debugHitboxes: boolean;
  /** Whose eyes the shadows are cast from (you, or who you spectate). */
  viewer: { x: number; y: number } | null;
  /** The loot F would pick up (highlighted with a label). */
  interact: NetLoot | null;
  interactKey: string;
}

interface Trail {
  pts: number[];
  seen: number;
}

const GRENADE_COLORS = { frag: ITEMS.throwables.frag.color, smoke: ITEMS.throwables.smoke.color, mine: ITEMS.throwables.mine.color };

export class Renderer {
  private bg = new Background();
  floor: Floor | null = null;
  terrain: Terrain | null = null;
  private map: MapDef | null = null;
  private trails = new Map<number, Trail>();
  private frame = 0;
  private shotAt = new Map<number, number>();
  private hitAt = new Map<number, number>();

  constructor(private canvas: HTMLCanvasElement, private ctx: CanvasRenderingContext2D, public cam: Camera, public fx: Fx) {}

  setMap(map: MapDef) {
    this.map = map;
    this.floor = new Floor(map);
    this.terrain = new Terrain(map);
    this.trails.clear();
  }

  /** Animation cues from game events (recoil, hit flash). */
  onEvent(e: GameEvent, now: number) {
    if (e.t === "shoot" || e.t === "slash") this.shotAt.set(e.by, now);
    if (e.t === "hit" && e.amount > 0) this.hitAt.set(e.target, now);
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
    const map = this.map;
    if (!this.floor || !this.terrain || !map) return;

    cam.apply(ctx);
    const bounds = cam.bounds(160);
    const invScale = 1 / cam.scale;
    const view = f.view;
    const mePos = f.me ? { x: f.me.x + f.meOff.x, y: f.me.y + f.meOff.y } : null;
    const rc: RenderCtx = {
      ctx, time: f.time, dt: f.dt, myId: f.myId, fx: this.fx, invScale,
      color: (id) => colorHex(f.colors(id)),
      // The local player is drawn at its predicted position; effects that follow a player
      // (auras, tethers, clones) must use the same spot or they'd trail ~100 ms behind.
      player: (id) => {
        const p = view?.players.find((q) => q.id === id);
        return p && id === f.myId && f.me && mePos ? { ...p, x: mePos.x, y: mePos.y, aim: f.me.aim } : p;
      },
      playerName: f.names,
      pos: (id) => (id === f.myId && mePos ? mePos : view?.players.find((p) => p.id === id)),
      seeCloaked: f.seeCloaked,
      canSee: (x, y) => !f.viewer || canSeePoint(map, f.viewer.x, f.viewer.y, x, y, PLAYER.radius * 0.8),
    };

    this.floor.draw(ctx, f.time, bounds);
    this.drawMapEdge(map, f.time);

    if (view) {
      this.drawZone(view.g.zx, view.g.zy, view.g.zr, view.g.phase === "warn" || view.g.phase === "shrink" ? { x: view.g.tx, y: view.g.ty, r: view.g.tr } : null, f.time);
      for (const e of view.effects) if (FLOOR_EFFECTS.has(e.kind)) drawEffect(rc, e);
      drawPortalLinks(rc, view.effects);
      for (const l of view.loot) if (l.x > bounds.x0 && l.x < bounds.x1 && l.y > bounds.y0 && l.y < bounds.y1) drawLoot(ctx, l, f.time, l.id === f.interact?.id);
    }
    this.terrain.drawSolids(ctx, bounds, f.time, false);
    if (view) {
      this.drawProjectiles(rc, view.projectiles, f);
      this.drawShots(f);
      this.drawPlayers(rc, view.players, f, mePos);
      for (const e of view.effects) if (!FLOOR_EFFECTS.has(e.kind) && !TOP_EFFECTS.has(e.kind)) drawEffect(rc, e);
    }
    if (f.viewer) drawShadows(ctx, map, f.viewer.x, f.viewer.y, bounds);
    this.terrain.drawSolids(ctx, bounds, f.time, true);
    this.terrain.drawBushes(ctx, bounds, f.time, mePos);
    this.terrain.drawRoofs(ctx, bounds, f.viewer ? roofAt(map, f.viewer.x, f.viewer.y) : -1, f.dt || 0.016);
    if (view) for (const e of view.effects) if (TOP_EFFECTS.has(e.kind)) drawEffect(rc, e);
    if (f.interact) drawLootLabel(ctx, f.interact, invScale, f.interact.kind === "weapon" || f.interact.kind === "throwable" ? `${f.interactKey} — pick up` : null);

    this.fx.drawWorld(ctx, bounds, invScale);

    // Garbage-collect trails we didn't touch this frame.
    if (this.frame % 30 === 0) for (const [id, t] of this.trails) if (this.frame - t.seen > 30) this.trails.delete(id);

    if (f.debugHitboxes && view) this.drawHitboxes(view, f);

    // Post effects in screen space.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.post(w, h, dpr);
  }

  /** Darkness beyond the map edge, with a glowing border. */
  private drawMapEdge(map: MapDef, time: number) {
    const ctx = this.ctx;
    const hh = map.half;
    ctx.save();
    ctx.fillStyle = "rgba(2,2,10,0.7)";
    const big = new Path2D();
    big.rect(-1e5, -1e5, 2e5, 2e5);
    big.rect(-hh, -hh, hh * 2, hh * 2);
    ctx.fill(big, "evenodd");
    ctx.globalCompositeOperation = "lighter";
    const pulse = 0.75 + 0.25 * Math.sin(time * 2);
    ctx.strokeStyle = withAlpha(PAL.edge, 0.12 * pulse);
    ctx.lineWidth = 40;
    ctx.strokeRect(-hh, -hh, hh * 2, hh * 2);
    ctx.strokeStyle = withAlpha("#d9fdff", 0.9);
    ctx.lineWidth = 3;
    ctx.strokeRect(-hh, -hh, hh * 2, hh * 2);
    ctx.restore();
  }

  private drawZone(x: number, y: number, r: number, next: { x: number; y: number; r: number } | null, time: number) {
    const ctx = this.ctx;
    ctx.save();
    // Tint everything outside the safe circle.
    const outside = new Path2D();
    outside.rect(-1e5, -1e5, 2e5, 2e5);
    outside.arc(x, y, r, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(255,30,90,0.12)";
    ctx.fill(outside, "evenodd");
    ctx.globalCompositeOperation = "lighter";
    // Crackling energy wall: jittered arc segments.
    const segs = Math.min(720, Math.max(48, Math.round(r / 12)));
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

  private drawShots(f: FrameInput) {
    const ctx = this.ctx;
    const col = colorHex(f.myColor);
    for (const s of f.shots) {
      if (s.weapon === "rocket") {
        this.drawRocket(s.x, s.y, s.vx, s.vy, col, s.alpha);
        continue;
      }
      const pts = this.trail(-s.shotId * 16 - Math.round(s.vx + s.vy) % 16, s.x, s.y, s.weapon === "sniper" ? 12 : 6);
      this.drawTrail(pts, s.weapon === "sniper" ? "#ffffff" : col, s.weapon === "shotgun" ? 5 : 8, 0.85 * s.alpha);
      drawGlow(ctx, s.x, s.y, 20, col, 0.9 * s.alpha);
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(2.5, s.r * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawRocket(x: number, y: number, vx: number, vy: number, col: string, alpha: number) {
    const ctx = this.ctx;
    const a = Math.atan2(vy, vx);
    if (Math.random() < 0.7) this.fx.particles.spawn(x - Math.cos(a) * 16, y - Math.sin(a) * 16, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 0.5, 9, "#b9c4e8");
    drawGlow(ctx, x - Math.cos(a) * 14, y - Math.sin(a) * 14, 26, "#ff8a2b", 0.9 * alpha);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = "#e9ecff";
    ctx.beginPath();
    ctx.roundRect(-14, -5, 22, 10, 4);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(8, -5);
    ctx.lineTo(16, 0);
    ctx.lineTo(8, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-14, -8, 6, 16);
    ctx.restore();
  }

  private drawProjectiles(rc: RenderCtx, list: readonly NetProjectile[], f: FrameInput) {
    const ctx = this.ctx;
    for (const p of list) {
      // Hide the server copy of our own shot while the predicted one is still showing.
      if (p.owner === f.myId && p.shotId && f.shots.some((s) => s.shotId === p.shotId && s.alpha > 0.5)) continue;
      if (drawProjectileCustom(rc, p)) continue;
      let col = colorHex(f.colors(p.owner));
      if (p.kind === PROJ.rocket) {
        this.drawRocket(p.x, p.y, p.vx, p.vy, col, 1);
        continue;
      }
      if (p.kind === PROJ.grenade) {
        const gc = isThrowableId(p.source) ? GRENADE_COLORS[p.source] : "#ffffff";
        const blink = Math.sin(f.time * 16 + p.id) > 0;
        ctx.fillStyle = "#151830";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = gc;
        ctx.lineWidth = 3;
        ctx.stroke();
        if (blink) drawGlow(ctx, p.x, p.y, 22, gc, 0.9);
        continue;
      }
      if ((p.flags & PF.ricochet) !== 0) col = p.bounces >= 4 ? rainbow(f.time * 2 + p.id * 0.1) : ["#ffffff", "#7cf6ff", "#ff7bf2", "#ffd34d", "#9dff3a"][p.bounces] ?? col;
      const crit = (p.flags & PF.crit) !== 0;
      const sniper = p.weapon === "sniper";
      const pts = this.trail(p.id, p.x, p.y, crit || sniper ? 12 : 6);
      this.drawTrail(pts, crit ? "#ffd34d" : sniper ? "#ffffff" : col, p.kind === PROJ.clone || p.weapon === "shotgun" ? 5 : 8, 0.8);
      drawGlow(ctx, p.x, p.y, crit ? 34 : 22, crit ? "#ffd34d" : col, 0.9);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2.5, p.r * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayers(rc: RenderCtx, list: readonly NetPlayer[], f: FrameInput, mePos: { x: number; y: number } | null) {
    const now = performance.now();
    const map = this.map;
    for (const p of list) {
      if (!(p.flags & PFLAG.alive)) continue;
      const isMe = p.id === f.myId;
      const me = isMe ? f.me : null;
      const x = me && mePos ? mePos.x : p.x;
      const y = me && mePos ? mePos.y : p.y;
      // Precise client-side sight check (the server sends a little extra so nothing pops).
      if (!isMe && f.viewer && map && !canSeePoint(map, f.viewer.x, f.viewer.y, x, y, PLAYER.radius * 0.8)) continue;
      const cloaked = hasStatusBit(p.status, "cloaked");
      const alpha = cloaked ? (isMe ? 0.45 : f.seeCloaked ? 0.6 : 0.07) : 1;
      const col = colorHex(p.color);
      const dashing = (p.flags & PFLAG.dashing) !== 0 || (me ? me.dashT > 0 : false);
      if (dashing) {
        const pts = this.trail(p.id, x, y, 12);
        this.drawTrail(pts, col, 26, 0.6 * alpha);
        if (Math.random() < 0.8) this.fx.particles.spawn(x, y, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.35, 10, col);
      }
      if (cloaked && !isMe && Math.random() < 0.15) this.fx.particles.spawn(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30, 0, -20, 0.5, 4, "#ffffff");
      const weapon = me ? me.inv.weapons[me.inv.active]?.id ?? null : p.weapon;
      const rarity = me ? me.inv.weapons[me.inv.active]?.rarity ?? 0 : p.rarity;
      const act = me ? (me.reloadT > 0 ? ACT.reloading : 0) | (me.healKind ? ACT.healing : 0) | (me.swingT > 0 ? ACT.swinging : 0) : p.act;
      drawHero(rc.ctx, {
        id: p.id, x, y, aim: me ? me.aim : p.aim, color: col, colorIndex: p.color, name: f.names(p.id), hp: me ? Math.max(0, me.hp) : p.hp,
        armor: me ? me.armor : p.armor, weapon, rarity, isMe, alpha, ultReady: (p.flags & PFLAG.ultReady) !== 0, bountied: hasStatusBit(p.status, "bountied"),
        invulnerable: hasStatusBit(p.status, "invulnerable") && !dashing, slowed: hasStatusBit(p.status, "slowed") || hasStatusBit(p.status, "timeBubble") || hasStatusBit(p.status, "shocked"),
        disconnected: (p.flags & PFLAG.connected) === 0, colorblind: f.colorblind, invScale: rc.invScale, showBar: !isMe, time: f.time,
        anim: {
          speed: Math.hypot(p.vx, p.vy), dashing, reloading: (act & ACT.reloading) !== 0, healing: (act & ACT.healing) !== 0, charge: me ? me.charge : p.charge,
          swinging: (act & ACT.swinging) !== 0, sinceShot: (now - (this.shotAt.get(p.id) ?? -1e9)) / 1000, sinceHit: (now - (this.hitAt.get(p.id) ?? -1e9)) / 1000,
          airborne: hasStatusBit(p.status, "airborne") ? 1 : 0,
        },
      });
      if (hasStatusBit(p.status, "overdrive")) this.drawOverdrive(x, y);
    }
  }

  private drawOverdrive(x: number, y: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      let a = Math.random() * Math.PI * 2;
      ctx.moveTo(x + Math.cos(a) * 28, y + Math.sin(a) * 28);
      for (let s = 0; s < 4; s++) {
        a += (Math.random() - 0.5) * 1.2;
        const rr = 28 + Math.random() * 20;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHitboxes(view: View, f: FrameInput) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,120,0.9)";
    ctx.lineWidth = 1.5;
    for (const p of view.players) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (f.me) {
      ctx.strokeStyle = "rgba(255,255,0,0.9)";
      ctx.beginPath();
      ctx.arc(f.me.x, f.me.y, PLAYER.radius, 0, Math.PI * 2);
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
    if (this.map) {
      ctx.strokeStyle = "rgba(255,160,0,0.7)";
      const b = this.cam.bounds(0);
      for (const s of this.map.solids) if (!s.dead && s.x1 > b.x0 && s.x0 < b.x1 && s.y1 > b.y0 && s.y0 < b.y1) ctx.strokeRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
    }
    ctx.restore();
  }

  private post(w: number, h: number, dpr: number) {
    const ctx = this.ctx;
    const fx = this.fx;
    void dpr;
    if (fx.chroma > 0.02) {
      // Chromatic aberration: shifted red/blue copies of the frame, added on top.
      const shift = fx.chroma * 9 * this.cam.dpr;
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
