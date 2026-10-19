// Effect lifecycle audio. Each frame we diff the interpolated effects (and a few projectile
// kinds) against the last frame: new ids play `fx:<kind>:on`, vanished ids play
// `fx:<kind>:off`, and persistent effects near the listener get a positional LOOP (one small
// shared graph per effect) whose gain and pan follow the camera. Loops are capped and the
// farthest are released first; if tracking stops being called (menus, replay) everything
// fades out on its own.

import { PROJ, type EffectKind, type NetEffect, type NetProjectile } from "@prism/shared";

export interface EffectAudioHost {
  sfx(name: string, x: number, y: number, opts?: { gain?: number }): void;
  loopOutput(): { ctx: AudioContext; bus: AudioNode; noise: AudioBuffer } | null;
  hasRecipe(name: string): boolean;
}

export interface TrackedView {
  effects: readonly NetEffect[];
  projectiles: readonly NetProjectile[];
}

interface Point {
  x: number;
  y: number;
}

/** A loop source: either an effect or a projectile, normalized. */
interface LoopSubject {
  key: string;
  kind: LoopKind;
  x: number;
  y: number;
  /** 0..1 through its lifetime (for pitch rises / falls). */
  progress: number;
  speed: number;
  dist: number;
}

type LoopKind = "singularity" | "bubble" | "magnet" | "molten" | "lava" | "tether" | "glaive" | "portal" | "meteorWarn" | "rift" | "finalStand" | "slowField" | "orb" | "gravityOrb";

interface LoopGraph {
  sources: AudioScheduledSourceNode[];
  /** Per-frame parameter follow (pitch from progress or speed). */
  follow?: (s: LoopSubject, t: number) => void;
}

interface ActiveLoop {
  kind: LoopKind;
  vol: GainNode;
  pan: StereoPannerNode;
  graph: LoopGraph;
  released: boolean;
}

const MAX_LOOPS = 6;
const LOOP_RANGE = 1300;
const SPAWN_MAX_AGE = 0.35;
const ONESHOT_GAP_MS = 60;
const STALE_MS = 300;
const PER_KIND_CAP: Partial<Record<LoopKind, number>> = { meteorWarn: 3, lava: 1, portal: 2 };

/** Loop level per kind before distance falloff (peaks of the built graphs are ~1). */
const LOOP_LEVEL: Record<LoopKind, number> = {
  singularity: 0.2, bubble: 0.1, magnet: 0.11, molten: 0.09, lava: 0.06, tether: 0.08, glaive: 0.1, portal: 0.035,
  meteorWarn: 0.06, rift: 0.16, finalStand: 0.1, slowField: 0.06, orb: 0.06, gravityOrb: 0.06,
};

const EFFECT_LOOP: Partial<Record<EffectKind, LoopKind>> = {
  singularity: "singularity", bubble: "bubble", magnet: "magnet", molten: "molten", lava: "lava", tether: "tether", glaive: "glaive",
  portal: "portal", meteorWarn: "meteorWarn", rift: "rift", finalStand: "finalStand", slowField: "slowField",
};

const falloff = (d: number) => Math.min(1, 1 / (1 + (d / 420) ** 2) + 0.05);

/** Closest point on segment a-b to p (tethers and rifts sound from their nearest part). */
function nearestOnSegment(ax: number, ay: number, bx: number, by: number, p: Point): Point {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return { x: ax, y: ay };
  const k = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
  return { x: ax + dx * k, y: ay + dy * k };
}

export class EffectSounds {
  private seen = new Map<number, NetEffect>();
  private loops = new Map<string, ActiveLoop>();
  private lastShot = new Map<string, number>();
  private lastCall = 0;
  private primed = false;
  private watchdog = 0;

  constructor(private host: EffectAudioHost) {}

  track(view: TrackedView, listener: Point) {
    const now = performance.now();
    if (now - this.lastCall > STALE_MS) this.primed = false;
    this.lastCall = now;
    if (!this.watchdog) this.watchdog = window.setInterval(() => this.checkStale(), 200);
    this.lifecycle(view.effects, listener, now);
    this.updateLoops(view, listener);
  }

  /** Fades out every loop and forgets the effects (next track() re-primes silently). */
  reset() {
    for (const key of [...this.loops.keys()]) this.release(key);
    this.seen.clear();
    this.primed = false;
  }

