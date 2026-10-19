// All audio is synthesized with WebAudio: no files. SFX are short recipes (oscillators,
// filtered noise, envelopes) mixed positionally (pan by x, gain falls off with distance).
// Music is a procedural synthwave loop that intensifies as the round gets tense.

import { RECIPES, type Voice } from "./recipes";
import { Music } from "./music";

export interface SfxOpts {
  gain?: number;
  pitch?: number;
  positional?: boolean;
}

const MAX_VOICES = 24;
const HEAR_RANGE = 1600;

class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: { end: number; gain: number }[] = [];
  private listener = { x: 0, y: 0 };
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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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

export const audio = new AudioEngine();
