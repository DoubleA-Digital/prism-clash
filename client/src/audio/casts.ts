// One characterful cast sound per power and ultimate. Powers are punchy (0.3–0.9 s, layers
// ~0.1–0.3); ultimates layer more elements and run a little hotter and longer.

import type { PowerId, UltId } from "@prism/shared";
import { bell, chord, midi, noise, tick, tone, type Recipe } from "./synth";

export const POWER_CASTS: Record<PowerId, Recipe> = {
  /** Reversed whoosh that swells into a snap, with clock ticks running backwards. */
  chronoRewind: (v) => {
    noise(v, "bandpass", 400, 3200, 2, 0, 0.42, 0.45, 0.36);
    tone(v, "sine", 1100, 220, 0, 0.42, 0.14, 0.34, { vib: { rate: 14, cents: 40 } });
    [0.08, 0.17, 0.24, 0.3, 0.35].forEach((s, i) => tick(v, i % 2 ? 2400 : 3200, s, 0.5));
    tone(v, "triangle", 1760, 1760, 0.42, 0.14, 0.14, 0.002);
    return 0.58;
  },
  /** Deep sub drop with a warbling gravity well. */
  singularity: (v) => {
    tone(v, "sine", 180, 38, 0, 0.75, 0.36, 0.01);
    tone(v, "triangle", 320, 70, 0, 0.6, 0.12, 0.02, { vib: { rate: 9, cents: 120 } });
    noise(v, "lowpass", 900, 80, 1.5, 0, 0.7, 0.2, 0.15);
    return 0.78;
  },
  /** A rising chime doubled a beat later and slightly detuned, like a reflection. */
  mirrorSelf: (v) => {
    tone(v, "triangle", 520, 1040, 0, 0.28, 0.2, 0.01);
    tone(v, "triangle", 525, 1050, 0.09, 0.3, 0.14, 0.01, { detune: 18 });
    tone(v, "sine", 1560, 2080, 0.05, 0.3, 0.07, 0.02, { vib: { rate: 7, cents: 25 } });
    noise(v, "highpass", 6000, 9000, 0.7, 0, 0.3, 0.07, 0.05);
    return 0.42;
  },
  /** Phasey up/down sweep through a resonant swirl. */
  portalPair: (v) => {
    tone(v, "sine", 260, 1300, 0, 0.28, 0.18, 0.03, { vib: { rate: 18, cents: 60 } });
    tone(v, "sine", 1300, 260, 0.12, 0.3, 0.13, 0.03, { vib: { rate: 18, cents: 60 } });
    noise(v, "bandpass", 500, 4200, 9, 0, 0.42, 0.26, 0.08, { am: { rate: 11, depth: 0.4 } });
    return 0.45;
  },
  /** Electric zap with a buzzing crackle. */
  stormTether: (v) => {
    tone(v, "sawtooth", 2200, 180, 0, 0.16, 0.12, 0.002);
    tone(v, "square", 120, 110, 0, 0.36, 0.1, 0.004, { am: { rate: 60, depth: 0.45, type: "square" } });
    noise(v, "highpass", 3500, 2500, 0.8, 0, 0.36, 0.22, 0.002, { am: { rate: 37, depth: 0.5, type: "square" } });
    return 0.38;
  },
  /** Tape-stop: everything sags down in pitch and filter together. */
  timeBubble: (v) => {
    tone(v, "sawtooth", 880, 55, 0, 0.62, 0.13, 0.005);
    tone(v, "triangle", 440, 28, 0, 0.62, 0.18, 0.005);
    noise(v, "lowpass", 4000, 120, 1, 0, 0.55, 0.16, 0.005);
    tone(v, "sine", 1760, 1760, 0, 0.12, 0.07);
    return 0.65;
  },
  /** Cascade of crystalline pings climbing a pentatonic scale. */
  ricochetPrism: (v) => {
    [2093, 2637, 3136, 3951, 4699].forEach((f, i) => {
      tone(v, "sine", f, f, i * 0.045, 0.24, 0.14, 0.002);
      tone(v, "sine", f * 1.5, f * 1.5, i * 0.045, 0.1, 0.04, 0.002);
    });
    noise(v, "highpass", 7000, 5000, 0.5, 0, 0.12, 0.08);
    return 0.48;
  },
  /** Ghostly swoosh with a wavering, hollow voice. */
  phantomMark: (v) => {
    noise(v, "bandpass", 300, 1800, 3, 0, 0.45, 0.4, 0.14);
    tone(v, "sine", 520, 340, 0, 0.5, 0.2, 0.08, { vib: { rate: 6, cents: 45 } });
    tone(v, "sine", 780, 510, 0.04, 0.46, 0.06, 0.08, { vib: { rate: 6.5, cents: 45 } });
    return 0.52;
  },
  /** Digital glitch: stuttering square blips, then two tones that cross over. */
  hexSwap: (v) => {
    [1200, 300, 1500, 240, 1800, 200].forEach((f, i) => tone(v, "square", f, f, i * 0.028, 0.026, 0.12, 0.001));
    tone(v, "sine", 380, 1600, 0.17, 0.2, 0.16, 0.005);
    tone(v, "sine", 1600, 380, 0.17, 0.2, 0.16, 0.005);
    noise(v, "bandpass", 2500, 2500, 4, 0.17, 0.06, 0.18, 0.001);
    return 0.4;
  },
  /** Magnetic hum that rises and tightens. */
  magnetar: (v) => {
    tone(v, "sawtooth", 55, 110, 0, 0.6, 0.15, 0.22, { am: { rate: 30, depth: 0.35 } });
    tone(v, "sine", 110, 220, 0, 0.6, 0.2, 0.22);
    noise(v, "bandpass", 200, 900, 4, 0, 0.6, 0.15, 0.25);
    return 0.62;
  },
  /** High shimmer that fades away as you vanish. */
  voidCloak: (v) => {
    [2900, 3600, 4400, 5300].forEach((f, i) => tone(v, "sine", f, f * 0.8, i * 0.02, 0.65, 0.07, 0.01, { vib: { rate: 9 + i, cents: 30 } }));
    noise(v, "highpass", 9000, 3000, 0.7, 0, 0.6, 0.1, 0.01);
    tone(v, "triangle", 900, 300, 0, 0.3, 0.1, 0.005);
    return 0.68;
  },
  /** Sizzle on top of a low roar. */
  moltenPath: (v) => {
    noise(v, "lowpass", 400, 1400, 1.2, 0, 0.6, 0.45, 0.05);
    noise(v, "highpass", 5000, 3500, 0.7, 0, 0.6, 0.2, 0.02, { am: { rate: 23, depth: 0.5, type: "square" } });
    tone(v, "sawtooth", 70, 48, 0, 0.55, 0.13, 0.04);
    return 0.62;
  },
  /** Metallic whirr of a spinning blade, with a ringing edge. */
  boomerangGlaive: (v) => {
    tone(v, "square", 260, 340, 0, 0.42, 0.1, 0.01, { am: { rate: 28, depth: 0.5 } });
    noise(v, "bandpass", 2600, 3200, 8, 0, 0.42, 0.5, 0.01, { am: { rate: 28, depth: 0.5 } });
    tone(v, "triangle", 1870, 1870, 0, 0.3, 0.1, 0.002);
    tone(v, "sine", 2790, 2790, 0, 0.22, 0.06, 0.002);
    return 0.45;
  },
  /** Wobbly flip: a warbling tone that goes up and comes back down. */
  gravityFlip: (v) => {
    tone(v, "sine", 300, 900, 0, 0.18, 0.2, 0.01, { vib: { rate: 12, cents: 250 } });
    tone(v, "sine", 900, 260, 0.17, 0.24, 0.2, 0.01, { vib: { rate: 12, cents: 250 } });
    tone(v, "triangle", 150, 450, 0, 0.4, 0.08, 0.02);
    return 0.43;
  },
  /** A bright bell over a low gong. */
  bountyBeacon: (v) => {
    bell(v, midi(81), 0, 0.85, 0.18);
    tone(v, "sine", 110, 104, 0, 0.85, 0.16, 0.005);
    tone(v, "sine", 165, 160, 0, 0.6, 0.08, 0.005);
    tick(v, 3000, 0, 0.2, 0.03);
    return 0.88;
  },
  /** Holographic sparkle chorus: a scattered high chord with fizz. */
  decoySwarm: (v) => {
    [72, 76, 79, 83, 86].forEach((n, i) => tone(v, "triangle", midi(n), midi(n), i * 0.03, 0.34, 0.09, 0.01, { vib: { rate: 7 + i, cents: 20 }, detune: (i - 2) * 9 }));
    noise(v, "highpass", 6000, 9000, 0.6, 0, 0.4, 0.1, 0.02, { am: { rate: 17, depth: 0.5 } });
    return 0.5;
  },
  /** Big upward whoosh as you leap (the impact is its own sound). */
  shockwaveSlam: (v) => {
    noise(v, "bandpass", 180, 2600, 1.4, 0, 0.36, 0.34, 0.26);
    tone(v, "sine", 70, 320, 0, 0.36, 0.18, 0.24);
    tone(v, "sawtooth", 110, 440, 0.05, 0.31, 0.05, 0.22);
    return 0.38;
  },
  /** Menacing dissonant stab. */
  thirdParty: (v) => {
    chord(v, "sawtooth", [midi(45), midi(51), midi(57), midi(60)], 0, 0.42, 0.26, 0.004);
    tone(v, "sawtooth", midi(33), midi(31), 0, 0.42, 0.14, 0.004);
    noise(v, "lowpass", 3000, 300, 0.8, 0, 0.12, 0.16, 0.002);
    return 0.45;
  },
};

