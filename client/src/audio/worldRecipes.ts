// World and loot sound recipes: destructibles (neon crates, barrels, glass, fences), bullet
// impacts, footsteps per surface, bush rustle, pickups by rarity, armor and heals, and the
// throwables (frag, smoke, shock mine). Registered into RECIPES by recipes.ts.

import { bell, chord, midi, noise, tick, tone, type Recipe } from "./synth";

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const DESTRUCTIBLES: Record<string, Recipe> = {
  /** Neon crate struck: a wooden knock with a faint metal-frame ring. */
  "crate:hit": (v) => {
    tone(v, "triangle", 380, 190, 0, 0.07, 0.24, 0.001);
    noise(v, "bandpass", 950, 480, 3, 0, 0.06, 0.26, 0.001);
    bell(v, 1240, 0.005, 0.14, 0.04, [1, 2.3]);
    return 0.15;
  },
  /** Crate bursting: splintering crunch, a hollow thud and the frame clattering. */
  "crate:break": (v) => {
    noise(v, "bandpass", 1900, 380, 1, 0, 0.32, 0.42, 0.001);
    tone(v, "sine", 150, 55, 0, 0.22, 0.34, 0.002);
    for (let i = 0; i < 6; i++) tick(v, rand(900, 2600), 0.02 + i * rand(0.025, 0.05), 0.22, 0.02);
    bell(v, 880, 0.08, 0.3, 0.07, [1, 2.4, 3.7]);
    return 0.45;
  },
  /** Barrel struck: a hollow metal clank. */
  "barrel:hit": (v) => {
    bell(v, 610, 0, 0.36, 0.14, [1, 2.3, 3.9]);
    tick(v, 2500, 0, 0.2, 0.015);
    tone(v, "sine", 180, 120, 0, 0.1, 0.16, 0.002);
    return 0.37;
  },
  /** Barrel explosion: big and low, a roaring body, crackle and a flying lid ping. */
  "barrel:explode": (v) => {
    tone(v, "sine", 72, 22, 0, 1.2, 0.7, 0.003);
    tone(v, "sine", 140, 40, 0, 0.35, 0.3, 0.002);
    noise(v, "lowpass", 2600, 50, 0.7, 0, 1.4, 0.55, 0.002);
    noise(v, "bandpass", 900, 200, 0.8, 0, 0.42, 0.34, 0.002);
    noise(v, "highpass", 2800, 1600, 0.7, 0.05, 0.8, 0.1, 0.03, { am: { rate: 19, depth: 0.5, type: "square" } });
    bell(v, 520, 0.12, 0.45, 0.05, [1, 2.7]);
    return 1.42;
  },
  /** Glass hit: a small tink. */
  "glass:hit": (v) => {
    bell(v, 3200 * rand(0.95, 1.05), 0, 0.22, 0.11, [1, 2.7]);
    tick(v, 6500, 0, 0.16, 0.01);
    return 0.23;
  },
  /** Glass shattering: a crack, then a cascade of falling tinkles. */
  "glass:shatter": (v) => {
    noise(v, "highpass", 6200, 3000, 0.6, 0, 0.42, 0.3, 0.001);
    tone(v, "sine", 160, 70, 0, 0.12, 0.18, 0.002);
    for (let i = 0; i < 10; i++) {
      const f = rand(2200, 5600);
      tone(v, "sine", f, f * 0.97, 0.02 + i * rand(0.02, 0.05) + i * i * 0.002, rand(0.12, 0.3), 0.05, 0.001);
    }
    return 0.75;
  },
  "fence:hit": (v) => {
    bell(v, 980, 0, 0.2, 0.1, [1, 1.9, 3.1]);
    noise(v, "bandpass", 3000, 1800, 2, 0, 0.08, 0.14, 0.002);
    return 0.21;
  },
  /** A neon fence panel collapsing: a metal crash with an electric spit. */
  "fence:break": (v) => {
    bell(v, 640, 0, 0.5, 0.12, [1, 1.7, 2.9, 4.3]);
    noise(v, "bandpass", 2600, 600, 1, 0, 0.35, 0.3, 0.001);
    noise(v, "bandpass", 3200, 1200, 3, 0.03, 0.2, 0.12, 0.002, { am: { rate: 60, depth: 0.5, type: "square" } });
    return 0.52;
  },
  /** A bullet hitting a wall: a short dusty tick. */
  "impact:bullet": (v) => {
    tick(v, rand(2200, 3200), 0, 0.5, 0.02);
    noise(v, "lowpass", 1400, 500, 1, 0, 0.05, 0.25, 0.001);
    return 0.06;
  },
  /** Ricochet off a wall (bouncing shots, lance beam bounce). */
  ricochet: (v) => {
    tone(v, "sine", 3200, 1700, 0, 0.16, 0.1, 0.001);
    tick(v, 4500, 0, 0.2, 0.012);
    return 0.17;
  },
};

