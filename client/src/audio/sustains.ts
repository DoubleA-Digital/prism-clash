// Sustained sounds that last as long as a game state does: the Prism Lance charge hum, the
// bandage / medkit use loops and the zone-shrinking drone. Each is a small persistent graph
// keyed by a string. Callers refresh it (`hold`) while the state lasts; it fades out on
// `release`, or by itself when refreshes stop for longer than its time-to-live, so a missed
// "cancel" never leaves a loop droning. Positional ones follow the engine's spatial mix.

import { audio } from "./audio";

export type SustainKind = "lanceCharge" | "bandage" | "medkit" | "zoneDrone";

export interface HoldOpts {
  /** World position; omit for a centered, non-positional sound (your own actions, drones). */
  x?: number;
  y?: number;
  /** 0..1 kind-specific parameter (lance charge, drone intensity). */
  param?: number;
  /** Overall level multiplier. */
  level?: number;
  /** Auto-release when not refreshed for this long (ms). */
  ttlMs?: number;
}

interface Graph {
  sources: AudioScheduledSourceNode[];
  follow: (param: number, t: number) => void;
}

interface Sustain {
  kind: SustainKind;
  vol: GainNode;
  pan: StereoPannerNode;
  lp: BiquadFilterNode;
  graph: Graph;
  lastSeen: number;
  ttl: number;
  param: number;
}

/** Base level per kind before distance falloff (graphs peak around 1). */
const LEVEL: Record<SustainKind, number> = { lanceCharge: 0.16, bandage: 0.12, medkit: 0.1, zoneDrone: 0.14 };
const DEFAULT_TTL: Record<SustainKind, number> = { lanceCharge: 220, bandage: 2600, medkit: 5600, zoneDrone: 600 };
const MAX_SUSTAINS = 8;
const RANGE = 1400;

class Sustains {
  private live = new Map<string, Sustain>();
  private watchdog = 0;

  /** Starts (or refreshes) the sustained sound `key`. Call every frame / on every update. */
  hold(key: string, kind: SustainKind, o: HoldOpts = {}) {
    const io = audio.loopOutput();
    if (!io) return;
    let s = this.live.get(key);
    if (!s) {
      if (this.live.size >= MAX_SUSTAINS) return;
      s = this.create(io.ctx, io.bus, io.noise, kind);
      this.live.set(key, s);
      if (!this.watchdog) this.watchdog = window.setInterval(() => this.reap(), 120);
    }
    const t = io.ctx.currentTime;
    s.lastSeen = performance.now();
    s.ttl = o.ttlMs ?? DEFAULT_TTL[kind];
    const param = Math.max(0, Math.min(1, o.param ?? 0));
    if (kind === "lanceCharge" && param >= 1 && s.param < 1) {
      audio.sfx("lance:full", o.x ?? 0, o.y ?? 0, { positional: o.x !== undefined, gain: 0.7, group: "lance:full", cap: 2 });
    }
    s.param = param;
    s.graph.follow(param, t);
    let level = LEVEL[kind] * (o.level ?? 1);
    let pan = 0;
    let lowpass = 20000;
    if (o.x !== undefined && o.y !== undefined) {
      const sp = audio.spatial(o.x, o.y, RANGE);
      level *= sp ? sp.gain : 0;
      pan = sp?.pan ?? 0;
      lowpass = sp?.lowpass ?? 800;
    }
    s.vol.gain.setTargetAtTime(level, t, 0.05);
    s.pan.pan.setTargetAtTime(pan, t, 0.05);
    s.lp.frequency.setTargetAtTime(lowpass, t, 0.08);
  }

  isHeld(key: string): boolean {
    return this.live.has(key);
  }

  release(key: string) {
    const s = this.live.get(key);
    if (!s) return;
    this.live.delete(key);
    const t = s.vol.context.currentTime;
    s.vol.gain.cancelScheduledValues(t);
    s.vol.gain.setTargetAtTime(0, t, 0.06);
    for (const src of s.graph.sources) src.stop(t + 0.5);
    window.setTimeout(() => s.pan.disconnect(), 650);
  }

  releaseAll() {
    for (const key of [...this.live.keys()]) this.release(key);
  }

  private reap() {
    const now = performance.now();
    for (const [key, s] of this.live) if (now - s.lastSeen > s.ttl) this.release(key);
    if (this.live.size === 0) {
      window.clearInterval(this.watchdog);
      this.watchdog = 0;
    }
  }

  private create(ctx: AudioContext, bus: AudioNode, noise: AudioBuffer, kind: SustainKind): Sustain {
    const vol = ctx.createGain();
    vol.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 20000;
    const pan = ctx.createStereoPanner();
    vol.connect(lp).connect(pan).connect(bus);
    const graph = BUILD[kind](ctx, noise, vol);
    const t = ctx.currentTime;
    for (const src of graph.sources) {
      if (src instanceof AudioBufferSourceNode) src.start(t, Math.random() * 0.5);
      else src.start(t);
    }
    return { kind, vol, pan, lp, graph, lastSeen: performance.now(), ttl: DEFAULT_TTL[kind], param: 0 };
  }
}

