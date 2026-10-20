// Final-duel music layer (last 2 fighters): war-drum toms on a driving syncopated pattern,
// tense tremolo strings rubbing against the chord, and a low gong at each phrase start.
// Driven step by step by the Music sequencer with a smoothed 0..1 amount, so it swells in and
// out instead of popping. Each note is a couple of short-lived nodes.

import { envelope, midi } from "./synth";

/** 16th steps in a bar that get a tom hit, and their accent level. */
const TOMS: ReadonlyMap<number, number> = new Map([
  [0, 1],
  [3, 0.6],
  [6, 0.75],
  [8, 0.9],
  [11, 0.6],
  [13, 0.5],
  [14, 0.8],
]);

export class DuelLayer {
  private strings: BiquadFilterNode;

  constructor(
    private ctx: BaseAudioContext,
    /** Pumped (sidechained) music bus for tonal parts. */
    private tonal: AudioNode,
    /** Drum bus. */
    private drums: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.strings = ctx.createBiquadFilter();
    this.strings.type = "lowpass";
    this.strings.frequency.value = 2600;
    this.strings.Q.value = 0.8;
    this.strings.connect(tonal);
  }

  /** Called by the sequencer for every 16th step while the duel layer is audible. */
  step(s16: number, bar: number, t: number, sd: number, amount: number, chord: readonly number[]) {
    const tom = TOMS.get(s16);
    if (tom !== undefined) this.tom(t, 0.3 * amount * tom, s16 === 0 ? 70 : 95 + (s16 % 3) * 12);
    // Tremolo strings: every 16th, root and fifth two octaves up; a minor-second rub on the
    // last bar of the phrase.
    const root = (chord[0] ?? 57) + 12;
    const fifth = (chord[2] ?? 64) + 12;
    const rub = bar === 3 && s16 >= 8 ? 1 : 0;
    const peak = (s16 % 4 === 0 ? 0.03 : 0.022) * amount;
    this.bow(midi(root + rub), t, sd * 0.85, peak);
    this.bow(midi(fifth), t, sd * 0.85, peak * 0.8);
    if (bar === 0 && s16 === 0) this.gong(t, 0.22 * amount);
  }

  private tom(t: number, peak: number, f: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f * 2, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const g = this.ctx.createGain();
    envelope(g.gain, t, peak, 0.002, 0.28);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.3);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    const ng = this.ctx.createGain();
    envelope(ng.gain, t, peak * 0.4, 0.001, 0.05);
    n.connect(bp).connect(ng).connect(this.drums);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.07);
  }

  private bow(f: number, t: number, dur: number, peak: number) {
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 10;
    const g = this.ctx.createGain();
    envelope(g.gain, t, peak, 0.01, dur);
    o.connect(g).connect(this.strings);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private gong(t: number, peak: number) {
    for (const [r, p] of [[1, 1], [2.4, 0.4], [3.9, 0.2]] as const) {
      const o = this.ctx.createOscillator();
      o.frequency.value = 45 * r;
      const g = this.ctx.createGain();
      envelope(g.gain, t, peak * p, 0.004, 2.2 / r);
      o.connect(g).connect(this.tonal);
      o.start(t);
      o.stop(t + 2.3 / r);
    }
  }
}