const MOVEMENT: Record<string, Recipe> = {
  /** Footstep on hard floor: a soft heel tick. */
  "step:floor": (v) => {
    noise(v, "bandpass", 720, 420, 2, 0, 0.035, 0.2, 0.002);
    tone(v, "sine", 120, 70, 0, 0.04, 0.14, 0.002);
    return 0.05;
  },
  /** Wading through water: a splash and a bubble. */
  "step:water": (v) => {
    noise(v, "bandpass", 1100, 2600, 1.5, 0, 0.13, 0.24, 0.012);
    noise(v, "highpass", 4200, 3000, 0.7, 0.02, 0.09, 0.08, 0.01);
    tone(v, "sine", rand(380, 520), 200, 0.03, 0.05, 0.05, 0.003);
    return 0.15;
  },
  /** Brushing through a bush: leafy crackle. */
  "step:bush": (v) => {
    noise(v, "bandpass", 2600, 1700, 0.9, 0, 0.2, 0.2, 0.03, { am: { rate: rand(24, 36), depth: 0.5 } });
    tick(v, rand(3000, 4500), rand(0.02, 0.08), 0.12, 0.012);
    tick(v, rand(2500, 4000), rand(0.09, 0.15), 0.1, 0.012);
    return 0.21;
  },
};

const LOOT: Record<string, Recipe> = {
  /** Common gun: a solid "chk" grab. */
  "pickup:weapon:0": (v) => {
    tick(v, 1800, 0, 0.3, 0.025);
    tone(v, "square", 330, 260, 0, 0.04, 0.07, 0.001);
    tone(v, "triangle", 880, 880, 0.05, 0.08, 0.1, 0.004);
    return 0.14;
  },
  /** Rare: the grab plus a cool blue two-note chime. */
  "pickup:weapon:1": (v) => {
    tick(v, 1800, 0, 0.3, 0.025);
    tone(v, "triangle", midi(76), midi(76), 0.04, 0.12, 0.12, 0.004);
    tone(v, "triangle", midi(83), midi(83), 0.1, 0.16, 0.12, 0.004);
    return 0.27;
  },
  /** Epic: a purple shimmering chord. */
  "pickup:weapon:2": (v) => {
    tick(v, 1800, 0, 0.3, 0.025);
    chord(v, "triangle", [midi(76), midi(79), midi(83)], 0.04, 0.4, 0.16, 0.006, { vib: { rate: 6, cents: 12 } });
    bell(v, midi(95), 0.12, 0.35, 0.05, [1, 2.01]);
    return 0.45;
  },
  /** Legendary: a sparkling gold jingle up the scale with a shimmer tail. */
  "pickup:weapon:3": (v) => {
    tick(v, 1800, 0, 0.3, 0.025);
    [76, 80, 83, 88, 92].forEach((n, i) => bell(v, midi(n), 0.03 + i * 0.06, 0.5, 0.1, [1, 2.01, 3]));
    chord(v, "sawtooth", [midi(64), midi(68), midi(71)], 0.3, 0.6, 0.06, 0.04);
    noise(v, "highpass", 7500, 9500, 0.6, 0.1, 0.7, 0.07, 0.08, { am: { rate: 18, depth: 0.4 } });
    return 0.95;
  },
  /** Ammo box: rounds rattling, then the box clunk. */
  "pickup:ammo": (v) => {
    for (let i = 0; i < 5; i++) tick(v, rand(2600, 4200), i * 0.028, 0.22, 0.014);
    tone(v, "square", 260, 200, 0.15, 0.04, 0.08, 0.001);
    tick(v, 1200, 0.15, 0.26, 0.03);
    return 0.2;
  },
  /** Bandage or medkit picked up: a soft rustle and a friendly pop. */
  "pickup:item": (v) => {
    noise(v, "bandpass", 1600, 2600, 1.2, 0, 0.08, 0.14, 0.02);
    tone(v, "sine", 660, 990, 0.05, 0.08, 0.14, 0.004);
    return 0.14;
  },
  /** Grenade or mine picked up: a metal clink. */
  "pickup:throwable": (v) => {
    bell(v, 1700, 0, 0.2, 0.12, [1, 2.6]);
    tick(v, 3000, 0, 0.2, 0.015);
    return 0.21;
  },
  /** Armor on: velcro rip, a latch clunk and a low powered hum. */
  "armor:equip": (v) => {
    noise(v, "bandpass", 2400, 1600, 1, 0, 0.14, 0.32, 0.005, { am: { rate: 90, depth: 0.5, type: "square" } });
    tick(v, 900, 0.15, 0.5, 0.035);
    tone(v, "square", 180, 150, 0.15, 0.05, 0.08, 0.001);
    tone(v, "sawtooth", 110, 110, 0.17, 0.25, 0.05, 0.03);
    return 0.43;
  },
  /** Shield cell absorbed: a rising capacitor whine into a bright "full" ding. */
  "shield:charge": (v) => {
    tone(v, "sawtooth", 200, 1600, 0, 0.45, 0.08, 0.3, { vib: { rate: 14, cents: 25 } });
    tone(v, "sine", 400, 3200, 0, 0.45, 0.06, 0.3);
    bell(v, midi(91), 0.44, 0.4, 0.1, [1, 2.01]);
    noise(v, "highpass", 5000, 8000, 0.6, 0.3, 0.3, 0.05, 0.1);
    return 0.86;
  },
  /** Shield broken by damage: a glassy crack and a falling zap. */
  "armor:break": (v) => {
    noise(v, "highpass", 5000, 2500, 0.6, 0, 0.18, 0.3, 0.001);
    tone(v, "sawtooth", 1800, 160, 0, 0.25, 0.14, 0.001);
    for (let i = 0; i < 4; i++) tone(v, "sine", 2400 + i * 520, 2000 + i * 300, 0.01 + i * 0.02, 0.2, 0.05, 0.001);
    return 0.27;
  },
  /** Bandage finished: a warm rising third. */
  "heal:done": (v) => {
    tone(v, "sine", midi(72), midi(72), 0, 0.2, 0.18, 0.01);
    tone(v, "sine", midi(76), midi(76), 0.08, 0.26, 0.18, 0.01);
    return 0.36;
  },
  /** Medkit finished: a fuller chord bloom. */
  "heal:doneBig": (v) => {
    tone(v, "sine", midi(72), midi(72), 0, 0.22, 0.17, 0.01);
    tone(v, "sine", midi(76), midi(76), 0.07, 0.26, 0.17, 0.01);
    tone(v, "triangle", midi(79), midi(84), 0.14, 0.4, 0.13, 0.02);
    bell(v, midi(96), 0.3, 0.4, 0.05, [1, 2.01]);
    return 0.72;
  },
};

