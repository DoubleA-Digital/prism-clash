// Sound recipes. Each builds a short graph on `v.out` starting at time v.t and returns its
// duration. Names: plain events ("hit"), `cast:<power|ult>`, `pickup:<kind>`, and effect
// lifecycle sounds `fx:<kind>:on` / `fx:<kind>:off` played by the effect tracker.

import { POWER_CASTS, ULT_CASTS } from "./casts";
import { bell, chord, midi, noise, tick, tone, type Recipe } from "./synth";

export { noise, tone, type Recipe, type Voice } from "./synth";

const CORE: Record<string, Recipe> = {
  shoot: (v) => {
    tone(v, "square", 1400, 380, 0, 0.08, 0.12);
    noise(v, "highpass", 3000, 1500, 0.7, 0, 0.05, 0.08);
    return 0.1;
  },
  /** A dull, chunky thock. */
  hit: (v) => {
    tone(v, "triangle", 520, 170, 0, 0.09, 0.26);
    noise(v, "bandpass", 1800, 700, 2, 0, 0.06, 0.2);
    return 0.1;
  },
  /** Crit: a heavier thock plus a bright ringing "ting" that a normal hit never has. */
  crit: (v) => {
    tone(v, "square", 900, 200, 0, 0.12, 0.16);
    noise(v, "bandpass", 3500, 1200, 3, 0, 0.08, 0.2);
    bell(v, 2637, 0.015, 0.32, 0.16, [1, 2.4]);
    tone(v, "sine", 3951, 3951, 0.05, 0.22, 0.06);
    return 0.36;
  },
  hurt: (v) => {
    tone(v, "sawtooth", 180, 60, 0, 0.18, 0.24);
    noise(v, "lowpass", 900, 200, 1, 0, 0.15, 0.28);
    return 0.2;
  },
  /** Elimination: shattering crunch, a sub punch, and a falling neon chord. */
  kill: (v) => {
    tone(v, "sine", 140, 40, 0, 0.4, 0.34, 0.002);
    noise(v, "lowpass", 5000, 150, 0.8, 0, 0.5, 0.3, 0.002);
    for (let i = 0; i < 4; i++) tone(v, "sine", 2000 + i * 610, 1700 + i * 400, 0.01 + i * 0.02, 0.25, 0.05, 0.002);
    chord(v, "sawtooth", [midi(69), midi(64), midi(57)], 0.06, 0.6, 0.18, 0.005);
    tone(v, "square", 880, 220, 0.06, 0.5, 0.06);
    return 0.68;
  },
  dash: (v) => {
    noise(v, "bandpass", 600, 3200, 1.5, 0, 0.16, 0.45, 0.02);
    tone(v, "sine", 300, 900, 0, 0.12, 0.1);
    return 0.18;
  },
  crystal: (v) => {
    tone(v, "sine", 2600, 2400, 0, 0.12, 0.1);
    tone(v, "sine", 3900, 3700, 0, 0.1, 0.06);
    return 0.13;
  },
  shatter: (v) => {
    for (let i = 0; i < 6; i++) tone(v, "sine", 1800 + i * 430, 1500 + i * 300, i * 0.025, 0.4, 0.06);
    noise(v, "highpass", 5000, 2000, 0.5, 0, 0.35, 0.26);
    tone(v, "sine", 120, 60, 0, 0.2, 0.18);
    return 0.5;
  },
  pickup: (v) => {
    tone(v, "triangle", 660, 660, 0, 0.09, 0.18);
    tone(v, "triangle", 990, 990, 0.07, 0.12, 0.18);
    tone(v, "triangle", 1320, 1320, 0.14, 0.18, 0.15);
    return 0.34;
  },
  /** Warm rising major third with a soft swell. */
  "pickup:heal": (v) => {
    tone(v, "sine", midi(72), midi(72), 0, 0.2, 0.18, 0.01);
    tone(v, "sine", midi(76), midi(76), 0.08, 0.24, 0.18, 0.01);
    tone(v, "triangle", midi(79), midi(84), 0.16, 0.3, 0.12, 0.02);
    return 0.48;
  },
  /** Fast mechanical ratchet then a "ready" ding. */
  "pickup:cooldown": (v) => {
    for (let i = 0; i < 5; i++) tick(v, 2500 + i * 300, i * 0.03, 0.26);
    tone(v, "square", midi(84), midi(84), 0.16, 0.16, 0.1);
    tone(v, "sine", midi(91), midi(91), 0.16, 0.2, 0.08);
    return 0.38;
  },
  /** Charging riser into a power fifth. */
  "pickup:ult": (v) => {
    tone(v, "sawtooth", 220, 880, 0, 0.22, 0.1, 0.01);
    chord(v, "square", [midi(81), midi(88)], 0.2, 0.3, 0.16, 0.005);
    noise(v, "highpass", 4000, 8000, 0.7, 0, 0.25, 0.08, 0.15);
    return 0.52;
  },
  /** Rare core: a shimmering four-note fanfare. */
  "pickup:prism": (v) => {
    [72, 76, 79, 84].forEach((n, i) => tone(v, "triangle", midi(n), midi(n), i * 0.07, 0.35, 0.11, 0.005));
    bell(v, midi(96), 0.28, 0.6, 0.12);
    noise(v, "highpass", 7000, 9000, 0.5, 0.2, 0.4, 0.06, 0.05);
    return 0.88;
  },
  boom: (v) => {
    tone(v, "sine", 120, 35, 0, 0.6, 0.5, 0.01);
    noise(v, "lowpass", 2400, 90, 0.7, 0, 0.7, 0.42);
    return 0.72;
  },
  bounce: (v) => {
    tone(v, "triangle", 1500, 1900, 0, 0.06, 0.14);
    return 0.07;
  },
  portal: (v) => {
    tone(v, "sine", 300, 1200, 0, 0.22, 0.17, 0.03);
    tone(v, "sine", 1200, 300, 0.05, 0.22, 0.12, 0.03);
    return 0.3;
  },
  slam: (v) => {
    tone(v, "sine", 90, 40, 0, 0.35, 0.42);
    noise(v, "lowpass", 1500, 100, 0.8, 0, 0.3, 0.38);
    return 0.36;
  },
  combo: (v) => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => tone(v, "square", n, n, i * 0.06, 0.35, 0.12));
    tone(v, "sawtooth", 1047, 1047, 0.24, 0.5, 0.11);
    return 0.8;
  },
  zoneWarn: (v) => {
    tone(v, "sawtooth", 220, 220, 0, 0.4, 0.12, 0.05);
    tone(v, "sawtooth", 233, 233, 0, 0.4, 0.12, 0.05);
    tone(v, "sawtooth", 220, 220, 0.5, 0.4, 0.12, 0.05);
    tone(v, "sawtooth", 233, 233, 0.5, 0.4, 0.12, 0.05);
    return 1;
  },
  haunt: (v) => {
    tone(v, "sine", 600, 200, 0, 0.6, 0.14, 0.1);
    tone(v, "sine", 607, 203, 0, 0.6, 0.14, 0.1);
    return 0.65;
  },
  /** Low-HP heartbeat: lub-dub. */
  heartbeat: (v) => {
    tone(v, "sine", 75, 42, 0, 0.14, 0.42, 0.006);
    tone(v, "sine", 66, 38, 0.17, 0.16, 0.3, 0.006);
    noise(v, "lowpass", 220, 80, 1, 0, 0.1, 0.12, 0.004);
    return 0.34;
  },
  // ---- UI ----------------------------------------------------------------------------------
  ui: (v) => {
    tone(v, "triangle", 880, 1100, 0, 0.05, 0.12);
    tick(v, 4000, 0, 0.08, 0.01);
    return 0.06;
  },
  uiHover: (v) => {
    tone(v, "sine", 1320, 1480, 0, 0.04, 0.07);
    return 0.05;
  },
  uiClick: (v) => {
    tone(v, "square", 1200, 900, 0, 0.035, 0.08);
    tick(v, 5000, 0, 0.1, 0.012);
    return 0.05;
  },
  uiConfirm: (v) => {
    tone(v, "triangle", 660, 660, 0, 0.07, 0.14);
    tone(v, "triangle", 990, 990, 0.06, 0.12, 0.14);
    tone(v, "sine", 1980, 1980, 0.06, 0.15, 0.04);
    return 0.22;
  },
  uiBack: (v) => {
    tone(v, "triangle", 880, 880, 0, 0.06, 0.12);
    tone(v, "triangle", 587, 587, 0.055, 0.1, 0.12);
    return 0.17;
  },
  countdown: (v) => {
    tone(v, "square", 440, 440, 0, 0.15, 0.13);
    tone(v, "sine", 880, 880, 0, 0.15, 0.08);
    return 0.16;
  },
  fight: (v) => {
    tone(v, "sawtooth", 220, 880, 0, 0.5, 0.18, 0.02);
    tone(v, "square", 440, 1760, 0, 0.5, 0.09, 0.02);
    noise(v, "highpass", 2000, 8000, 0.7, 0, 0.4, 0.13);
    tone(v, "sine", 55, 50, 0, 0.5, 0.25, 0.005);
    return 0.55;
  },
  /** Generic cast for anything without its own recipe: a rising chime colored by the name. */
  cast: (v) => {
    const base = 300 + v.seed * 500;
    tone(v, "triangle", base, base * 2, 0, 0.25, 0.18, 0.01);
    tone(v, "sine", base * 1.5, base * 3, 0.03, 0.25, 0.1, 0.01);
    noise(v, "bandpass", base * 4, base * 2, 2, 0, 0.2, 0.1);
    return 0.3;
  },
};

