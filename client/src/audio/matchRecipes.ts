// Match-flow sound recipes: supply drops, Prism Shards, zone warnings, kill confirm and the
// placement stingers. Registered into RECIPES by recipes.ts.

import { bell, chord, midi, noise, tick, tone, type Recipe } from "./synth";

export const MATCH_RECIPES: Record<string, Recipe> = {
  /** Supply drop announced: a two-tone klaxon, three times. */
  "supply:alarm": (v) => {
    for (let i = 0; i < 3; i++) {
      const at = i * 0.5;
      tone(v, "sawtooth", 660, 660, at, 0.22, 0.09, 0.02, { hold: 0.15 });
      tone(v, "square", 330, 330, at, 0.22, 0.04, 0.02, { hold: 0.15 });
      tone(v, "sawtooth", 520, 520, at + 0.24, 0.22, 0.09, 0.02, { hold: 0.15 });
      tone(v, "square", 260, 260, at + 0.24, 0.22, 0.04, 0.02, { hold: 0.15 });
    }
    return 1.5;
  },
  /** The crate falling: a long descending whistle that ends right at the landing. */
  "supply:whistle": (v) => {
    tone(v, "sine", 2600, 480, 0, 2.4, 0.12, 0.3, { vib: { rate: 7, cents: 18 }, hold: 1.6 });
    tone(v, "sine", 2610, 482, 0, 2.4, 0.06, 0.3, { hold: 1.6 });
    noise(v, "bandpass", 4000, 700, 4, 0, 2.4, 0.06, 0.5, { hold: 1.5 });
    return 2.42;
  },
  /** Landing: a heavy thud, dust and a metal crate rattle. */
  "supply:land": (v) => {
    tone(v, "sine", 82, 28, 0, 0.7, 0.7, 0.003);
    noise(v, "lowpass", 1300, 60, 0.7, 0, 0.7, 0.5, 0.002);
    bell(v, 310, 0.01, 0.55, 0.1, [1, 2.2, 3.6]);
    for (let i = 0; i < 4; i++) tick(v, 900 + i * 260, 0.08 + i * 0.06, 0.18, 0.025);
    chord(v, "triangle", [midi(69), midi(76), midi(81)], 0.3, 0.6, 0.08, 0.03);
    return 0.92;
  },
  /** Prism Shard picked up: a magical pentatonic cascade over a soft swell. */
  "shard:chime": (v) => {
    [81, 84, 88, 91, 93, 96].forEach((n, i) => bell(v, midi(n), i * 0.055, 0.7, 0.09, [1, 2.0, 3.01]));
    tone(v, "sine", midi(57), midi(57), 0, 1, 0.12, 0.25, { vib: { rate: 5, cents: 10 } });
    tone(v, "triangle", midi(69), midi(81), 0.05, 0.6, 0.06, 0.2);
    noise(v, "highpass", 8000, 10000, 0.6, 0.05, 0.9, 0.05, 0.2, { am: { rate: 22, depth: 0.4 } });
    return 1.05;
  },
  /** The shard draft opening for you: an airy upward whoosh. */
  "shard:draft": (v) => {
    noise(v, "bandpass", 600, 5000, 2, 0, 0.5, 0.16, 0.25);
    tone(v, "sine", 440, 1760, 0, 0.5, 0.06, 0.3);
    return 0.52;
  },
  /** A new zone stage: a falling two-tone warning over a low pulse. */
  "zone:warn": (v) => {
    for (let i = 0; i < 2; i++) {
      const at = i * 0.55;
      tone(v, "sawtooth", 440, 330, at, 0.42, 0.1, 0.03, { detune: 8 });
      tone(v, "sawtooth", 440, 330, at, 0.42, 0.1, 0.03, { detune: -8 });
      tone(v, "sine", 55, 50, at, 0.45, 0.3, 0.01);
    }
    noise(v, "lowpass", 400, 120, 1, 0, 1.1, 0.08, 0.3);
    return 1.12;
  },
  /** Your kill: a crisp confirm ding with a bass hit. */
  "kill:confirm": (v) => {
    tone(v, "sine", 90, 40, 0, 0.2, 0.36, 0.002);
    bell(v, midi(88), 0, 0.45, 0.14, [1, 2.0, 3.0]);
    bell(v, midi(95), 0.07, 0.45, 0.11, [1, 2.0]);
    tone(v, "square", midi(76), midi(76), 0, 0.08, 0.06, 0.002);
    return 0.53;
  },
  /** "#1": a triumphant rising fanfare into a held major chord with shimmer. */
  "sting:victory": (v) => {
    [69, 73, 76, 81, 85].forEach((n, i) => {
      tone(v, "sawtooth", midi(n), midi(n), i * 0.1, 0.24, 0.07, 0.006, { detune: 6 });
      tone(v, "triangle", midi(n), midi(n), i * 0.1, 0.24, 0.1, 0.004);
    });
    const hit = 0.52;
    chord(v, "sawtooth", [midi(57), midi(61), midi(64), midi(69), midi(73)], hit, 1.8, 0.16, 0.02, { hold: 0.6, vib: { rate: 5, cents: 8 } });
    chord(v, "triangle", [midi(81), midi(85), midi(88)], hit, 1.6, 0.12, 0.01, { hold: 0.4 });
    tone(v, "sine", 140, 40, hit, 0.5, 0.45, 0.003);
    for (let i = 0; i < 6; i++) tone(v, "triangle", 220, 160, 0.3 + i * 0.035, 0.06, 0.05 + i * 0.012, 0.002);
    noise(v, "highpass", 6000, 9000, 0.6, hit, 1.4, 0.08, 0.02);
    bell(v, midi(105), hit + 0.2, 0.9, 0.05, [1, 2.01]);
    return 2.4;
  },
  /** Close finish (top 3): a hopeful two-chord cadence. */
  "sting:placement": (v) => {
    chord(v, "triangle", [midi(65), midi(69), midi(72)], 0, 0.4, 0.15, 0.01);
    chord(v, "triangle", [midi(67), midi(71), midi(74)], 0.32, 0.9, 0.15, 0.01, { hold: 0.2 });
    bell(v, midi(86), 0.34, 0.6, 0.06);
    return 1.25;
  },
  /** Eliminated: a short sad falling minor line that sags in pitch. */
  "sting:eliminated": (v) => {
    [76, 72, 69, 64].forEach((n, i) => tone(v, "triangle", midi(n), midi(n) * 0.985, i * 0.16, 0.34, 0.13, 0.006));
    chord(v, "sawtooth", [midi(45), midi(52), midi(57), midi(60)], 0.5, 1.1, 0.07, 0.04, { detune: -12 });
    tone(v, "sine", 110, 70, 0.5, 0.9, 0.22, 0.02);
    return 1.62;
  },
};
