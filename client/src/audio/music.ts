// Procedural synthwave: saw bass with a sidechained kick, a pluck arpeggio over
// i–VI–III–VII, a pad, and hats. `intensity` (0..1) opens the filter, adds hats and
// doubles the arpeggio as the zone closes and fewer players remain.

const BPM = 110;
const STEP = 60 / BPM / 4; // 16th notes
// A minor: Am, F, C, G (i–VI–III–VII)
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class Music {
  private nextTime = 0;
  private step = 0;
  private timer = 0;
  private playing = false;
  intensity = 0;
  private bus: GainNode;
  private duck: GainNode;
  private filter: BiquadFilterNode;

  constructor(private ctx: AudioContext, out: AudioNode, private noise: AudioBuffer) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.duck = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 900;
    this.filter.Q.value = 4;
    this.duck.connect(this.filter).connect(this.bus).connect(out);
  }

  start(level = 0.32) {
    if (!this.playing) {
      this.playing = true;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = window.setInterval(() => this.schedule(), 50);
    }
    this.bus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bus.gain.linearRampToValueAtTime(level, this.ctx.currentTime + 1.2);
  }

  stop() {
    this.bus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bus.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
    window.setTimeout(() => {
      if (this.bus.gain.value < 0.01) {
        this.playing = false;
        window.clearInterval(this.timer);
      }
    }, 900);
  }

  setIntensity(v: number) {
    this.intensity = Math.max(0, Math.min(1, v));
    this.filter.frequency.setTargetAtTime(700 + this.intensity * 4200, this.ctx.currentTime, 0.5);
  }

  private schedule() {
    const tempo = 1 + this.intensity * 0.07;
    while (this.nextTime < this.ctx.currentTime + 0.2) {
      this.play(this.step, this.nextTime);
      this.nextTime += STEP / tempo;
      this.step = (this.step + 1) % 256;
    }
  }

  private play(step: number, t: number) {
    const bar = Math.floor(step / 16) % 4;
    const s16 = step % 16;
    const chord = CHORDS[bar] ?? CHORDS[0] ?? [57, 60, 64];
    const I = this.intensity;
    // Kick on quarters + sidechain duck
    if (s16 % 4 === 0) {
      this.kick(t);
      this.duck.gain.setValueAtTime(0.35, t);
      this.duck.gain.linearRampToValueAtTime(1, t + STEP * 3);
    }
    // Bass: 8ths on the root
    if (s16 % 2 === 0) this.saw(midi((chord[0] ?? 57) - 24), t, STEP * 1.8, 0.16);
    // Arp: 16ths when intense, 8ths otherwise
    if (I > 0.45 || s16 % 2 === 0) {
      const n = chord[(s16 >> (I > 0.45 ? 0 : 1)) % 3] ?? 60;
      this.pluck(midi(n + 12 + (s16 % 8 === 7 ? 12 : 0)), t, 0.07 + I * 0.03);
    }
    // Pad at bar start
    if (s16 === 0) for (const n of chord) this.pad(midi(n), t, STEP * 16, 0.035);
    // Hats come in with intensity
    if (I > 0.25 && s16 % 2 === 1) this.hat(t, 0.04 + I * 0.05);
    if (I > 0.7 && s16 % 4 === 2) this.hat(t, 0.08);
    // Snare on 2 and 4 once things heat up
    if (I > 0.35 && (s16 === 4 || s16 === 12)) this.snare(t);
  }

  private env(g: GainNode, t: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.9, 0.22);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.25);
  }

  private saw(f: number, t: number, dur: number, peak: number) {
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const g = this.ctx.createGain();
    this.env(g, t, peak, dur);
    o.connect(g).connect(this.duck);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private pluck(f: number, t: number, peak: number) {
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.16);
    o.connect(g).connect(this.duck);
    o.start(t);
    o.stop(t + 0.2);
  }

  private pad(f: number, t: number, dur: number, peak: number) {
    for (const det of [-6, 6]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.duck);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private hat(t: number, peak: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.05);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.06);
  }

  private snare(t: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    this.env(g, t, 0.18, 0.14);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.15);
  }
}