// ---- graphs -------------------------------------------------------------------------------------

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

/** A gain whose level is swung by an LFO (`depth` of `base`); returns the gain and the LFO. */
function wobble(ctx: AudioContext, rate: number, base: number, depth: number, type: OscillatorType = "sine") {
  const g = gain(ctx, base);
  const lfo = osc(ctx, type, rate);
  lfo.connect(gain(ctx, depth)).connect(g.gain);
  return { g, lfo };
}

type Builder = (ctx: AudioContext, noise: AudioBuffer, out: AudioNode) => Graph;

const BUILD: Record<SustainKind, Builder> = {
  /** Rising charge hum: detuned saws through a resonant band-pass, pulsing faster as it fills. */
  lanceCharge: (ctx, _noise, out) => {
    const bp = filter(ctx, "bandpass", 500, 4);
    const pulse = wobble(ctx, 6, 0.6, 0.4);
    const a = osc(ctx, "sawtooth", 110, -8);
    const b = osc(ctx, "sawtooth", 110, 8);
    const sub = osc(ctx, "sine", 55);
    a.connect(bp);
    b.connect(bp);
    bp.connect(pulse.g).connect(out);
    sub.connect(gain(ctx, 0.5)).connect(out);
    return {
      sources: [a, b, sub, pulse.lfo],
      follow: (k, t) => {
        const f = 110 + 440 * k * k;
        a.frequency.setTargetAtTime(f, t, 0.04);
        b.frequency.setTargetAtTime(f, t, 0.04);
        sub.frequency.setTargetAtTime(f / 2, t, 0.04);
        bp.frequency.setTargetAtTime(500 + 3200 * k, t, 0.05);
        pulse.lfo.frequency.setTargetAtTime(6 + 34 * k, t, 0.05);
      },
    };
  },
  /** Bandage: rhythmic cloth wrap strokes (gated band-passed noise). */
  bandage: (ctx, noise, out) => {
    const n = noiseSrc(ctx, noise);
    const bp = filter(ctx, "bandpass", 1900, 1.1);
    const strokes = wobble(ctx, 3.2, 0.5, 0.5, "triangle");
    const sweep = osc(ctx, "sine", 1.6);
    sweep.connect(gain(ctx, 700)).connect(bp.frequency);
    n.connect(bp).connect(strokes.g).connect(out);
    return { sources: [n, strokes.lfo, sweep], follow: () => undefined };
  },
  /** Medkit: an antiseptic spray hiss under a soft monitor beep. */
  medkit: (ctx, noise, out) => {
    const n = noiseSrc(ctx, noise);
    const hp = filter(ctx, "highpass", 4500);
    const spray = wobble(ctx, 0.9, 0.35, 0.3);
    n.connect(hp).connect(spray.g).connect(out);
    const beep = osc(ctx, "square", 1760);
    const gate = wobble(ctx, 2, 0, 0.18, "square");
    beep.connect(filter(ctx, "lowpass", 3000)).connect(gate.g).connect(out);
    const hum = osc(ctx, "sine", 440);
    hum.connect(gain(ctx, 0.12)).connect(out);
    return { sources: [n, spray.lfo, beep, gate.lfo, hum], follow: () => undefined };
  },
  /** Zone drone: a low beating saw pair and rumble; the filter opens as the zone closes in. */
  zoneDrone: (ctx, noise, out) => {
    const lp = filter(ctx, "lowpass", 260, 3);
    const a = osc(ctx, "sawtooth", 55, -6);
    const b = osc(ctx, "sawtooth", 55.7, 6);
    const throb = wobble(ctx, 0.35, 0.75, 0.25);
    a.connect(lp);
    b.connect(lp);
    lp.connect(throb.g).connect(out);
    const n = noiseSrc(ctx, noise);
    const rumble = filter(ctx, "lowpass", 140, 1);
    n.connect(rumble).connect(gain(ctx, 0.6)).connect(out);
    const wail = osc(ctx, "sine", 880);
    const wailVib = osc(ctx, "sine", 0.4);
    wailVib.connect(gain(ctx, 40)).connect(wail.frequency);
    const wailAmp = gain(ctx, 0);
    wail.connect(wailAmp).connect(out);
    return {
      sources: [a, b, throb.lfo, n, wail, wailVib],
      follow: (k, t) => {
        lp.frequency.setTargetAtTime(220 + 900 * k, t, 0.4);
        throb.lfo.frequency.setTargetAtTime(0.35 + 2.2 * k, t, 0.4);
        wailAmp.gain.setTargetAtTime(0.08 * k, t, 0.4);
      },
    };
  },
};

export const sustains = new Sustains();
