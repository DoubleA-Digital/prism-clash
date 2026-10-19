// Sound recipes. Each builds a short graph on `v.out` starting at time v.t and returns its
// duration. Small helpers keep every recipe a few lines.

export interface Voice {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  t: number;
  pitch: number;
  /** 0..1 from the sound name, for per-power variation. */
  seed: number;
}

export type Recipe = (v: Voice) => number;

export function tone(v: Voice, type: OscillatorType, f0: number, f1: number, start: number, dur: number, peak: number, attack = 0.005) {
  const o = v.ctx.createOscillator();
  const g = v.ctx.createGain();
  o.type = type;
  const t = v.t + start;
  o.frequency.setValueAtTime(f0 * v.pitch, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * v.pitch), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(v.out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function noise(v: Voice, type: BiquadFilterType, f0: number, f1: number, q: number, start: number, dur: number, peak: number, attack = 0.004) {
  const s = v.ctx.createBufferSource();
  s.buffer = v.noise;
  s.loop = true;
  const f = v.ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  const t = v.t + start;
  f.frequency.setValueAtTime(f0 * v.pitch, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1 * v.pitch), t + dur);
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(v.out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

export const RECIPES: Record<string, Recipe> = {
  shoot: (v) => {
    tone(v, "square", 1400, 380, 0, 0.08, 0.12);
    noise(v, "highpass", 3000, 1500, 0.7, 0, 0.05, 0.08);
    return 0.1;
  },
  hit: (v) => {
    tone(v, "triangle", 520, 180, 0, 0.09, 0.25);
    noise(v, "bandpass", 2200, 800, 2, 0, 0.07, 0.18);
    return 0.1;
  },
  crit: (v) => {
    tone(v, "square", 1200, 300, 0, 0.14, 0.2);
    tone(v, "sine", 2400, 2400, 0.02, 0.18, 0.12);
    noise(v, "bandpass", 4000, 1200, 3, 0, 0.1, 0.2);
    return 0.2;
  },
  hurt: (v) => {
    tone(v, "sawtooth", 180, 60, 0, 0.18, 0.3);
    noise(v, "lowpass", 900, 200, 1, 0, 0.15, 0.3);
    return 0.2;
  },
  kill: (v) => {
    tone(v, "sawtooth", 880, 55, 0, 0.6, 0.3);
    tone(v, "square", 440, 110, 0.05, 0.4, 0.15);
    noise(v, "lowpass", 4000, 120, 0.8, 0, 0.7, 0.45);
    return 0.75;
  },
  dash: (v) => {
    noise(v, "bandpass", 600, 3200, 1.5, 0, 0.16, 0.25, 0.02);
    tone(v, "sine", 300, 900, 0, 0.12, 0.08);
    return 0.18;
  },
  crystal: (v) => {
    tone(v, "sine", 2600, 2400, 0, 0.12, 0.08);
    tone(v, "sine", 3900, 3700, 0, 0.1, 0.05);
    return 0.13;
  },
  shatter: (v) => {
    for (let i = 0; i < 6; i++) tone(v, "sine", 1800 + i * 430, 1500 + i * 300, i * 0.025, 0.4, 0.06);
    noise(v, "highpass", 5000, 2000, 0.5, 0, 0.35, 0.3);
    return 0.5;
  },
  pickup: (v) => {
    tone(v, "triangle", 660, 660, 0, 0.09, 0.18);
    tone(v, "triangle", 990, 990, 0.07, 0.12, 0.18);
    tone(v, "triangle", 1320, 1320, 0.14, 0.18, 0.15);
    return 0.34;
  },
  boom: (v) => {
    tone(v, "sine", 120, 35, 0, 0.6, 0.6, 0.01);
    noise(v, "lowpass", 2400, 90, 0.7, 0, 0.7, 0.55);
    return 0.72;
  },
  bounce: (v) => {
    tone(v, "triangle", 1500, 1900, 0, 0.06, 0.12);
    return 0.07;
  },
  portal: (v) => {
    tone(v, "sine", 300, 1200, 0, 0.22, 0.15, 0.03);
    tone(v, "sine", 1200, 300, 0.05, 0.22, 0.1, 0.03);
    return 0.3;
  },
  slam: (v) => {
    tone(v, "sine", 90, 40, 0, 0.35, 0.6);
    noise(v, "lowpass", 1500, 100, 0.8, 0, 0.3, 0.45);
    return 0.36;
  },
  combo: (v) => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => tone(v, "square", n, n, i * 0.06, 0.35, 0.09));
    tone(v, "sawtooth", 1047, 1047, 0.24, 0.5, 0.08);
    return 0.8;
  },
  zoneWarn: (v) => {
    tone(v, "sawtooth", 220, 220, 0, 0.4, 0.14, 0.05);
    tone(v, "sawtooth", 233, 233, 0, 0.4, 0.14, 0.05);
    tone(v, "sawtooth", 220, 220, 0.5, 0.4, 0.14, 0.05);
    return 1;
  },
  haunt: (v) => {
    tone(v, "sine", 600, 200, 0, 0.6, 0.12, 0.1);
    tone(v, "sine", 607, 203, 0, 0.6, 0.12, 0.1);
    return 0.65;
  },
  ui: (v) => {
    tone(v, "triangle", 880, 1100, 0, 0.05, 0.1);
    return 0.06;
  },
  uiConfirm: (v) => {
    tone(v, "triangle", 660, 660, 0, 0.07, 0.12);
    tone(v, "triangle", 990, 990, 0.06, 0.12, 0.12);
    return 0.2;
  },
  countdown: (v) => {
    tone(v, "square", 440, 440, 0, 0.15, 0.15);
    return 0.16;
  },
  fight: (v) => {
    tone(v, "sawtooth", 220, 880, 0, 0.5, 0.2, 0.02);
    tone(v, "square", 440, 1760, 0, 0.5, 0.1, 0.02);
    noise(v, "highpass", 2000, 8000, 0.7, 0, 0.4, 0.15);
    return 0.55;
  },
  /** Generic cast: a rising chime colored by the power name's seed. */
  cast: (v) => {
    const base = 300 + v.seed * 500;
    tone(v, "triangle", base, base * 2, 0, 0.25, 0.18, 0.01);
    tone(v, "sine", base * 1.5, base * 3, 0.03, 0.25, 0.1, 0.01);
    noise(v, "bandpass", base * 4, base * 2, 2, 0, 0.2, 0.1);
    return 0.3;
  },
};
