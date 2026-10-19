// The frame loop: input → prediction → send → interpolate → events → render → HUD.
// Hit-stop freezes only the visual clock (snapshots keep arriving and the view catches up),
// and the slow-mo replay re-plays buffered snapshots. Neither touches the server simulation.

import { FX, GHOST, hasStatusBit, MATCH, NET, PFLAG, type NetPlayer } from "@prism/shared";
import { audio } from "./audio/audio";
import { handleEvent, type EventContext, type KillFeedItem } from "./fx/events";
import { Fx } from "./fx/fx";
import { Input } from "./input/input";
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
  private arenaSeed = -1;
  private ec: EventContext;
  private lastCount = -1;
  private lastPhase = "";
  private wasRound = false;
  private replay: { tick: number; end: number; lastEventTick: number } | null = null;
  private spectateIdx = 0;
  private hauntReadyAt = 0;
  fps = 60;
  frameMs = 16;
  debugHitboxes = false;
  scoreboardOpen = false;
  onFrame: () => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas, ctx, this.cam, this.fx);
    this.ec = {
      fx: this.fx, cam: this.cam, floor: null, myId: 0, killFeed: this.killFeed, replaying: false, firedAt: this.firedAt,
      colorOf: (id) => session.playerColor(id), nameOf: (id) => session.playerName(id),
      listener: () => ({ x: this.cam.x, y: this.cam.y }),
      banner: (t, s, c) => this.hud.banner(t, s, c),
      onSelfHit: () => this.hud.selfHit(),
    };
    session.onGameEvent((e, imm) => {
      handleEvent(this.ec, e, imm);
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
    const inMatch = view && (phase === "countdown" || phase === "round" || phase === "replay");
    this.music(phase, view?.latest?.g.stage ?? -1, view?.latest?.g.alive ?? 5);
    if (!inMatch || !view) {
      this.wasRound = false;
      this.replay = null;
      this.menuScene.draw(this.ctx, this.canvas.width, this.canvas.height, this.cam.dpr, this.time, dt);
      return;
    }
    this.ec.myId = session.myId;
    if (this.arenaSeed !== session.seed) {
      this.arenaSeed = session.seed;
      this.renderer.setArena(view.arena);
      this.ec.floor = this.renderer.floor;
      this.fx.clear();
      this.hud.reset();
      this.killFeed.length = 0;
      this.visualTick = view.renderTick(now);
      this.cam.follow(0, 0, 0, true);
    }

    // Countdown numbers
    if (phase === "countdown") {
      const n = Math.ceil(session.phaseRemaining(now));
      if (n !== this.lastCount && n > 0 && n <= 3) {
        this.lastCount = n;
        this.hud.countdown = { n, age: 0 };
        audio.sfx("countdown", 0, 0, { positional: false, pitch: 1 });
      }
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
    const meAlive = !!view.me;
    if (phase === "round" && meAlive && view.me) {
      const mv = this.input.move();
      const aim = this.aimFrom(view.me.x + view.offX, view.me.y + view.offY);
      const b = this.input.buttons();
      const frame = view.predict(mv.x, mv.y, aim, b.held, b.pressed, dt);
      if (frame) {
        session.sendInput(frame);
        if (frame.shotId) this.reticle.onShoot();
      }
    } else if (phase === "round") {
      this.ghostControls(view.latest?.ents ? [...view.viewAt(view.renderTick(now))?.players ?? []] : []);
      // Keep acking snapshots while dead so deltas stay small.
      const ack = { seq: 0, mx: 0, my: 0, aim: 0, buttons: 0, pressed: 0, dt: 0, shotId: 0 };
      if (Math.floor(now / 100) !== Math.floor((now - dt * 1000) / 100)) session.sendInput(ack);
    }
    view.stepShots(dt, now);
    view.updateDebug(now);

    // Visual clock: hit-stop pauses it, then it catches up smoothly.
    let target = view.renderTick(now);
    let fxDt = dt;
    if (phase === "replay" && session.roundEnd) {
      target = this.replayTick(dt);
      fxDt = dt * MATCH.replaySpeed;
    } else if (this.fx.hitStop > 0) {
      this.fx.hitStop -= dt;
      fxDt = 0;
      target = this.visualTick;
    }
    if (phase !== "replay") {
      const gap = target - this.visualTick;
      if (gap > 6 || gap < -6) this.visualTick = target;
      else this.visualTick += Math.min(gap, dt * NET.tickRate * (gap > 0.5 ? 1.6 : 1.05));
      view.drainEvents(this.visualTick);
    } else this.visualTick = target;

    const v = view.viewAt(this.visualTick, phase === "replay" ? undefined : view.estServerTick(now));
    this.fx.update(fxDt);
    this.renderer.floor?.update(fxDt);

    // Camera
    const meX = view.me ? view.me.x + view.offX : 0;
    const meY = view.me ? view.me.y + view.offY : 0;
    if (phase === "replay" && session.roundEnd && v) {
      const killer = v.players.find((p) => p.id === session.roundEnd?.killerId) ?? v.players.find((p) => p.id === session.roundEnd?.winnerId);
      const victim = v.players.find((p) => p.id === session.roundEnd?.victimId);
      const fx2 = killer && victim ? (killer.x + victim.x) / 2 : killer?.x ?? victim?.x ?? this.cam.x;
      const fy2 = killer && victim ? (killer.y + victim.y) / 2 : killer?.y ?? victim?.y ?? this.cam.y;
      this.cam.follow(fx2, fy2, dt);
      this.cam.focusZoom += (1.55 - this.cam.focusZoom) * Math.min(1, dt * 2.5);
    } else if (view.me) {
      const mouse = this.input.usingPad ? null : this.cam.toWorld(this.input.mouseX, this.input.mouseY);
      const lx = mouse ? (mouse.x - meX) * FX.camLead : Math.cos(this.input.padAim) * 120;
      const ly = mouse ? (mouse.y - meY) * FX.camLead : Math.sin(this.input.padAim) * 120;
      this.cam.follow(meX + Math.max(-260, Math.min(260, lx)), meY + Math.max(-200, Math.min(200, ly)), dt);
      this.cam.focusZoom += (1 - this.cam.focusZoom) * Math.min(1, dt * 3);
    } else if (v) {
      const target2 = this.spectateTarget(v.players);
      if (target2) this.cam.follow(target2.x, target2.y, dt);
      this.cam.focusZoom += (1 - this.cam.focusZoom) * Math.min(1, dt * 3);
    }
    this.cam.update(fxDt || dt * 0.2, this.time);
    audio.setListener(this.cam.x, this.cam.y);
    audio.matchFrame(v ?? null, this.cam, phase, view.me ? view.me.hp : null);

    const selfBits = view.self?.status ?? 0;
    this.renderer.render({
      view: v, me: view.me, meOff: { x: view.offX, y: view.offY }, shots: phase === "replay" ? [] : view.shots, myId: session.myId,
      myColor: session.playerColor(session.myId), names: (id) => session.playerName(id), colors: (id) => session.playerColor(id),
      time: this.time, dt: fxDt, colorblind: settings.colorblind, intensity: this.intensity(), seeCloaked: hasStatusBit(selfBits, "hunter"),
      debugHitboxes: this.debugHitboxes,
    });

    if (phase !== "replay") {
      const revealed = new Set<number>();
      for (const [id, at] of this.firedAt) if (now - at < FX.fireRevealSeconds * 1000) revealed.add(id);
      this.hud.draw(this.ctx, {
        w: this.cam.w, h: this.cam.h, dpr: this.cam.dpr, self: view.self && view.me ? view.self : null, ammo: view.hudAmmo, g: v?.g ?? null,
        players: v?.players ?? [], myId: session.myId, meX: view.me ? meX : this.cam.x, meY: view.me ? meY : this.cam.y,
        arenaRadius: view.arena.radius, names: (id) => session.playerName(id), colors: (id) => session.playerColor(id),
        killFeed: this.killFeed, ping: session.rtt, showPing: settings.showPing, fps: this.fps, showFps: settings.showFps || this.debugHitboxes,
        time: this.time, dt, input: this.input, colorblind: settings.colorblind, revealed, huntersEye: hasStatusBit(selfBits, "hunter"), round: session.round,
      });
      // The reticle replaces the mouse cursor while you're alive in a round.
      const showReticle = phase === "round" && !!view.me && !this.input.usingPad;
      this.canvas.style.cursor = showReticle ? "none" : "crosshair";
      const ps = this.cam.toScreen(meX, meY);
      this.reticle.draw(this.ctx, {
        dpr: this.cam.dpr, mx: this.input.mouseX, my: this.input.mouseY, px: ps.x, py: ps.y, scale: this.cam.scale,
        ammo: view.hudAmmo.ammo, reload: view.hudAmmo.reload, color: colorHex(session.playerColor(session.myId)), dt, visible: showReticle,
      });
    }
  }

  /** Mouse (or right stick) aim relative to the predicted player's screen position. */
  private aimFrom(x: number, y: number): number {
    if (this.input.usingPad) return this.input.padAim;
    const w = this.cam.toWorld(this.input.mouseX, this.input.mouseY);
    return Math.atan2(w.y - y, w.x - x);
  }

  private replayTick(dt: number): number {
    const re = session.roundEnd;
    const view = session.view;
    if (!re || !view) return this.visualTick;
    if (!this.replay) {
      const first = view.states[0]?.tick ?? re.killTick;
      const start = Math.max(first, re.killTick - MATCH.replayWindowBefore * NET.tickRate);
      this.replay = { tick: start, end: re.killTick + MATCH.replayWindowAfter * NET.tickRate, lastEventTick: start };
      this.fx.timeScale = MATCH.replaySpeed;
    }
    const r = this.replay;
    r.tick = Math.min(r.end, r.tick + dt * NET.tickRate * MATCH.replaySpeed);
    // Re-play the buffered events as we pass them (visuals only).
    this.ec.replaying = true;
    for (const s of view.states) if (s.tick > r.lastEventTick && s.tick <= r.tick) for (const e of s.events) handleEvent(this.ec, e, false);
    this.ec.replaying = false;
    r.lastEventTick = r.tick;
    return r.tick;
  }

  private spectateTarget(players: NetPlayer[]): NetPlayer | undefined {
    const alive = players.filter((p) => (p.flags & PFLAG.alive) !== 0);
    if (!alive.length) return undefined;
    return alive[((this.spectateIdx % alive.length) + alive.length) % alive.length];
  }

  private ghostControls(players: NetPlayer[]) {
    const alive = players.filter((p) => (p.flags & PFLAG.alive) !== 0);
    if (this.input.keyPressed("ArrowRight") || this.input.keyPressed("ArrowDown")) this.spectateIdx++;
    if (this.input.keyPressed("ArrowLeft") || this.input.keyPressed("ArrowUp")) this.spectateIdx--;
    const t = this.spectateTarget(players);
    if (t && alive.length) session.spectate(t.id);
    const now = performance.now();
    const kind = this.input.pressed("p1") ? "lava" : this.input.pressed("p2") ? "slow" : null;
    if (kind && now >= this.hauntReadyAt) {
      const w = this.cam.toWorld(this.input.mouseX, this.input.mouseY);
      session.haunt(kind, w.x, w.y);
      this.hauntReadyAt = now + GHOST.hauntCooldown * 1000;
    }
  }

  private ghostClick(e: MouseEvent) {
    if (session.phase !== "round" || session.view?.me) return;
    if (e.button === 0) this.spectateIdx++;
  }

  /** Seconds until the ghost can haunt again (for the spectator bar). */
  hauntCooldown(): number {
    return Math.max(0, (this.hauntReadyAt - performance.now()) / 1000);
  }

  spectatingName(): string {
    const v = session.view;
    if (!v) return "";
    const players = v.viewAt(v.renderTick(performance.now()))?.players ?? [];
    const t = this.spectateTarget(players);
    return t ? session.playerName(t.id) : "";
  }

  private intensity(): number {
    const g = session.view?.latest?.g;
    if (!g) return 0;
    const stage = g.stage < 0 ? 0 : (g.stage + 1) / 5;
    const few = 1 - (g.alive - 1) / Math.max(1, session.playerCount - 1);
    return Math.max(0, Math.min(1, stage * 0.65 + few * 0.45));
  }

  private music(phase: string, _stage: number, _alive: number) {
    if (phase === "round" || phase === "countdown" || phase === "replay") {
      audio.startMusic(0.34, "game");
      audio.music?.setIntensity(this.intensity());
    } else if (phase === "menu" || phase === "lobby") {
      audio.startMusic(0.18, "menu");
    } else {
      audio.startMusic(0.24, "game");
      audio.music?.setIntensity(0.2);
    }
    // Stings: when the final blow replay starts, and when the match ends.
    if (phase !== this.lastPhase) {
      if (phase === "replay") audio.sting("roundEnd");
      if (phase === "matchEnd") audio.sting(session.matchEnd?.winnerId === session.myId ? "win" : "lose");
      this.lastPhase = phase;
    }
  }
}