export const ULT_CASTS: Record<UltId, Recipe> = {
  /** Low rumble with a descending whistle and an alarm blip. */
  meteorRain: (v) => {
    tone(v, "sine", 2400, 320, 0, 0.85, 0.12, 0.05);
    noise(v, "lowpass", 380, 80, 0.9, 0, 0.9, 0.32, 0.2);
    tone(v, "sine", 62, 44, 0, 0.9, 0.3, 0.1);
    tone(v, "square", 880, 880, 0, 0.08, 0.08);
    tone(v, "square", 880, 880, 0.12, 0.08, 0.08);
    return 0.92;
  },
  /** White-hot surge: a crackling electric riser that ends in a power chord. */
  overdrive: (v) => {
    tone(v, "sawtooth", 110, 880, 0, 0.45, 0.16, 0.02, { am: { rate: 40, depth: 0.4 } });
    tone(v, "square", 220, 1760, 0, 0.45, 0.07, 0.02);
    noise(v, "highpass", 3000, 7000, 0.7, 0, 0.5, 0.16, 0.05, { am: { rate: 31, depth: 0.5, type: "square" } });
    chord(v, "sawtooth", [midi(45), midi(52), midi(57)], 0.42, 0.45, 0.3, 0.005);
    tone(v, "sine", 55, 50, 0.42, 0.45, 0.3, 0.005);
    return 0.9;
  },
  /** Reality tearing: a ripping noise sweep over a sub drop. */
  riftCollapse: (v) => {
    noise(v, "bandpass", 3200, 180, 3, 0, 0.8, 0.4, 0.01, { am: { rate: 50, depth: 0.45, type: "square" } });
    tone(v, "sine", 90, 30, 0, 0.9, 0.34, 0.01);
    tone(v, "sawtooth", 200, 50, 0, 0.8, 0.09, 0.01, { detune: -15 });
    tone(v, "sawtooth", 200, 50, 0, 0.8, 0.09, 0.01, { detune: 15 });
    return 0.92;
  },
  /** A chime that echoes into a storm of repeats. */
  echoStorm: (v) => {
    for (let i = 0; i < 5; i++) {
      const g = 0.24 * 0.7 ** i;
      tone(v, "triangle", midi(76 + i * 2), midi(88 + i * 2), i * 0.13, 0.22, g, 0.005);
      tone(v, "sine", midi(83 + i * 2), midi(83 + i * 2), i * 0.13, 0.18, g * 0.5, 0.005);
    }
    noise(v, "bandpass", 1000, 6000, 2, 0, 0.8, 0.14, 0.4);
    tone(v, "sine", 82, 82, 0, 0.8, 0.18, 0.3);
    return 0.86;
  },
  /** A heroic swell: power chord with a gong strike and a rising charge. */
  finalStand: (v) => {
    chord(v, "sawtooth", [midi(45), midi(52), midi(57), midi(64)], 0, 0.9, 0.22, 0.12, { hold: 0.3 });
    bell(v, midi(57), 0, 0.9, 0.2);
    tone(v, "sine", 200, 800, 0, 0.8, 0.1, 0.5);
    tone(v, "sine", 55, 55, 0, 0.9, 0.2, 0.02);
    return 0.92;
  },
  /** Predator sonar: a long ping with its echo, over an eerie fifth drone. */
  huntersEye: (v) => {
    tone(v, "sine", 1400, 1380, 0, 0.75, 0.3, 0.002);
    tone(v, "sine", 2800, 2760, 0, 0.3, 0.08, 0.002);
    tone(v, "sine", 1400, 1380, 0.3, 0.55, 0.12, 0.002);
    chord(v, "sawtooth", [midi(33), midi(40)], 0, 0.85, 0.18, 0.2);
    noise(v, "bandpass", 700, 700, 12, 0, 0.8, 0.1, 0.3);
    return 0.88;
  },
};
