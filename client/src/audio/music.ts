// Procedural synthwave in A minor (i–VI–III–VII: Am7, Fmaj7, C, G), 110→118 BPM.
// Persistent voices (pad stack, bass mono-synth, delay, reverb) are built once; per-beat
// notes create only a couple of nodes each. A lookahead scheduler queues notes ~150 ms ahead
// on the audio clock (no drift; if the tab was throttled it skips ahead instead of bunching).
// Intensity (0..1, smoothed over ~2 s so layers fade rather than pop) drives: filter sweeps,
// octave-pumping and then 16th bass, 16th arp + a second arp octave, hats → 16th hats,
// snare, end-of-phrase snare rolls and risers, crashes, a lead hook at the top, deeper
// sidechain pump, and tempo. The "menu" variant is a calm half-time pad/arp/bass bed.

import { envelope, midi } from "./synth";

export type MusicVariant = "menu" | "game";
export type StingKind = "win" | "lose" | "roundEnd";

const CHORDS: readonly (readonly number[])[] = [
  [57, 60, 64, 67],
  [53, 57, 60, 64],
  [48, 52, 55, 60],
  [55, 59, 62, 67],
];
const BASS = [45, 41, 36, 43];
const ARP_ORDER = [0, 1, 2, 3, 2, 1];
const R = -1;
/** Lead hook, one row of 16ths per bar (R = rest). */
const LEAD: readonly (readonly number[])[] = [
  [76, R, R, 74, 72, R, 74, R, 76, R, R, R, 79, R, 76, R],
  [77, R, R, 76, 74, R, 72, R, 74, R, R, R, 72, R, 69, R],
  [72, R, R, 74, 76, R, 79, R, 84, R, R, R, 83, R, 79, R],
  [79, R, R, 81, 83, R, 81, R, 79, R, R, R, 74, R, 71, R],
];
const LOOKAHEAD = 0.15;
const TICK_MS = 25;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

export class Music {
  private nextTime = 0;
  private step = 0;
  private arpIdx = 0;
  private timer = 0;
  private stopTimer = 0;
  private playing = false;
  private level = -1;
  private variant: MusicVariant = "game";
  /** Target intensity; `si` is the smoothed value the sequencer actually uses. */
  intensity = 0;
  private si = 0;
  private lastTick = 0;
  /** Latched at each bar line so a mid-bar change never overlaps mono-bass envelopes. */
  private barMenu = false;
  private barI = 0;
  private lastDelay = 0;

  private bus: GainNode;
  private dip: GainNode;
  private duck: GainNode;
  private drums: GainNode;
  private arpFilter: BiquadFilterNode;
  private padFilter: BiquadFilterNode;
  private leadFilter: BiquadFilterNode;
  private hatFilter: BiquadFilterNode;
  private snareFilter: BiquadFilterNode;
  private bassFilter: BiquadFilterNode;
  private bassAmp: GainNode;
  private bassSaws: OscillatorNode[];
  private bassSub: OscillatorNode;
  private padOscs: OscillatorNode[] = [];
  private delay: DelayNode;
  private delaySend: GainNode;
  private reverbSend: GainNode;
  private stingBus: GainNode;
  private stingFilter: BiquadFilterNode;

  constructor(private ctx: BaseAudioContext, out: AudioNode, private noise: AudioBuffer) {
    const c = ctx;
    this.bus = this.gain(0);
    this.bus.connect(out);
    this.dip = this.gain(1);
    this.dip.connect(this.bus);
    this.duck = this.gain(1);
    this.duck.connect(this.dip);
    this.drums = this.gain(1);
    this.drums.connect(this.dip);

    // Reverb (generated impulse) and a dotted-8th feedback delay, both returning into the
    // sidechained bus so their tails pump with the kick.
    const verb = c.createConvolver();
    verb.buffer = this.impulse(2.2);
    this.reverbSend = this.gain(1);
    this.reverbSend.connect(verb).connect(this.gain(0.32)).connect(this.duck);
    this.delay = c.createDelay(1.5);
    this.delay.delayTime.value = (60 / 110 / 4) * 3;
    const fb = this.gain(0.36);
    const dlp = this.filter("lowpass", 2600);
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delaySend = this.gain(1);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.gain(0.32)).connect(this.duck);

