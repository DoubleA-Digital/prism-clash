// Weapon sound recipes: a distinct synthesized voice per gun, cheap "distant pop" variants
// for far fighters, rarity layers, per-class reload sequences, dry-fire clicks and swaps.
// Registered into RECIPES by recipes.ts; weapons.ts plays them.
//
// Recipe names: gun:<weapon>, gun:far:<weapon>, rarity:<1..3>, reload:<weapon>, gun:dry,
// gun:dry:energy, gun:swap, rocket:explode, blade:swing, blade:hit, blade:deflect, lance:full.

import { WEAPONS, type WeaponId } from "@prism/shared";
import { bell, noise, tick, tone, type Recipe } from "./synth";

// ---- gunshots (close) -----------------------------------------------------------------------

const SHOTS: Record<WeaponId, Recipe> = {
  /** Snappy crack: bright noise snap, a falling square click and a short body thump. */
  pistol: (v) => {
    noise(v, "highpass", 2600, 1200, 0.7, 0, 0.06, 0.34, 0.001);
    tone(v, "square", 1800, 300, 0, 0.05, 0.12, 0.001);
    tone(v, "sine", 230, 90, 0, 0.09, 0.32, 0.002);
    tick(v, 4200, 0, 0.18, 0.012);
    return 0.11;
  },
  /** Fast light tick: thin, short and high so a spray reads as a rattle, not a wall. */
  smg: (v) => {
    noise(v, "bandpass", 3600, 2000, 1.2, 0, 0.04, 0.28, 0.001);
    tone(v, "square", 1300, 520, 0, 0.032, 0.09, 0.001);
    tone(v, "sine", 190, 105, 0, 0.05, 0.2, 0.002);
    return 0.06;
  },
  /** Solid thump: weighty sub, a mid crack and a short gritty tail. */
  rifle: (v) => {
    tone(v, "sine", 150, 52, 0, 0.14, 0.44, 0.002);
    noise(v, "lowpass", 3800, 380, 0.8, 0, 0.13, 0.32, 0.001);
    noise(v, "highpass", 3200, 2200, 0.7, 0, 0.035, 0.18, 0.001);
    tone(v, "sawtooth", 620, 150, 0, 0.06, 0.08, 0.001);
    return 0.16;
  },
  /** Wide boom, then the pump rack (back, forward). */
  shotgun: (v) => {
    tone(v, "sine", 110, 36, 0, 0.36, 0.55, 0.002);
    noise(v, "lowpass", 5200, 180, 0.6, 0, 0.36, 0.46, 0.001);
    noise(v, "bandpass", 1300, 380, 0.6, 0, 0.22, 0.3, 0.001);
    noise(v, "highpass", 4000, 2500, 0.6, 0, 0.05, 0.2, 0.001);
    tick(v, 1700, 0.4, 0.3, 0.03);
    noise(v, "bandpass", 900, 700, 3, 0.4, 0.06, 0.24, 0.003);
    tick(v, 2600, 0.53, 0.32, 0.025);
    noise(v, "bandpass", 1500, 1200, 3, 0.53, 0.06, 0.22, 0.003);
    tone(v, "square", 320, 250, 0.53, 0.03, 0.05, 0.001);
    return 0.62;
  },
  /** Huge crack with a long rolling tail, then the bolt cycling. */
  sniper: (v) => {
    noise(v, "highpass", 4200, 2000, 0.7, 0, 0.05, 0.5, 0.001);
    tone(v, "square", 2400, 200, 0, 0.08, 0.14, 0.001);
    tone(v, "sine", 95, 30, 0, 0.5, 0.56, 0.002);
    noise(v, "lowpass", 2200, 80, 0.7, 0, 1.2, 0.3, 0.002);
    noise(v, "bandpass", 600, 180, 1, 0.06, 1.3, 0.12, 0.12);
    tick(v, 1500, 0.78, 0.3, 0.03);
    noise(v, "bandpass", 1100, 1500, 4, 0.82, 0.09, 0.2, 0.004);
    tick(v, 2200, 0.9, 0.24, 0.02);
    tick(v, 3000, 1.04, 0.3, 0.025);
    tone(v, "square", 400, 330, 1.04, 0.03, 0.05, 0.001);
    return 1.4;
  },
  /** Launch: a thump and a whoosh that opens up as the rocket leaves. */
  rocket: (v) => {
    tone(v, "sine", 120, 50, 0, 0.16, 0.42, 0.002);
    noise(v, "bandpass", 300, 2600, 1.2, 0, 0.5, 0.4, 0.03);
    tone(v, "sine", 70, 170, 0, 0.32, 0.22, 0.02);
    tone(v, "sawtooth", 130, 60, 0, 0.22, 0.07, 0.01);
    noise(v, "highpass", 5000, 7000, 0.6, 0.05, 0.4, 0.08, 0.1);
    return 0.56;
  },
  /** The beam zap: falling saw scream, a resonant ring and a punch. */
  lance: (v) => {
    tone(v, "sawtooth", 2600, 380, 0, 0.26, 0.24, 0.001);
    tone(v, "square", 1240, 1180, 0, 0.3, 0.1, 0.002, { vib: { rate: 38, cents: 60 } });
    noise(v, "highpass", 6500, 3000, 0.7, 0, 0.22, 0.2, 0.001);
    bell(v, 1760, 0.01, 0.42, 0.1, [1, 2.01, 3.03]);
    tone(v, "sine", 210, 55, 0, 0.22, 0.34, 0.002);
    return 0.44;
  },
  /** The blade's "shot" is its swing (see blade:swing). */
  blade: (v) => SWING(v),
};