const THROWABLES: Record<string, Recipe> = {
  /** Pin pulled and spoon flicked. */
  "grenade:pin": (v) => {
    tick(v, 4200, 0, 0.26, 0.012);
    bell(v, 3500, 0.005, 0.1, 0.06, [1, 2.2]);
    tick(v, 2600, 0.12, 0.22, 0.015);
    return 0.16;
  },
  /** Arm swing whoosh. */
  "grenade:throw": (v) => {
    noise(v, "bandpass", 500, 1800, 1.5, 0, 0.16, 0.6, 0.04);
    return 0.17;
  },
  /** Grenade bouncing off a wall or the floor. */
  "grenade:bounce": (v) => {
    tone(v, "triangle", 950, 700, 0, 0.045, 0.16, 0.001);
    tick(v, 2100, 0, 0.16, 0.012);
    return 0.06;
  },
  /** Frag: a sharp bang, a mid roar and shrapnel crackle (tighter and brighter than a barrel). */
  "frag:explode": (v) => {
    noise(v, "highpass", 3500, 1500, 0.7, 0, 0.05, 0.38, 0.001);
    tone(v, "sine", 125, 34, 0, 0.62, 0.55, 0.002);
    noise(v, "lowpass", 4500, 80, 0.7, 0, 0.85, 0.5, 0.002);
    for (let i = 0; i < 7; i++) tick(v, rand(1800, 5000), 0.06 + i * rand(0.03, 0.07), 0.12, 0.015);
    return 0.9;
  },
  /** Smoke canister popping, then a long hiss as the cloud spreads. */
  "smoke:hiss": (v) => {
    tone(v, "sine", 320, 110, 0, 0.07, 0.24, 0.002);
    tick(v, 1500, 0, 0.2, 0.02);
    noise(v, "highpass", 3200, 1800, 0.6, 0.02, 2.4, 0.18, 0.08, { hold: 0.6, am: { rate: 7, depth: 0.15 } });
    noise(v, "bandpass", 900, 500, 0.8, 0.02, 1.6, 0.07, 0.2);
    return 2.45;
  },
  /** Shock mine landing and arming: a click, then two rising beeps. */
  "mine:arm": (v) => {
    tick(v, 1600, 0, 0.26, 0.02);
    tone(v, "square", midi(90), midi(90), 0.1, 0.05, 0.16, 0.002);
    tone(v, "square", midi(97), midi(97), 0.22, 0.07, 0.16, 0.002);
    return 0.3;
  },
  /** Shock mine triggered: a frantic beep, then an electric discharge. */
  "mine:trigger": (v) => {
    tone(v, "square", 2400, 2400, 0, 0.04, 0.1, 0.002);
    tone(v, "square", 2400, 2400, 0.06, 0.04, 0.1, 0.002);
    noise(v, "bandpass", 4000, 900, 1.5, 0.1, 0.5, 0.36, 0.002, { am: { rate: 65, depth: 0.5, type: "square" } });
    tone(v, "sawtooth", 1400, 90, 0.1, 0.4, 0.16, 0.001);
    tone(v, "sine", 110, 40, 0.1, 0.4, 0.42, 0.003);
    return 0.62;
  },
};

export const WORLD_RECIPES: Record<string, Recipe> = {
  ...DESTRUCTIBLES,
  ...MOVEMENT,
  ...LOOT,
  ...THROWABLES,
  // Effect-tracker lifecycle hooks (effectSounds.ts plays fx:<kind>:on when an effect appears).
  "fx:smoke:on": (v) => THROWABLES["smoke:hiss"]!(v),
  "fx:mine:on": (v) => THROWABLES["mine:arm"]!(v),
};