    this.arpFilter = this.filter("lowpass", 1200, 3);
    this.arpFilter.connect(this.duck);
    this.arpFilter.connect(this.delaySend);
    this.leadFilter = this.filter("lowpass", 3200, 1);
    this.leadFilter.connect(this.duck);
    this.leadFilter.connect(this.delaySend);
    this.leadFilter.connect(this.reverbSend);
    this.hatFilter = this.filter("highpass", 7500);
    this.hatFilter.connect(this.drums);
    this.snareFilter = this.filter("bandpass", 1800, 0.8);
    this.snareFilter.connect(this.drums);
    this.snareFilter.connect(this.reverbSend);

    // Pad: 4 chord notes × 2 detuned saws, always running; chords glide at bar lines.
    this.padFilter = this.filter("lowpass", 700, 1.5);
    const padAmp = this.gain(0.024);
    this.padFilter.connect(padAmp);
    padAmp.connect(this.duck);
    padAmp.connect(this.reverbSend);
    for (const n of CHORDS[0] ?? []) {
      for (const det of [-9, 9]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(this.padFilter);
        o.start();
        this.padOscs.push(o);
      }
    }

    // Bass mono-synth: two saws through an enveloped low-pass plus a sine sub.
    this.bassAmp = this.gain(0.0001);
    this.bassAmp.connect(this.duck);
    this.bassFilter = this.filter("lowpass", 400, 4);
    this.bassFilter.connect(this.bassAmp);
    this.bassSaws = [0, 7].map((det) => {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.detune.value = det;
      o.frequency.value = midi(45);
      o.connect(this.bassFilter);
      o.start();
      return o;
    });
    this.bassSub = c.createOscillator();
    this.bassSub.frequency.value = midi(33);
    this.bassSub.connect(this.gain(0.7)).connect(this.bassAmp);
    this.bassSub.start();