const SWING: Recipe = (v) => {
  noise(v, "bandpass", 500, 3600, 2, 0, 0.21, 0.9, 0.06);
  tone(v, "sine", 380, 1300, 0, 0.16, 0.12, 0.04);
  tone(v, "sawtooth", 220, 330, 0, 0.2, 0.06, 0.03, { am: { rate: 42, depth: 0.5 }, detune: 9 });
  return 0.24;
};

// ---- gunshots (far) -------------------------------------------------------------------------
// A cheap low-passed pop per weapon: few nodes, but each gun keeps a recognizable weight.

/** body: low thump start freq, len: thump length, crack: dull crack freq, peak: level. */
function farPop(body: number, len: number, crack: number, peak: number, echo = 0): Recipe {
  return (v) => {
    tone(v, "sine", body, body * 0.4, 0, len, peak, 0.003);
    noise(v, "lowpass", crack, crack * 0.3, 0.8, 0, len * 0.9, peak * 0.8, 0.002);
    if (echo > 0) noise(v, "lowpass", crack * 0.5, 120, 0.7, 0.08, echo, peak * 0.35, 0.05);
    return Math.max(len, echo + 0.08) + 0.02;
  };
}

const FAR: Record<WeaponId, Recipe> = {
  pistol: farPop(320, 0.07, 1400, 0.4),
  smg: farPop(360, 0.045, 1600, 0.32),
  rifle: farPop(190, 0.11, 1100, 0.45),
  shotgun: farPop(130, 0.22, 900, 0.5, 0.3),
  sniper: farPop(110, 0.25, 1300, 0.55, 0.9),
  rocket: farPop(90, 0.3, 700, 0.4),
  lance: (v) => {
    tone(v, "triangle", 1300, 380, 0, 0.18, 0.2, 0.002);
    tone(v, "sine", 180, 70, 0, 0.12, 0.25, 0.003);
    return 0.2;
  },
  blade: farPop(500, 0.06, 1200, 0.15),
};

// ---- rarity layers --------------------------------------------------------------------------

const RARITY_LAYERS: Record<string, Recipe> = {
  /** Rare: a faint bright edge. */
  "rarity:1": (v) => {
    tone(v, "triangle", 2600, 2200, 0, 0.05, 0.05, 0.002);
    return 0.06;
  },
  /** Epic: extra sub weight and a chorused mid. */
  "rarity:2": (v) => {
    tone(v, "sine", 82, 44, 0, 0.13, 0.18, 0.003);
    tone(v, "sawtooth", 920, 420, 0, 0.06, 0.04, 0.002, { detune: 14 });
    tone(v, "sawtooth", 920, 420, 0, 0.06, 0.04, 0.002, { detune: -14 });
    return 0.14;
  },
  /** Legendary: a gold shimmer ringing over the shot, plus the epic weight. */
  "rarity:3": (v) => {
    tone(v, "sine", 82, 44, 0, 0.13, 0.16, 0.003);
    bell(v, 3136, 0.005, 0.34, 0.07, [1, 1.5, 2]);
    noise(v, "highpass", 8000, 9500, 0.6, 0, 0.22, 0.05, 0.01);
    return 0.36;
  },
};