  private checkStale() {
    if (performance.now() - this.lastCall <= STALE_MS) return;
    this.reset();
    window.clearInterval(this.watchdog);
    this.watchdog = 0;
  }

  private lifecycle(effects: readonly NetEffect[], listener: Point, now: number) {
    const current = new Map<number, NetEffect>();
    for (const e of effects) current.set(e.id, e);
    if (this.primed) {
      for (const [id, e] of current) {
        if (!this.seen.has(id) && e.age <= SPAWN_MAX_AGE) this.oneShot(`fx:${e.kind}:on`, this.soundPos(e, listener), listener, now);
      }
      for (const [id, e] of this.seen) {
        if (!current.has(id)) this.oneShot(`fx:${e.kind}:off`, this.soundPos(e, listener), listener, now);
      }
    }
    this.seen = current;
    this.primed = true;
  }

  private oneShot(name: string, p: Point, listener: Point, now: number) {
    if (!this.host.hasRecipe(name)) return;
    if (Math.hypot(p.x - listener.x, p.y - listener.y) > LOOP_RANGE) return;
    // Bursts of identical sounds (5 decoys popping at once) play once per short window.
    if (now - (this.lastShot.get(name) ?? -1e9) < ONESHOT_GAP_MS) return;
    this.lastShot.set(name, now);
    this.host.sfx(name, p.x, p.y);
  }

  private soundPos(e: NetEffect, listener: Point): Point {
    if (e.kind === "tether" || e.kind === "rift") return nearestOnSegment(e.x, e.y, e.x2, e.y2, listener);
    return { x: e.x, y: e.y };
  }

  private subjects(view: TrackedView, listener: Point): LoopSubject[] {
    const out: LoopSubject[] = [];
    const add = (key: string, kind: LoopKind, p: Point, progress: number, speed: number) => {
      const dist = Math.hypot(p.x - listener.x, p.y - listener.y);
      if (dist <= LOOP_RANGE) out.push({ key, kind, x: p.x, y: p.y, progress, speed, dist });
    };
    for (const e of view.effects) {
      const kind = EFFECT_LOOP[e.kind];
      if (!kind) continue;
      const progress = e.life > 0 ? Math.max(0, Math.min(1, e.age / e.life)) : 0;
      add(`e${e.id}`, kind, this.soundPos(e, listener), progress, Math.hypot(e.vx, e.vy));
    }
    for (const p of view.projectiles) {
      if (p.kind === PROJ.singularityOrb) add(`p${p.id}`, "orb", p, 0, Math.hypot(p.vx, p.vy));
      else if (p.kind === PROJ.gravity) add(`p${p.id}`, "gravityOrb", p, 0, Math.hypot(p.vx, p.vy));
    }
    out.sort((a, b) => a.dist - b.dist);
    const perKind = new Map<LoopKind, number>();
    const picked: LoopSubject[] = [];
    for (const s of out) {
      if (picked.length >= MAX_LOOPS) break;
      const n = perKind.get(s.kind) ?? 0;
      if (n >= (PER_KIND_CAP[s.kind] ?? 2)) continue;
      perKind.set(s.kind, n + 1);
      picked.push(s);
    }
    return picked;
  }

  private updateLoops(view: TrackedView, listener: Point) {
    const io = this.host.loopOutput();
    if (!io) return;
    const wanted = this.subjects(view, listener);
    const keep = new Set(wanted.map((s) => s.key));
    for (const key of [...this.loops.keys()]) if (!keep.has(key)) this.release(key);
    const t = io.ctx.currentTime;
    for (const s of wanted) {
      let loop = this.loops.get(s.key);
      if (!loop) {
        loop = this.create(io.ctx, io.bus, io.noise, s.kind);
        this.loops.set(s.key, loop);
      }
      const target = LOOP_LEVEL[s.kind] * falloff(s.dist);
      loop.vol.gain.setTargetAtTime(target, t, 0.06);
      loop.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (s.x - listener.x) / 700)), t, 0.05);
      loop.graph.follow?.(s, t);
    }
  }

  private release(key: string) {
    const loop = this.loops.get(key);
    if (!loop) return;
    this.loops.delete(key);
    if (loop.released) return;
    loop.released = true;
    const t = loop.vol.context.currentTime;
    loop.vol.gain.cancelScheduledValues(t);
    loop.vol.gain.setTargetAtTime(0, t, 0.05);
    for (const s of loop.graph.sources) s.stop(t + 0.4);
    window.setTimeout(() => loop.pan.disconnect(), 500);
  }

  private create(ctx: AudioContext, bus: AudioNode, noise: AudioBuffer, kind: LoopKind): ActiveLoop {
    const vol = ctx.createGain();
    vol.gain.value = 0;
    const pan = ctx.createStereoPanner();
    vol.connect(pan).connect(bus);
    const graph = buildLoop(ctx, noise, kind, vol);
    const t = ctx.currentTime;
    for (const s of graph.sources) {
      if (s instanceof AudioBufferSourceNode) s.start(t, Math.random() * 0.5);
      else s.start(t);
    }
    return { kind, vol, pan, graph, released: false };
  }
}