    // Stings bypass the music level so they still play over a quiet or stopped track.
    this.stingFilter = this.filter("lowpass", 4000, 1);
    this.stingBus = this.gain(0.55);
    this.stingFilter.connect(this.stingBus).connect(out);
  }

  /** Fades the track in to `level`. Menus get a calm half-time bed. Safe to call every frame. */
  start(level = 0.32, variant: MusicVariant = level < 0.22 ? "menu" : "game") {
    this.variant = variant;
    if (this.stopTimer) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = 0;
    }
    if (!this.playing) {
      this.playing = true;
      this.barMenu = variant === "menu";
      this.nextTime = this.ctx.currentTime + 0.1;
      this.lastTick = this.ctx.currentTime;
      this.step = 0;
      this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    }
    if (level !== this.level) {
      this.level = level;
      this.rampBus(level, 0.4);
    }
  }

  stop() {
    if (!this.playing || this.stopTimer) return;
    this.level = 0;
    this.rampBus(0, 0.25);
    this.stopTimer = window.setTimeout(() => {
      this.playing = false;
      this.stopTimer = 0;
      window.clearInterval(this.timer);
    }, 1500);
  }

  setIntensity(v: number) {
    this.intensity = clamp01(v);
  }

  /** A short musical cue over the track (which dips underneath it). */
  sting(kind: StingKind) {
    const t = this.ctx.currentTime + 0.03;
    const d = this.dip.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(d.value, t);
    d.linearRampToValueAtTime(0.2, t + 0.1);
    d.setTargetAtTime(1, t + (kind === "roundEnd" ? 1 : 1.8), 0.5);
    const f = this.stingFilter.frequency;
    f.cancelScheduledValues(t);
    if (kind === "win") {
      f.setValueAtTime(1500, t);
      f.exponentialRampToValueAtTime(6000, t + 0.6);
      [69, 73, 76, 81].forEach((n, i) => {
        this.stNote("triangle", midi(n), t + i * 0.09, 0.3, 0.16, 0.004);
        this.stNote("sawtooth", midi(n), t + i * 0.09, 0.25, 0.05, 0.004);
      });
      for (const n of [57, 61, 64, 69, 73]) {
        for (const det of [-7, 7]) this.stNote("sawtooth", midi(n), t + 0.38, 1.6, 0.045, 0.02, 0.5, det);
      }
      this.stKick(t + 0.38, 0.6);
      this.stNoise(t + 0.38, 1.3, 0.12, 6000);
    } else if (kind === "lose") {
      f.setValueAtTime(2500, t);
      f.exponentialRampToValueAtTime(500, t + 1.8);
      [76, 72, 69].forEach((n, i) => this.stNote("triangle", midi(n), t + i * 0.17, 0.32, 0.15, 0.006));
      for (const n of [45, 52, 57, 60]) {
        for (const det of [-6, 6]) this.stNote("sawtooth", midi(n), t + 0.5, 1.5, 0.05, 0.03, 0.3, det, -120);
      }
      this.stKick(t + 0.5, 0.45);
    } else {
      f.setValueAtTime(3500, t);
      const stabs: readonly (readonly number[])[] = [[53, 57, 60, 65], [55, 59, 62, 67], [57, 60, 64, 69]];
      stabs.forEach((ch, i) => {
        const last = i === stabs.length - 1;
        for (const n of ch) this.stNote("sawtooth", midi(n), t + i * 0.16, last ? 0.8 : 0.13, 0.05, 0.004, last ? 0.2 : 0);
        this.stKick(t + i * 0.16, last ? 0.5 : 0.3);
      });
    }
  }

  // ---- sequencer --------------------------------------------------------------------------

  private schedule() {
    const now = this.ctx.currentTime;
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    this.si += (this.intensity - this.si) * Math.min(1, dt / 2);
    // Throttled tab: skip the missed notes instead of firing them all at once.
    if (this.nextTime < now - 0.1) this.nextTime = now + 0.05;
    const delay = this.stepDur() * 3;
    if (Math.abs(delay - this.lastDelay) > 0.002) {
      this.lastDelay = delay;
      this.delay.delayTime.setTargetAtTime(delay, now, 0.5);
    }
    this.fill(now + LOOKAHEAD);
  }

  /** Queues every step that starts before `until` (seconds on the audio clock). */
  private fill(until: number) {
    while (this.nextTime < until) {
      if (this.step % 16 === 0) {
        this.barMenu = this.variant === "menu";
        this.barI = this.barMenu ? Math.min(this.si, 0.1) : this.si;
      }
      const sd = this.stepDur();
      this.play(this.step, this.nextTime, sd);
      this.nextTime += sd;
      this.step = (this.step + 1) % 64;
    }
  }

  /** Dev/offline: render deterministically on an OfflineAudioContext (no timers). */
  renderOffline(seconds: number, level: number, variant: MusicVariant, intensity: number) {
    this.variant = variant;
    this.intensity = this.si = clamp01(intensity);
    this.bus.gain.value = level;
    this.nextTime = 0.05;
    this.step = 0;
    this.fill(seconds);
  }

  private stepDur(): number {
    const bpm = this.barMenu ? 100 : 110 + 8 * this.si;
    return 60 / bpm / 4;
  }

  private play(step: number, t: number, sd: number) {
    const bar = Math.floor(step / 16) % 4;
    const s16 = step % 16;
    const chord = CHORDS[bar] ?? CHORDS[0] ?? [];
    const menu = this.barMenu;
    const I = menu ? Math.min(this.si, 0.1) : this.si;
    const bassI = this.barI;

    if (s16 === 0) this.barStart(bar, chord, t, sd, I, menu);

    // Kick + sidechain pump (menus get only a gentle breathing pump, no kick).
    if (s16 % 4 === 0) {
      if (!menu) this.kick(t, 0.85);
      const depth = menu ? 0.12 : 0.3 + 0.35 * I;
      const g = this.duck.gain;
      g.setValueAtTime(1, t);
      g.linearRampToValueAtTime(1 - depth, t + 0.015);
      g.linearRampToValueAtTime(1, t + sd * 3.2);
    }

    // Bass: half notes (menu) → 8ths → octave-pumping 8ths → 16ths.
    const root = BASS[bar] ?? 45;
    const cut = 220 + 900 * I;
    if (menu) {
      if (s16 % 8 === 0) this.bass(root, t, sd * 7, 0.26, cut);
    } else if (bassI < 0.55) {
      if (s16 % 2 === 0) this.bass(root + (bassI > 0.3 && s16 % 4 === 2 ? 12 : 0), t, sd * 1.7, 0.2, cut);
    } else {
      this.bass(root + (s16 % 4 === 2 ? 12 : 0), t, sd * 0.85, s16 % 4 === 0 ? 0.22 : 0.16, cut);
    }

    // Arp: 8ths, then 16ths, then a second octave on top.
    if ((!menu && I > 0.45) || s16 % 2 === 0) {
      const idx = ARP_ORDER[this.arpIdx++ % ARP_ORDER.length] ?? 0;
      const n = (chord[idx] ?? 60) + 12;
      const peak = menu ? 0.06 : 0.055 + 0.03 * I;
      this.pluck(midi(n), t, peak, 0.16 + 0.08 * I);
      const oct = menu ? 0 : smooth(0.5, 0.75, I);
      if (oct > 0.02) this.pluck(midi(n + 12), t, peak * 0.45 * oct, 0.12);
    }

    if (menu) return;

    // Hats: offbeat 8ths, then 16ths with accents.
    const hat8 = smooth(0.12, 0.35, I);
    if (hat8 > 0.02 && s16 % 4 === 2) this.hat(t, 0.07 * hat8, 0.09);
    const hat16 = smooth(0.6, 0.85, I);
    if (hat16 > 0.02 && s16 % 2 === 1) this.hat(t, (s16 % 4 === 3 ? 0.035 : 0.025) * hat16, 0.035);

    // Snare on 2 and 4, plus a roll into the next phrase when it's tense.
    const sn = smooth(0.25, 0.45, I);
    if (sn > 0.02 && (s16 === 4 || s16 === 12)) this.snare(t, 0.17 * sn, 0.2);
    const roll = smooth(0.55, 0.75, I);
    if (roll > 0.02 && bar === 3 && s16 >= 8 && s16 !== 12) this.snare(t, (0.035 + (s16 - 8) * 0.012) * roll, 0.08);

    // Lead hook at the very top.
    const lead = smooth(0.72, 0.9, I);
    const note = LEAD[bar]?.[s16] ?? R;
    if (lead > 0.02 && note !== R) {
      let len = 1;
      while (len < 4 && s16 + len < 16 && (LEAD[bar]?.[s16 + len] ?? R) === R) len++;
      this.lead(midi(note), t, sd * len * 0.92, 0.075 * lead);
    }
  }

  /** Chord change, filter sweeps (opening across each 4-bar phrase), crash and riser. */
  private barStart(bar: number, chord: readonly number[], t: number, sd: number, I: number, menu: boolean) {
    this.padOscs.forEach((o, i) => o.frequency.setTargetAtTime(midi(chord[i >> 1] ?? 57), t, 0.04));
    const sweep = 0.75 + 0.35 * (bar / 3);
    this.arpFilter.frequency.setTargetAtTime((menu ? 900 : 1100 + 4200 * I) * sweep, t, sd * 6);
    this.padFilter.frequency.setTargetAtTime((menu ? 650 : 700 + 2400 * I) * sweep, t, sd * 6);
    if (menu) return;
    if (bar === 0 && I > 0.5) this.crash(t, 0.06 * smooth(0.5, 0.7, I));
    if (bar === 3 && I > 0.6) this.riser(t, sd * 16, 0.05 * smooth(0.6, 0.8, I));
  }

  // ---- instruments ------------------------------------------------------------------------

  private kick(t: number, peak: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    envelope(g.gain, t, peak, 0.003, 0.32);
    o.connect(g).connect(this.dip);
    o.start(t);
    o.stop(t + 0.35);
  }

  private bass(n: number, t: number, dur: number, peak: number, cut: number) {
    for (const o of this.bassSaws) o.frequency.setValueAtTime(midi(n), t);
    this.bassSub.frequency.setValueAtTime(midi(n - 12), t);
    const f = this.bassFilter.frequency;
    f.setValueAtTime(cut * 3, t);
    f.exponentialRampToValueAtTime(cut, t + Math.min(0.15, dur * 0.8));
    envelope(this.bassAmp.gain, t, peak, 0.006, dur, 0, false);
  }

  private pluck(f: number, t: number, peak: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    const g = this.ctx.createGain();
    envelope(g.gain, t, peak, 0.003, dur);
    o.connect(g).connect(this.arpFilter);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private lead(f: number, t: number, dur: number, peak: number) {
    const g = this.ctx.createGain();
    envelope(g.gain, t, peak, 0.015, dur, dur * 0.5);
    g.connect(this.leadFilter);
    for (const det of [-8, 8]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  private hat(t: number, peak: number, dur: number) {
    const g = this.noiseHit(t, dur, peak);
    g.connect(this.hatFilter);
  }

  private snare(t: number, peak: number, dur: number) {
    this.noiseHit(t, dur, peak).connect(this.snareFilter);
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const g = this.ctx.createGain();
    envelope(g.gain, t, peak * 0.7, 0.002, 0.09);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  private crash(t: number, peak: number) {
    const g = this.noiseHit(t, 1.4, peak);
    const hp = this.filter("highpass", 5000);
    g.connect(hp).connect(this.drums);
  }

  /** Filtered noise swelling over a bar into the next downbeat. */
  private riser(t: number, dur: number, peak: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = this.filter("bandpass", 400, 2);
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.97);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.drums);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  /** A noise burst with an envelope; returns its gain for routing. */
  private noiseHit(t: number, dur: number, peak: number): GainNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = dur > 0.9;
    const g = this.ctx.createGain();
    envelope(g.gain, t, peak, 0.002, dur);
    s.connect(g);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
    return g;
  }

  // ---- sting voices -----------------------------------------------------------------------

  private stNote(type: OscillatorType, f: number, t: number, dur: number, peak: number, attack: number, hold = 0, detune = 0, bendCents = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.setValueAtTime(detune, t);
    if (bendCents) o.detune.linearRampToValueAtTime(detune + bendCents, t + dur);
    const g = this.ctx.createGain();
    envelope(g.gain, t, peak, attack, dur, hold);
    o.connect(g).connect(this.stingFilter);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private stKick(t: number, peak: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    envelope(g.gain, t, peak, 0.003, 0.5);
    o.connect(g).connect(this.stingBus);
    o.start(t);
    o.stop(t + 0.52);
  }

  private stNoise(t: number, dur: number, peak: number, hpFreq: number) {
    const g = this.noiseHit(t, dur, peak);
    g.connect(this.filter("highpass", hpFreq)).connect(this.stingBus);
  }

  // ---- utils ------------------------------------------------------------------------------

  private rampBus(level: number, tau: number) {
    const g = this.bus.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(level, now, tau);
  }

  private gain(v: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private impulse(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }
}