// ---- reloads --------------------------------------------------------------------------------
// Timed from the weapon's reload length so the sounds line up with the HUD bar.

/** Magazine guns: mag out, mag in, then the slide or charging handle. */
function magReload(id: WeaponId, heavy: number): Recipe {
  const T = WEAPONS[id].reload;
  return (v) => {
    tick(v, 1400 / heavy, 0.08, 0.26, 0.03);
    noise(v, "bandpass", 800 / heavy, 600 / heavy, 3, 0.08, 0.08, 0.18, 0.004);
    noise(v, "bandpass", 1200, 2200, 2, T * 0.42, 0.12, 0.06, 0.03);
    tick(v, 1100 / heavy, T * 0.62, 0.34, 0.03);
    tone(v, "square", 210 / heavy, 170 / heavy, T * 0.62, 0.035, 0.07, 0.001);
    tick(v, 2400, T * 0.86, 0.26, 0.02);
    noise(v, "bandpass", 1800, 2600, 3, T * 0.86, 0.06, 0.16, 0.003);
    tick(v, 3000, T * 0.93, 0.28, 0.02);
    return T;
  };
}

/** Shotgun: shells pushed in one by one, then a pump. */
const shotgunReload: Recipe = (v) => {
  const T = WEAPONS.shotgun.reload;
  const shells = 4;
  for (let i = 0; i < shells; i++) {
    const at = 0.15 + (i * (T * 0.72)) / shells;
    tick(v, 1700 + i * 40, at, 0.26, 0.025);
    noise(v, "bandpass", 1100, 900, 3, at, 0.05, 0.18, 0.003);
    tone(v, "triangle", 520, 410, at + 0.01, 0.035, 0.06, 0.001);
  }
  tick(v, 1700, T * 0.86, 0.3, 0.03);
  noise(v, "bandpass", 900, 700, 3, T * 0.86, 0.06, 0.22, 0.003);
  tick(v, 2600, T * 0.95, 0.3, 0.025);
  return T;
};

/** Sniper: bolt up and back, magazine, bolt forward and down. */
const sniperReload: Recipe = (v) => {
  const T = WEAPONS.sniper.reload;
  tick(v, 1300, 0.12, 0.3, 0.03);
  noise(v, "bandpass", 900, 1700, 3, 0.16, 0.12, 0.2, 0.01);
  tick(v, 1200, T * 0.35, 0.24, 0.03);
  tick(v, 1000, T * 0.6, 0.34, 0.03);
  tone(v, "square", 190, 160, T * 0.6, 0.035, 0.07, 0.001);
  noise(v, "bandpass", 1700, 900, 3, T * 0.8, 0.1, 0.2, 0.01);
  tick(v, 2600, T * 0.9, 0.32, 0.025);
  tick(v, 3300, T * 0.96, 0.26, 0.02);
  return T;
};

/** Rocket: a heavy tube slides in and clunks home. */
const rocketReload: Recipe = (v) => {
  const T = WEAPONS.rocket.reload;
  tick(v, 900, 0.2, 0.26, 0.04);
  noise(v, "lowpass", 300, 1000, 2, T * 0.35, T * 0.35, 0.16, 0.08);
  tone(v, "sine", 130, 60, T * 0.75, 0.12, 0.3, 0.003);
  tick(v, 800, T * 0.75, 0.34, 0.04);
  tick(v, 2200, T * 0.92, 0.22, 0.02);
  return T;
};

