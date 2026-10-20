// The frame loop: input → prediction → send → interpolate → events → render → HUD.
// Hit-stop freezes only the visual clock (snapshots keep arriving and the view catches up);
// it never touches the server simulation.

import { BTN, FX, GHOST, hasStatusBit, LOOT, magSize, mapName, NET, PFLAG, PLAYER, SOLID_ID_BASE, weaponRange, WEAPONS, type NetLoot, type NetPlayer, type Player } from "@prism/shared";
import { audio } from "./audio/audio";
import { handleEvent, shotSound, type EventContext, type KillFeedItem } from "./fx/events";
import { Fx } from "./fx/fx";
import { capLabel, Input } from "./input/input";
import { session } from "./net/session";
import { Camera } from "./render/camera";
import { MenuScene } from "./render/menuScene";
import { colorHex } from "./render/palette";
import { Renderer } from "./render/renderer";
import { settings } from "./settings";
import { Hud } from "./ui/hud";
import { Reticle } from "./ui/reticle";

export class Game {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly input: Input;
  readonly cam = new Camera();
  readonly fx = new Fx();
  private renderer: Renderer;
  private menuScene = new MenuScene();
  readonly hud = new Hud();
  private reticle = new Reticle();
  private killFeed: KillFeedItem[] = [];
  private firedAt = new Map<number, number>();
  private last = performance.now();
  private time = 0;
  private visualTick = 0;
  private mapKey = "";
  private ec: EventContext;
  private lastCount = -1;
  private lastPhase = "";
  private wasRound = false;
  /** Who a dead player watches (their killer at first). */
  private spectateId = 0;
  private hauntReadyAt = 0;
  fps = 60;
  frameMs = 16;
  debugHitboxes = false;
  onFrame: () => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas, ctx, this.cam, this.fx);
    this.ec = {
      fx: this.fx, cam: this.cam, floor: null, myId: 0, killFeed: this.killFeed, firedAt: this.firedAt,
      colorOf: (id) => session.playerColor(id), nameOf: (id) => session.playerName(id),
      listener: () => ({ x: this.cam.x, y: this.cam.y }),
      banner: (t, s, c) => this.hud.banner(t, s, c),
      onSelfHit: () => this.hud.selfHit(),
      solidKind: (id) => session.view?.map.solids[id - SOLID_ID_BASE]?.kind ?? null,
      onEliminated: (killer) => {
        this.spectateId = killer;
      },
    };
    session.onGameEvent((e, imm) => {
      handleEvent(this.ec, e, imm);
      this.renderer.onEvent(e, performance.now());
      if (e.t === "hit" && e.by === session.myId && e.amount > 0 && e.target !== session.myId) this.reticle.onHit(e.crit);
      if (e.t === "kill" && e.killer === session.myId) this.reticle.onKill();
    });
    window.addEventListener("resize", () => this.resize());
    this.resize();
    canvas.addEventListener("mousedown", (e) => this.ghostClick(e));
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.cam.resize(w, h, dpr);
  }

  private frame(t: number) {
    const now = performance.now();
    const rawDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += rawDt;
    this.fps = this.fps * 0.95 + (rawDt > 0 ? 1 / rawDt : 60) * 0.05;
    const start = performance.now();
    this.input.pollGamepad();
    session.conn.tickStats();
    this.cam.shakeScale = settings.shake;
    try {
      this.step(rawDt, now);
    } catch (e) {
      console.error(e);
    }
    this.onFrame();
    this.input.endFrame();
    this.frameMs = this.frameMs * 0.9 + (performance.now() - start) * 0.1;
    requestAnimationFrame((tt) => this.frame(tt));
    void t;
  }

  private step(dt: number, now: number) {
    const phase = session.phase;
    const view = session.view;
    const inMatch = view && (phase === "countdown" || phase === "round");
    this.music(phase);
    if (!inMatch || !view) {
      this.wasRound = false;
      this.menuScene.draw(this.ctx, this.canvas.width, this.canvas.height, this.cam.dpr, this.time, dt);
      return;
    }
    this.ec.myId = session.myId;
    const key = `${session.mapId}|${session.seed}`;
    if (this.mapKey !== key) {
      this.mapKey = key;
      this.renderer.setMap(view.map);
      this.ec.floor = this.renderer.floor;
      this.fx.clear();
      this.hud.reset();
      this.killFeed.length = 0;
      this.spectateId = 0;
      this.visualTick = view.renderTick(now);
      if (view.me) this.cam.follow(view.me.x, view.me.y, 0, true);
    }

    // Countdown numbers
    if (phase === "countdown") {
      const n = Math.ceil(session.phaseRemaining(now));
      if (n !== this.lastCount && n > 0 && n <= 3) {
        this.lastCount = n;
        this.hud.countdown = { n, age: 0 };
        audio.sfx("countdown", 0, 0, { positional: false, pitch: 1 });
      }
      if (view.me) this.cam.follow(view.me.x, view.me.y, 0, true);
    }
    if (phase === "round" && !this.wasRound) {
      this.wasRound = true;
      // A text field that kept focus would swallow WASD; the fight gets the keyboard.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.input.clear();
      this.lastCount = -1;
      this.hud.countdown = { n: 0, age: 0 };
      audio.sfx("fight", 0, 0, { positional: false });
    }

    // Input + prediction (never frozen by hit-stop: your controls stay responsive)
    const me = view.me;
    let scoped = false;
    this.input.mask = session.shard ? BTN.slot1 | BTN.slot2 : 0;
    if (phase === "round" && me) {
      const mv = this.input.move();
      const aim = this.aimFrom(me.x + view.offX, me.y + view.offY);
      const b = this.input.buttons();
      const gun = me.inv.weapons[me.inv.active];
      scoped = !!gun && gun.id === "sniper" && (b.held & BTN.scope) !== 0;
      const out = view.predict(mv.x, mv.y, aim, b.held, b.pressed, dt);
      session.sendInput(out.frame);
      if (out.shots > 0 && gun) {
        this.reticle.onShoot();
        const c = colorHex(session.playerColor(session.myId));
        const mx = me.x + Math.cos(aim) * PLAYER.muzzle;
        const my = me.y + Math.sin(aim) * PLAYER.muzzle;
        this.fx.particles.cone(mx, my, gun.id === "shotgun" ? 8 : 4, aim, 0.6, c, 380, 0.18, 3);
        this.renderer.onEvent({ t: "shoot", by: session.myId, x: mx, y: my, angle: aim, weapon: gun.id }, now);
        shotSound(gun.id, me.x, me.y, true);
        this.cam.addTrauma(Math.min(0.12, WEAPONS[gun.id].recoil * 0.006));
      }
    } else if (phase === "round") {
      this.ghostControls(view.alive);
      // Keep acking snapshots while dead so deltas stay small.
      const ack = { seq: 0, mx: 0, my: 0, aim: 0, buttons: 0, pressed: 0, dt: 0, shotId: 0 };
      if (Math.floor(now / 100) !== Math.floor((now - dt * 1000) / 100)) session.sendInput(ack);
    }
    view.stepShots(dt, now);
    view.updateDebug(now);

    // Visual clock: hit-stop pauses it, then it catches up smoothly.
    let target = view.renderTick(now);
    let fxDt = dt;
    if (this.fx.hitStop > 0) {
      this.fx.hitStop -= dt;
      fxDt = 0;
      target = this.visualTick;
    }
    const gap = target - this.visualTick;
    if (gap > 6 || gap < -6) this.visualTick = target;
    else this.visualTick += Math.min(gap, dt * NET.tickRate * (gap > 0.5 ? 1.6 : 1.05));
    view.drainEvents(this.visualTick);

    const v = view.viewAt(this.visualTick, view.estServerTick(now));
    this.fx.update(fxDt);
    this.renderer.floor?.update(fxDt);

    // Camera: you (leading toward the mouse, wider while scoped), or who you spectate.
    const meX = me ? me.x + view.offX : 0;
    const meY = me ? me.y + view.offY : 0;
    let viewer: { x: number; y: number } | null = null;
    if (me) {
      viewer = { x: meX, y: meY };
      const mouse = this.input.usingPad ? null : this.cam.toWorld(this.input.mouseX, this.input.mouseY);
      const lead = scoped ? FX.camLead * 2.4 : FX.camLead;
      const lim = scoped ? 600 : 260;
      const lx = mouse ? (mouse.x - meX) * lead : Math.cos(this.input.padAim) * 120;
      const ly = mouse ? (mouse.y - meY) * lead : Math.sin(this.input.padAim) * 120;
      this.cam.follow(meX + Math.max(-lim, Math.min(lim, lx)), meY + Math.max(-lim * 0.8, Math.min(lim * 0.8, ly)), dt);
    } else if (v) {
      const t2 = this.spectateTarget(v.players);
      if (t2) {
        viewer = { x: t2.x, y: t2.y };
        this.cam.follow(t2.x, t2.y, dt);
      }
    }
    this.cam.zoom += ((scoped ? 1 / FX.scopeZoom : 1) - this.cam.zoom) * Math.min(1, dt * 6);
    this.cam.update(fxDt || dt * 0.2, this.time);
    audio.setListener(this.cam.x, this.cam.y);
    audio.matchFrame(v ?? null, this.cam, phase, me ? me.hp : null);

    const interact = me && v ? this.interactTarget(me, v.loot) : null;
    const selfBits = view.self?.status ?? 0;
    this.renderer.render({
      view: v, me, meOff: { x: view.offX, y: view.offY }, shots: view.shots, myId: session.myId,
      myColor: session.playerColor(session.myId), names: (id) => session.playerName(id), colors: (id) => session.playerColor(id),
      time: this.time, dt: fxDt, colorblind: settings.colorblind, intensity: this.intensity(), seeCloaked: hasStatusBit(selfBits, "hunter"),
      debugHitboxes: this.debugHitboxes, viewer, interact, interactKey: capLabel(this.input.binds.interact),
    });

    const revealed = new Set<number>();
    for (const [id, at] of this.firedAt) if (now - at < FX.fireRevealSeconds * 1000) revealed.add(id);
    this.hud.draw(this.ctx, {
      w: this.cam.w, h: this.cam.h, dpr: this.cam.dpr, self: view.self && me ? view.self : null, me, g: v?.g ?? null,
      players: v?.players ?? [], effects: v?.effects ?? [], map: view.map, mapName: mapName(session.mapId), myId: session.myId,
      meX: me ? meX : this.cam.x, meY: me ? meY : this.cam.y, names: (id) => session.playerName(id), colors: (id) => session.playerColor(id),
      killFeed: this.killFeed, ping: session.rtt, showPing: settings.showPing, fps: this.fps, showFps: settings.showFps || this.debugHitboxes,
      time: this.time, dt, input: this.input, colorblind: settings.colorblind, revealed, huntersEye: hasStatusBit(selfBits, "hunter"),
      interact, fighters: session.playerCount,
    });
    // The reticle replaces the mouse cursor while you're alive in a round.
    const showReticle = phase === "round" && !!me && !this.input.usingPad && !session.shard;
    this.canvas.style.cursor = showReticle ? "none" : "crosshair";
    const ps = this.cam.toScreen(meX, meY);
    const gun = me?.inv.weapons[me.inv.active] ?? null;
    const def = gun ? WEAPONS[gun.id] : WEAPONS.pistol;
    this.reticle.draw(this.ctx, {
      dpr: this.cam.dpr, mx: this.input.mouseX, my: this.input.mouseY, px: ps.x, py: ps.y, scale: this.cam.scale,
      mag: gun?.mag ?? 0, magSize: gun ? magSize(gun) : 0, reload: me && me.reloadT > 0 ? 1 - me.reloadT / def.reload : -1,
      range: weaponRange(gun?.id ?? "pistol"), spread: def.kind === "shotgun" ? def.spread : def.spread + (me?.bloom ?? 0), charge: me?.charge ?? 0,
      color: colorHex(session.playerColor(session.myId)), dt, visible: showReticle,
    });
  }

  /** The item F would pick up: nearest weapon (or a different grenade type) in reach. */
  private interactTarget(me: Player, loot: readonly NetLoot[]): NetLoot | null {
    let best: NetLoot | null = null;
    let bd = LOOT.interactRange ** 2;
    for (const l of loot) {
      if (l.kind !== "weapon" && !(l.kind === "throwable" && me.inv.throwable && me.inv.throwable !== l.throwable)) continue;
      const d = (l.x - me.x) ** 2 + (l.y - me.y) ** 2;
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  /** Mouse (or right stick) aim relative to the predicted player's screen position. */
  private aimFrom(x: number, y: number): number {
    if (this.input.usingPad) return this.input.padAim;
    const w = this.cam.toWorld(this.input.mouseX, this.input.mouseY);
    return Math.atan2(w.y - y, w.x - x);
  }

  private spectateTarget(players: NetPlayer[]): NetPlayer | undefined {
    const alive = players.filter((p) => (p.flags & PFLAG.alive) !== 0);
    return alive.find((p) => p.id === this.spectateId) ?? alive[0];
  }

  /** Dead: watch your killer, cycle through the survivors, and haunt as a ghost. */
  private ghostControls(alive: readonly number[]) {
    const list = alive.filter((id) => id !== session.myId);
    if (!list.length) return;
    let i = list.indexOf(this.spectateId);
    if (i < 0) i = 0;
    if (this.input.keyPressed("ArrowRight") || this.input.keyPressed("ArrowDown") || this.input.pressed("swap")) i++;
    if (this.input.keyPressed("ArrowLeft") || this.input.keyPressed("ArrowUp")) i--;
    const next = list[((i % list.length) + list.length) % list.length] ?? 0;
    if (next !== this.spectateId) {
      this.spectateId = next;
      session.spectate(next);
    }
    const now = performance.now();
    const kind = this.input.pressed("p1") ? "lava" : this.input.pressed("p2") ? "slow" : null;
    if (kind && now >= this.hauntReadyAt) {
      const w = this.cam.toWorld(this.input.mouseX, this.input.mouseY);
      session.haunt(kind, w.x, w.y);
      this.hauntReadyAt = now + GHOST.hauntCooldown * 1000;
    }
  }

  private ghostClick(e: MouseEvent) {
    if (session.phase !== "round" || session.view?.me || e.button !== 0) return;
    const list = (session.view?.alive ?? []).filter((id) => id !== session.myId);
    if (!list.length) return;
    const i = list.indexOf(this.spectateId);
    this.spectateId = list[(i + 1) % list.length] ?? 0;
    session.spectate(this.spectateId);
  }

  /** Seconds until the ghost can haunt again (for the spectator bar). */
  hauntCooldown(): number {
    return Math.max(0, (this.hauntReadyAt - performance.now()) / 1000);
  }

  spectatingName(): string {
    return this.spectateId ? session.playerName(this.spectateId) : "";
  }

  private intensity(): number {
    const g = session.view?.latest?.g;
    if (!g) return 0;
    const stage = g.stage < 0 ? 0 : (g.stage + 1) / 6;
    const few = 1 - (g.alive - 1) / Math.max(1, session.playerCount - 1);
    return Math.max(0, Math.min(1, stage * 0.65 + few * 0.45));
  }

  private music(phase: string) {
    if (phase === "round" || phase === "countdown") {
      audio.startMusic(0.34, "game");
      audio.music?.setIntensity(this.intensity());
    } else if (phase === "menu" || phase === "lobby") {
      audio.startMusic(0.18, "menu");
    } else {
      audio.startMusic(0.24, "game");
      audio.music?.setIntensity(0.2);
    }
    if (phase !== this.lastPhase) {
      if (phase === "matchEnd") audio.sting(session.matchEnd?.winnerId === session.myId ? "win" : "lose");
      this.lastPhase = phase;
    }
  }
}