/** Spawn (`on`) and end (`off`) sounds for world effects, played by the effect tracker. */
const EFFECT_LIFECYCLE: Record<string, Recipe> = {
  "fx:portal:on": (v) => {
    tone(v, "sine", 200, 900, 0, 0.3, 0.14, 0.05, { vib: { rate: 16, cents: 70 } });
    noise(v, "bandpass", 400, 2500, 8, 0, 0.3, 0.16, 0.1);
    return 0.32;
  },
  "fx:portal:off": (v) => {
    tone(v, "sine", 900, 160, 0, 0.26, 0.14, 0.01, { vib: { rate: 16, cents: 70 } });
    noise(v, "bandpass", 2500, 300, 8, 0, 0.22, 0.12);
    return 0.28;
  },
  /** The orb collapsing into a black hole. */
  "fx:singularity:on": (v) => {
    noise(v, "lowpass", 3000, 60, 1, 0, 0.4, 0.26, 0.3);
    tone(v, "sine", 300, 40, 0, 0.45, 0.32, 0.02);
    return 0.48;
  },
  "fx:clone:on": (v) => {
    tone(v, "triangle", 700, 1400, 0, 0.18, 0.12, 0.01, { detune: 15 });
    noise(v, "highpass", 6000, 9000, 0.6, 0, 0.18, 0.06, 0.03);
    return 0.2;
  },
  "fx:clone:off": (v) => {
    tone(v, "triangle", 1400, 500, 0, 0.14, 0.14, 0.002);
    noise(v, "highpass", 4000, 2000, 0.6, 0, 0.1, 0.12, 0.002);
    return 0.16;
  },
  "fx:decoy:off": (v) => {
    tone(v, "sine", 2200 + v.seed * 400, 900, 0, 0.1, 0.12, 0.002);
    noise(v, "highpass", 5000, 3000, 0.6, 0, 0.12, 0.14, 0.002);
    return 0.14;
  },
  /** Glaive caught or gone: a metallic clink. */
  "fx:glaive:off": (v) => {
    bell(v, 1870, 0, 0.25, 0.18, [1, 1.49, 2.76]);
    tick(v, 4500, 0, 0.2, 0.015);
    return 0.27;
  },
  "fx:sigil:on": (v) => {
    tone(v, "sine", 600, 1200, 0, 0.12, 0.12, 0.005, { vib: { rate: 20, cents: 40 } });
    tone(v, "triangle", 1200, 1200, 0.1, 0.1, 0.08, 0.002);
    return 0.22;
  },
  "fx:sigil:off": (v) => {
    noise(v, "bandpass", 1500, 400, 2, 0, 0.12, 0.45, 0.002);
    tone(v, "triangle", 900, 300, 0, 0.1, 0.1, 0.002);
    return 0.14;
  },
  "fx:lava:on": (v) => {
    noise(v, "highpass", 4000, 2000, 0.7, 0, 0.18, 0.1, 0.01, { am: { rate: 30, depth: 0.5, type: "square" } });
    return 0.2;
  },
  "fx:slowField:on": (v) => {
    tone(v, "triangle", 500, 60, 0, 0.4, 0.14, 0.005);
    return 0.42;
  },
  "fx:tether:on": (v) => {
    tone(v, "sawtooth", 1600, 400, 0, 0.12, 0.12, 0.002);
    noise(v, "highpass", 3000, 2000, 0.8, 0, 0.14, 0.16, 0.002, { am: { rate: 45, depth: 0.5, type: "square" } });
    return 0.16;
  },
  /** The tether snapping: a whip crack with an electric spit. */
  "fx:tether:off": (v) => {
    noise(v, "highpass", 2000, 6000, 0.7, 0, 0.06, 0.32, 0.001);
    tone(v, "sawtooth", 1800, 120, 0, 0.18, 0.14, 0.001);
    noise(v, "bandpass", 3000, 800, 3, 0.03, 0.15, 0.12, 0.002, { am: { rate: 60, depth: 0.5, type: "square" } });
    return 0.2;
  },
  "fx:bubble:on": (v) => {
    tone(v, "sine", 1400, 220, 0, 0.4, 0.16, 0.01);
    tone(v, "triangle", 700, 90, 0, 0.4, 0.1, 0.01);
    return 0.42;
  },
  /** Time snapping back: the reverse of the tape-stop. */
  "fx:bubble:off": (v) => {
    tone(v, "sine", 220, 1400, 0, 0.22, 0.14, 0.18);
    tone(v, "sine", 1800, 1800, 0.21, 0.06, 0.1, 0.002);
    return 0.28;
  },
  "fx:magnet:off": (v) => {
    noise(v, "bandpass", 3000, 400, 2, 0, 0.3, 0.2, 0.005);
    tone(v, "sawtooth", 220, 60, 0, 0.25, 0.08, 0.005);
    return 0.32;
  },
  "fx:meteorWarn:on": (v) => {
    tone(v, "square", 1320, 1320, 0, 0.05, 0.06);
    return 0.06;
  },
  "fx:rift:on": (v) => {
    noise(v, "bandpass", 300, 5000, 2, 0, 0.45, 0.3, 0.02, { am: { rate: 70, depth: 0.5, type: "square" } });
    tone(v, "sawtooth", 60, 40, 0, 0.45, 0.12, 0.02);
    return 0.48;
  },
  /** The rift slamming shut. */
  "fx:rift:off": (v) => {
    tone(v, "sine", 110, 30, 0, 0.5, 0.36, 0.002);
    noise(v, "lowpass", 3000, 100, 1, 0, 0.4, 0.3, 0.002);
    tick(v, 2000, 0, 0.3, 0.03);
    return 0.52;
  },
  "fx:shockwave:on": (v) => {
    noise(v, "bandpass", 2500, 200, 1.2, 0, 0.35, 0.24, 0.005);
    tone(v, "sine", 100, 45, 0, 0.3, 0.26, 0.004);
    return 0.36;
  },
  "fx:flash:on": (v) => {
    noise(v, "highpass", 5000, 9000, 0.6, 0, 0.18, 0.2, 0.002);
    tone(v, "sine", 3000, 4500, 0, 0.18, 0.08, 0.002);
    return 0.2;
  },
};

const CASTS: Record<string, Recipe> = {};
for (const [id, r] of Object.entries(POWER_CASTS)) CASTS[`cast:${id}`] = r;
for (const [id, r] of Object.entries(ULT_CASTS)) CASTS[`cast:${id}`] = r;

export const RECIPES: Record<string, Recipe> = { ...CORE, ...EFFECT_LIFECYCLE, ...CASTS };