/** Prism Lance: spent cell ejects with a hiss, a new one charges up to a ready ding. */
const lanceReload: Recipe = (v) => {
  const T = WEAPONS.lance.reload;
  noise(v, "highpass", 3000, 1200, 0.8, 0.05, 0.3, 0.16, 0.01);
  tick(v, 1600, 0.05, 0.24, 0.03);
  tick(v, 1300, T * 0.45, 0.28, 0.03);
  tone(v, "sawtooth", 180, 1400, T * 0.5, T * 0.4, 0.06, T * 0.3, { vib: { rate: 12, cents: 30 } });
  tone(v, "sine", 2093, 2093, T * 0.9, 0.18, 0.1, 0.004);
  tone(v, "sine", 3136, 3136, T * 0.93, 0.14, 0.05, 0.004);
  return T + 0.1;
};

const RELOADS: Record<string, Recipe> = {
  "reload:pistol": magReload("pistol", 0.8),
  "reload:smg": magReload("smg", 0.9),
  "reload:rifle": magReload("rifle", 1.15),
  "reload:shotgun": shotgunReload,
  "reload:sniper": sniperReload,
  "reload:rocket": rocketReload,
  "reload:lance": lanceReload,
};

// ---- misc -----------------------------------------------------------------------------------

const MISC: Record<string, Recipe> = {
  /** Empty trigger: a dry double click. */
  "gun:dry": (v) => {
    tick(v, 3400, 0, 0.32, 0.012);
    tick(v, 2100, 0.025, 0.2, 0.014);
    return 0.05;
  },
  /** Empty energy weapon: a sputtering fizzle. */
  "gun:dry:energy": (v) => {
    noise(v, "bandpass", 2400, 900, 3, 0, 0.12, 0.16, 0.003, { am: { rate: 55, depth: 0.5, type: "square" } });
    tone(v, "sawtooth", 500, 180, 0, 0.1, 0.05, 0.002);
    return 0.13;
  },
  /** Weapon swap: cloth rustle, then the new gun's latch click. */
  "gun:swap": (v) => {
    noise(v, "bandpass", 1400, 2600, 1.5, 0, 0.12, 0.14, 0.03);
    tick(v, 2200, 0.11, 0.28, 0.02);
    tone(v, "square", 420, 330, 0.11, 0.035, 0.06, 0.001);
    return 0.16;
  },
  /** Rocket blast: a deep sub drop, a wide roar and crackling debris. */
  "rocket:explode": (v) => {
    tone(v, "sine", 95, 26, 0, 0.9, 0.6, 0.003);
    noise(v, "lowpass", 3200, 60, 0.7, 0, 1.1, 0.5, 0.002);
    noise(v, "bandpass", 1500, 400, 0.8, 0, 0.3, 0.3, 0.002);
    noise(v, "highpass", 3000, 1800, 0.7, 0.06, 0.6, 0.1, 0.02, { am: { rate: 24, depth: 0.5, type: "square" } });
    return 1.15;
  },
  "blade:swing": SWING,
  /** Blade connecting: an electric sizzle with a meaty punch. */
  "blade:hit": (v) => {
    noise(v, "highpass", 5200, 2400, 0.8, 0, 0.3, 0.28, 0.002, { am: { rate: 70, depth: 0.5, type: "square" } });
    tone(v, "sawtooth", 950, 190, 0, 0.11, 0.18, 0.001);
    tone(v, "sine", 150, 60, 0, 0.12, 0.32, 0.002);
    return 0.32;
  },
  /** A bullet glancing off the blade: a bright metallic ping. */
  "blade:deflect": (v) => {
    bell(v, 2800, 0, 0.5, 0.2, [1, 2.4, 4.1]);
    tone(v, "triangle", 3200, 4300, 0, 0.08, 0.12, 0.001);
    tick(v, 6000, 0, 0.22, 0.01);
    return 0.5;
  },
  /** Lance fully charged. */
  "lance:full": (v) => {
    tone(v, "sine", 2637, 2637, 0, 0.12, 0.08, 0.003);
    tone(v, "sine", 3951, 3951, 0.02, 0.1, 0.05, 0.003);
    return 0.13;
  },
};

export const WEAPON_RECIPES: Record<string, Recipe> = {
  ...Object.fromEntries(Object.entries(SHOTS).map(([id, r]) => [`gun:${id}`, r])),
  ...Object.fromEntries(Object.entries(FAR).map(([id, r]) => [`gun:far:${id}`, r])),
  ...RARITY_LAYERS,
  ...RELOADS,
  ...MISC,
};
