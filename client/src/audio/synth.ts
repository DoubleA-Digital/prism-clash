// Building blocks for sound recipes: enveloped oscillators and filtered noise, with optional
// vibrato (pitch LFO), tremolo (amplitude LFO) and hold. Envelopes always start and end at
// 0.0001 with exponential ramps so nothing clicks. Works on live and offline contexts.

export interface Voice {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  t: number;
  pitch: number;
  /** 0..1 from the sound name, for per-power variation. */
  seed: number;
}

export type Recipe = (v: Voice) => number;

export interface ToneExtras {
  /** Pitch wobble: LFO rate in Hz and depth in cents. */
  vib?: { rate: number; cents: number };
  /** Amplitude wobble: LFO rate in Hz and depth 0..0.5 (fraction of the level it dips). */
  am?: { rate: number; depth: number; type?: OscillatorType };
  /** Seconds to stay at the peak before decaying. */
  hold?: number;
  /** Linear instead of exponential pitch glide. */
  linear?: boolean;
  /** Detune in cents. */
  detune?: number;
}

const FLOOR = 0.0001;

/**
 * Click-free envelope on a gain param: attack, optional hold, exponential decay to silence.
 * `fresh` (a gain with no automation yet) also sets its resting value to silence, so a
 * source starting a fraction of a sample before `t` can't leak through at the default 1.0.
 */
export function envelope(p: AudioParam, t: number, peak: number, attack: number, dur: number, hold = 0, fresh = true) {
  if (fresh) p.value = FLOOR;
  const a = Math.min(Math.max(0.001, attack), dur * 0.9);
  const h = Math.min(hold, Math.max(0, dur - a - 0.01));
  p.setValueAtTime(FLOOR, t);
  p.exponentialRampToValueAtTime(Math.max(FLOOR * 2, peak), t + a);
  if (h > 0) p.setValueAtTime(Math.max(FLOOR * 2, peak), t + a + h);
  p.exponentialRampToValueAtTime(FLOOR, t + dur);
}

/** Routes `src` through an optional tremolo stage, returning the node to connect onward. */
function tremolo(v: Voice, src: AudioNode, t: number, dur: number, am: ToneExtras["am"]): AudioNode {
  if (!am) return src;
  const g = v.ctx.createGain();
  g.gain.value = 1 - am.depth;
  const lfo = v.ctx.createOscillator();
  lfo.type = am.type ?? "sine";
  lfo.frequency.value = am.rate;
  const depth = v.ctx.createGain();
  depth.gain.value = am.depth;
  lfo.connect(depth).connect(g.gain);
  lfo.start(t);
  lfo.stop(t + dur + 0.03);
  src.connect(g);
  return g;
}

export function tone(v: Voice, type: OscillatorType, f0: number, f1: number, start: number, dur: number, peak: number, attack = 0.005, x: ToneExtras = {}) {
  const o = v.ctx.createOscillator();
  const g = v.ctx.createGain();
  o.type = type;
  if (x.detune) o.detune.value = x.detune;
  const t = v.t + start;
  o.frequency.setValueAtTime(Math.max(20, f0 * v.pitch), t);
  const end = Math.max(20, f1 * v.pitch);
  if (x.linear) o.frequency.linearRampToValueAtTime(end, t + dur);
  else o.frequency.exponentialRampToValueAtTime(end, t + dur);
  if (x.vib) {
    const lfo = v.ctx.createOscillator();
    lfo.frequency.value = x.vib.rate;
    const depth = v.ctx.createGain();
    depth.gain.value = x.vib.cents;
    lfo.connect(depth).connect(o.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.03);
  }
  envelope(g.gain, t, peak, attack, dur, x.hold);
  tremolo(v, o, t, dur, x.am).connect(g).connect(v.out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

export function noise(v: Voice, type: BiquadFilterType, f0: number, f1: number, q: number, start: number, dur: number, peak: number, attack = 0.004, x: ToneExtras = {}) {
  const s = v.ctx.createBufferSource();
  s.buffer = v.noise;
  s.loop = true;
  const f = v.ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  const t = v.t + start;
  f.frequency.setValueAtTime(Math.min(20000, f0 * v.pitch), t);
  const end = Math.min(20000, Math.max(30, f1 * v.pitch));
  if (x.linear) f.frequency.linearRampToValueAtTime(end, t + dur);
  else f.frequency.exponentialRampToValueAtTime(end, t + dur);
  const g = v.ctx.createGain();
  envelope(g.gain, t, peak, attack, dur, x.hold);
  s.connect(f);
  tremolo(v, f, t, dur, x.am).connect(g).connect(v.out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.03);
}

/** A very short filtered noise tick (clock ticks, clicks, crackle grains). */
export function tick(v: Voice, freq: number, start: number, peak: number, dur = 0.018) {
  noise(v, "bandpass", freq, freq * 0.9, 6, start, dur, peak, 0.001);
}

/** A struck metal/bell: inharmonic sine partials with shorter decays on the high ones. */
export function bell(v: Voice, f: number, start: number, dur: number, peak: number, ratios: readonly number[] = [1, 2.76, 5.4, 8.93]) {
  ratios.forEach((r, i) => tone(v, "sine", f * r, f * r * 0.998, start, dur / (1 + i * 0.6), peak / (1 + i * 0.7), 0.002));
}

/** A detuned saw/square stack on several notes at once (stabs, chords). */
export function chord(v: Voice, type: OscillatorType, freqs: readonly number[], start: number, dur: number, peak: number, attack = 0.005, x: ToneExtras = {}) {
  const each = peak / Math.sqrt(freqs.length);
  for (const f of freqs) tone(v, type, f, f, start, dur, each, attack, x);
}

export const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