// ---- loop graphs ------------------------------------------------------------------------------
// Every graph peaks around 1.0 into `out`; LOOP_LEVEL scales it. Sources are started by the caller.

function osc(ctx: AudioContext, type: OscillatorType, f: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  return o;
}

function gain(ctx: AudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function filter(ctx: AudioContext, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function noiseSrc(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  return s;
}

/** Amplitude modulation stage: returns a gain whose level swings by `depth` at `rate`. */
function amStage(ctx: AudioContext, rate: number, depth: number, type: OscillatorType, sources: AudioScheduledSourceNode[]): GainNode {
  const g = gain(ctx, 1 - depth);
  const lfo = osc(ctx, type, rate);
  lfo.connect(gain(ctx, depth)).connect(g.gain);
  sources.push(lfo);
  return g;
}

function buildLoop(ctx: AudioContext, buf: AudioBuffer, kind: LoopKind, out: AudioNode): LoopGraph {
  const sources: AudioScheduledSourceNode[] = [];
  switch (kind) {
    case "singularity": {
      // Deep beating sub with a warbling overtone.
      const a = osc(ctx, "sine", 46);
      const b = osc(ctx, "sine", 48.5);
      const c = osc(ctx, "triangle", 92);
      const lfo = osc(ctx, "sine", 5);
      lfo.connect(gain(ctx, 60)).connect(c.detune);
      const mix = gain(ctx, 0.5);
      a.connect(mix);
      b.connect(mix);
      c.connect(gain(ctx, 0.5)).connect(mix);
      mix.connect(out);
      sources.push(a, b, c, lfo);
      return { sources };
    }
    case "bubble": {
      // Slow, wide drone with a lazy tremolo.
      const a = osc(ctx, "sine", 220);
      const b = osc(ctx, "sine", 221.7);
      const c = osc(ctx, "triangle", 110);
      const am = amStage(ctx, 0.8, 0.3, "sine", sources);
      const lp = filter(ctx, "lowpass", 700);
      for (const o of [a, b, c]) o.connect(lp);
      lp.connect(am).connect(gain(ctx, 0.5)).connect(out);
      sources.push(a, b, c);
      return { sources };
    }
    case "magnet": {
      // Magnetic hum that tightens (rises) over its lifetime.
      const a = osc(ctx, "sawtooth", 60);
      const b = osc(ctx, "sine", 120);
      const lp = filter(ctx, "lowpass", 420, 3);
      const am = amStage(ctx, 9, 0.3, "sine", sources);
      a.connect(lp);
      b.connect(gain(ctx, 0.6)).connect(lp);
      lp.connect(am).connect(gain(ctx, 0.8)).connect(out);
      sources.push(a, b);
      return {
        sources,
        follow: (s, t) => {
          a.frequency.setTargetAtTime(60 + s.progress * 30, t, 0.1);
          b.frequency.setTargetAtTime(120 + s.progress * 60, t, 0.1);
        },
      };
    }
    case "molten":
    case "lava": {
      // Crackling sizzle over a low roar.
      const n = noiseSrc(ctx, buf);
      const hp = filter(ctx, "highpass", 3200);
      const crackle = amStage(ctx, 13, 0.5, "square", sources);
      const lp = filter(ctx, "lowpass", 320);
      n.connect(hp).connect(crackle).connect(gain(ctx, 0.5)).connect(out);
      n.connect(lp).connect(gain(ctx, 1.2)).connect(out);
      sources.push(n);
      return { sources };
    }
    case "tether": {
      // Electric buzz: two saws through a resonant band, chopped, with crackle on top.
      const a = osc(ctx, "sawtooth", 70);
      const b = osc(ctx, "sawtooth", 140.7);
      const bp = filter(ctx, "bandpass", 900, 2);
      const chop = amStage(ctx, 17, 0.35, "square", sources);
      a.connect(bp);
      b.connect(bp);
      bp.connect(chop).connect(gain(ctx, 1.4)).connect(out);
      const n = noiseSrc(ctx, buf);
      const hp = filter(ctx, "highpass", 4500);
      const spit = amStage(ctx, 23, 0.5, "square", sources);
      n.connect(hp).connect(spit).connect(gain(ctx, 0.25)).connect(out);
      sources.push(a, b, n);
      return { sources };
    }
    case "glaive": {
      // Whirring blade: a chopped resonant band whose pitch follows speed.
      const a = osc(ctx, "sawtooth", 220);
      const bp = filter(ctx, "bandpass", 1800, 6);
      const whirr = amStage(ctx, 22, 0.5, "sine", sources);
      a.connect(bp).connect(whirr).connect(gain(ctx, 2.2)).connect(out);
      sources.push(a);
      return {
        sources,
        follow: (s, t) => {
          const k = Math.min(1.5, 0.6 + s.speed / 900);
          bp.frequency.setTargetAtTime(1800 * k, t, 0.08);
        },
      };
    }
    case "portal": {
      // Faint phasing shimmer.
      const a = osc(ctx, "sine", 330);
      const b = osc(ctx, "sine", 495);
      const lfo = osc(ctx, "sine", 0.6);
      lfo.connect(gain(ctx, 30)).connect(a.detune);
      a.connect(out);
      b.connect(gain(ctx, 0.4)).connect(out);
      sources.push(a, b, lfo);
      return { sources };
    }
    case "meteorWarn": {
      // Incoming whistle: falls from high to low as the impact approaches.
      const a = osc(ctx, "sine", 2400);
      a.connect(out);
      sources.push(a);
      return { sources, follow: (s, t) => a.frequency.setTargetAtTime(2400 * 0.15 ** s.progress, t, 0.04) };
    }
    case "rift": {
      // Low growling rumble.
      const a = osc(ctx, "sawtooth", 41);
      const lp = filter(ctx, "lowpass", 260, 2);
      const throb = amStage(ctx, 6, 0.4, "sine", sources);
      const n = noiseSrc(ctx, buf);
      const nlp = filter(ctx, "lowpass", 200);
      a.connect(lp);
      n.connect(nlp).connect(gain(ctx, 1.5)).connect(lp);
      lp.connect(throb).connect(gain(ctx, 0.9)).connect(out);
      sources.push(a, n);
      return { sources, follow: (s, t) => lp.frequency.setTargetAtTime(260 + s.progress * 500, t, 0.1) };
    }
    case "finalStand": {
      // Charging: a detuned saw pair rising over the charge time.
      const a = osc(ctx, "sawtooth", 110, -8);
      const b = osc(ctx, "sawtooth", 110, 8);
      const lp = filter(ctx, "lowpass", 900, 4);
      a.connect(lp);
      b.connect(lp);
      lp.connect(gain(ctx, 0.6)).connect(out);
      sources.push(a, b);
      return {
        sources,
        follow: (s, t) => {
          const f = 110 * 4 ** s.progress;
          a.frequency.setTargetAtTime(f, t, 0.05);
          b.frequency.setTargetAtTime(f, t, 0.05);
          lp.frequency.setTargetAtTime(900 + s.progress * 2500, t, 0.05);
        },
      };
    }
    case "slowField": {
      const a = osc(ctx, "sine", 160);
      const b = osc(ctx, "sine", 161.3);
      a.connect(gain(ctx, 0.5)).connect(out);
      b.connect(gain(ctx, 0.5)).connect(out);
      sources.push(a, b);
      return { sources };
    }
    case "orb":
    case "gravityOrb": {
      // Flying orbs: a warbling tone (deep for the singularity orb, wobbly for gravity).
      const deep = kind === "orb";
      const a = osc(ctx, deep ? "triangle" : "sine", deep ? 140 : 420);
      const lfo = osc(ctx, "sine", deep ? 7 : 11);
      lfo.connect(gain(ctx, deep ? 80 : 220)).connect(a.detune);
      a.connect(out);
      sources.push(a, lfo);
      return { sources };
    }
  }
}
