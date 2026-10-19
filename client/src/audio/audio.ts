// All audio is synthesized with WebAudio: no files. SFX are short recipes (oscillators,
// filtered noise, envelopes) mixed positionally (pan by x, gain falls off with distance).
// Music is a procedural synthwave loop that intensifies as the round gets tense. World
// effects get spawn/end sounds and positional loops (effectSounds.ts). The master chain is a
// glue compressor followed by a fast brick-wall-ish limiter so stacked sounds never clip.

import { PLAYER, type NetEffect, type NetProjectile } from "@prism/shared";
import { EffectSounds } from "./effectSounds";
import { Music, type MusicVariant } from "./music";
import { RECIPES, type Voice } from "./recipes";

export interface SfxOpts {
  gain?: number;
  pitch?: number;
  positional?: boolean;
}

export interface RecipeLevel {
  name: string;
  peak: number;
  rms: number;
  dur: number;
  /** Peak after the reported duration (should be ~0: the voice accounting is accurate). */
  tail: number;
}

const MAX_VOICES = 24;
const HEAR_RANGE = 1600;
const LOW_HP = 0.3;
const STALE_MS = 400;

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicLp: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: { end: number; gain: number }[] = [];
  private listener = { x: 0, y: 0 };
  private nextBeat = 0;
  private lowHpAt = 0;
  private muffled = false;
  private lowHpWatch = 0;
  private effects = new EffectSounds({
    sfx: (name, x, y, opts) => this.sfx(name, x, y, opts),
    loopOutput: () => (this.ctx && this.sfxBus && this.noise && this.ctx.state === "running" ? { ctx: this.ctx, bus: this.sfxBus, noise: this.noise } : null),
    hasRecipe: (name) => name in RECIPES,
  });
  music: Music | null = null;
  volumes = { master: 0.8, music: 0.55, sfx: 0.9 };

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 8;
    glue.ratio.value = 3;
    glue.attack.value = 0.005;
    glue.release.value = 0.2;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    this.master.connect(glue).connect(limiter).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicLp = ctx.createBiquadFilter();
    this.musicLp.type = "lowpass";
    this.musicLp.frequency.value = 20000;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.musicLp).connect(this.master);
    this.noise = makeNoise(ctx);
    this.music = new Music(ctx, this.musicBus, this.noise);
    this.applyVolumes();
  }

  setVolumes(v: Partial<{ master: number; music: number; sfx: number }>) {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music;
  }

  setListener(x: number, y: number) {
    this.listener.x = x;
    this.listener.y = y;
  }

  /** Per-frame match hook: effect loops/lifecycle while playing, heartbeat at low HP. */
  matchFrame(view: { effects: readonly NetEffect[]; projectiles: readonly NetProjectile[] } | null, listener: { x: number; y: number }, phase: string, hp: number | null) {
    const live = phase === "round" || phase === "countdown";
    if (view && live) this.effects.track(view, listener);
    this.setLowHp(live && hp !== null ? hp / PLAYER.maxHp : 1);
  }

  /**
   * Low-HP feedback: below 30% a heartbeat plays (faster as HP drops) and the music is
   * muffled. Call every frame; if calls stop (menus), it recovers on its own.
   */
  setLowHp(fraction: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    this.lowHpAt = performance.now();
    const low = fraction > 0 && fraction < LOW_HP;
    this.muffle(low ? 700 + (fraction / LOW_HP) * 2300 : 20000);
    if (!low) return;
    if (!this.lowHpWatch) this.lowHpWatch = window.setInterval(() => this.checkLowHpStale(), 250);
    const now = ctx.currentTime;
    if (now >= this.nextBeat) {
      this.sfx("heartbeat", 0, 0, { positional: false, gain: 0.8 + (1 - fraction / LOW_HP) * 0.4 });
      this.nextBeat = now + 0.55 + (fraction / LOW_HP) * 0.55;
    }
  }

  private checkLowHpStale() {
    if (performance.now() - this.lowHpAt <= STALE_MS) return;
    this.muffle(20000);
    window.clearInterval(this.lowHpWatch);
    this.lowHpWatch = 0;
  }

  private muffle(freq: number) {
    const lp = this.musicLp;
    if (!lp || !this.ctx) return;
    const want = freq < 19000;
    if (!want && !this.muffled) return;
    this.muffled = want;
    lp.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.15);
  }

  /** Short musical cue over the track: "win", "lose" or "roundEnd". */
  sting(kind: "win" | "lose" | "roundEnd") {
    if (this.ctx?.state === "running") this.music?.sting(kind);
  }

  startMusic(level: number, variant?: MusicVariant) {
    this.music?.start(level, variant);
  }

  sfx(name: string, x: number, y: number, opts: SfxOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise || ctx.state !== "running") return;
    let gain = opts.gain ?? 1;
    let pan = 0;
    let lowpass = 20000;
    if (opts.positional !== false) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const d = Math.hypot(dx, dy);
      if (d > HEAR_RANGE) return;
      gain *= Math.min(1, 1 / (1 + (d / 420) ** 2) + 0.05);
      pan = Math.max(-1, Math.min(1, dx / 700));
      lowpass = 20000 - Math.min(16000, d * 9);
    }
    if (gain < 0.03) return;
    // Voice limit: drop the quietest sounds first.
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= MAX_VOICES) {
      const quietest = Math.min(...this.voices.map((v) => v.gain));
      if (gain <= quietest) return;
    }
    const recipe = RECIPES[name] ?? (name.startsWith("cast:") ? RECIPES.cast : undefined);
    if (!recipe) return;
    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lowpass;
    out.connect(lp).connect(panner).connect(this.sfxBus);
    const voice: Voice = { ctx, out, noise: this.noise, t: now, pitch: opts.pitch ?? 1, seed: hash(name) };
    const dur = recipe(voice);
    this.voices.push({ end: now + dur, gain });
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Dev: renders one recipe offline at unity gain and measures it. */
async function measureRecipe(name: string, sampleRate = 48000): Promise<RecipeLevel> {
  const recipe = RECIPES[name];
  if (!recipe) throw new Error(`no recipe ${name}`);
  const ctx = new OfflineAudioContext(1, sampleRate * 2.5, sampleRate);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const t0 = 0.01;
  const dur = recipe({ ctx, out, noise: makeNoise(ctx), t: t0, pitch: 1, seed: hash(name) });
  const d = (await ctx.startRendering()).getChannelData(0);
  const end = Math.min(d.length, Math.floor((t0 + dur) * sampleRate));
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < end; i++) {
    const a = Math.abs(d[i] ?? 0);
    if (a > peak) peak = a;
    sum += a * a;
  }
  let tail = 0;
  for (let i = end + Math.floor(0.03 * sampleRate); i < d.length; i++) tail = Math.max(tail, Math.abs(d[i] ?? 0));
  return { name, peak, rms: Math.sqrt(sum / Math.max(1, end)), dur, tail };
}

/** Dev: renders the music offline for a few seconds and measures it. */
async function measureMusic(variant: MusicVariant, intensity: number, level: number, seconds = 9, sampleRate = 48000): Promise<{ peak: number; rms: number }> {
  const ctx = new OfflineAudioContext(2, sampleRate * seconds, sampleRate);
  const m = new Music(ctx, ctx.destination, makeNoise(ctx));
  m.renderOffline(seconds - 0.5, level, variant, intensity);
  const buf = await ctx.startRendering();
  let peak = 0;
  let sum = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i] ?? 0);
      if (a > peak) peak = a;
      sum += a * a;
    }
  }
  return { peak, rms: Math.sqrt(sum / (buf.length * buf.numberOfChannels)) };
}

export const audio = new AudioEngine();

declare global {
  interface Window {
    __prismAudio?: {
      audio: AudioEngine;
      names: () => string[];
      measure: (name: string) => Promise<RecipeLevel>;
      measureMusic: (variant: MusicVariant, intensity: number, level: number) => Promise<{ peak: number; rms: number }>;
    };
  }
}

if (import.meta.env.DEV) {
  window.__prismAudio = { audio, names: () => Object.keys(RECIPES), measure: measureRecipe, measureMusic };
}
