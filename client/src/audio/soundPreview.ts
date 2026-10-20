// Dev-only soundboard (client/sound-preview.html, served by `vite` at /sound-preview.html and
// never part of the production build). Buttons drive the real v2 audio API, mostly through
// playGameAudio with synthetic events, so the dispatcher, positional mixer, voice caps,
// sustains and music director are auditioned exactly as the game uses them.

import { ITEMS, PROJ, SUPPLY, WEAPON_IDS, WEAPONS, type GameEvent, type NetProjectile, type SolidKind, type ThrowableId, type WeaponId } from "@prism/shared";
import { audio } from "./audio";
import {
  dryFire, lanceCharge, placementSting, playGameAudio, trackFootsteps, trackProjectiles, weaponSwap,
  type GameAudioContext, type Surface,
} from "./gameAudio";
import { RECIPES } from "./recipes";
import { sustains } from "./sustains";

const ME = 1;
const OTHER = 2;
const S = { dist: 300, angle: 0, own: false, rarity: 0, intensity: 0.1, duel: false };
const SOLID_IDS: Record<number, SolidKind> = { 1: "crate", 2: "barrel", 3: "glass", 4: "fence" };
const SOLID_ID: Record<"crate" | "barrel" | "glass" | "fence", number> = { crate: 1, barrel: 2, glass: 3, fence: 4 };

const pos = () => {
  const a = (S.angle * Math.PI) / 180;
  return S.own ? { x: 0, y: 0 } : { x: Math.cos(a) * S.dist, y: Math.sin(a) * S.dist };
};
const by = () => (S.own ? ME : OTHER);

const ctx: GameAudioContext = {
  myId: ME,
  rarityOf: () => S.rarity,
  solidKind: (id) => SOLID_IDS[id] ?? null,
  posOf: () => pos(),
  ownShotsPredicted: false,
};

function ensure() {
  audio.unlock();
  audio.setListener(0, 0);
}

function ev(e: GameEvent) {
  ensure();
  playGameAudio(e, ctx);
}

const later = (ms: number, f: () => void) => window.setTimeout(f, ms);

// ---- DOM helpers ------------------------------------------------------------------------------

const board = document.getElementById("board")!;
const controls = document.getElementById("controls")!;

function section(title: string): HTMLElement {
  const s = document.createElement("section");
  const h = document.createElement("h2");
  h.textContent = title;
  const g = document.createElement("div");
  g.className = "grid";
  s.append(h, g);
  board.append(s);
  return g;
}

function button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", () => {
    ensure();
    onClick();
  });
  parent.append(b);
  return b;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) {
  const l = document.createElement("label");
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = document.createElement("output");
  out.textContent = String(value);
  input.addEventListener("input", () => {
    out.textContent = input.value;
    onInput(Number(input.value));
  });
  l.append(label, input, out);
  controls.append(l);
}

function checkbox(label: string, onChange: (v: boolean) => void) {
  const l = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.addEventListener("change", () => onChange(input.checked));
  l.append(input, label);
  controls.append(l);
}

// ---- controls ---------------------------------------------------------------------------------

const unlock = document.createElement("button");
unlock.id = "unlock";
unlock.textContent = "Start audio";
unlock.addEventListener("click", () => {
  ensure();
  unlock.textContent = "Audio on";
});
controls.append(unlock);
slider("Distance", 0, 4500, 50, S.dist, (v) => (S.dist = v));
slider("Side (deg)", -180, 180, 15, S.angle, (v) => (S.angle = v));
slider("Rarity", 0, 3, 1, S.rarity, (v) => (S.rarity = v));
checkbox("Own (you, centered)", (v) => (S.own = v));

// ---- weapons ----------------------------------------------------------------------------------

const weapons = section("Weapons (shots past 1250u switch to distant pops)");
for (const w of WEAPON_IDS) {
  if (w === "lance" || w === "blade") continue;
  button(weapons, `${WEAPONS[w].name}`, () => {
    const p = pos();
    ev({ t: "shoot", by: by(), x: p.x, y: p.y, angle: 0, weapon: w });
  });
}
const auto = section("Full-auto bursts");
for (const w of ["smg", "rifle", "pistol"] as const) {
  button(auto, `${WEAPONS[w].name} x10`, () => {
    for (let i = 0; i < 10; i++) later(i * WEAPONS[w].fireCd * 1000, () => ev({ t: "shoot", by: by(), ...pos(), angle: 0, weapon: w }));
  });
}

const reloads = section("Reload, dry fire, swap");
for (const w of WEAPON_IDS) {
  if (w !== "blade") button(reloads, `Reload ${WEAPONS[w].name}`, () => ev({ t: "reload", by: by(), weapon: w }));
}
for (const w of ["pistol", "shotgun", "lance"] as const) button(reloads, `Dry fire ${WEAPONS[w].name}`, () => dryFire(w));
for (const w of ["smg", "sniper"] as const) button(reloads, `Swap to ${WEAPONS[w].name}`, () => weaponSwap(w, S.rarity));

const special = section("Rocket, Prism Lance, Energy Blade");
button(special, "Rocket launch", () => ev({ t: "shoot", by: by(), ...pos(), angle: 0, weapon: "rocket" }));
button(special, "Rocket explosion", () => ev({ t: "explode", ...pos(), r: 170, source: "rocket", by: by() }));
button(special, "Rocket launch + hit", () => {
  ev({ t: "shoot", by: by(), ...pos(), angle: 0, weapon: "rocket" });
  later(700, () => ev({ t: "explode", ...pos(), r: 170, source: "rocket", by: by() }));
});
const lance = button(special, "Lance: hold to charge, release to fire", () => undefined);
let lanceTimer = 0;
let lanceStart = 0;
lance.addEventListener("pointerdown", () => {
  ensure();
  lanceStart = performance.now();
  lanceTimer = window.setInterval(() => {
    const p = pos();
    const k = Math.min(1, (performance.now() - lanceStart) / 1000 / WEAPONS.lance.chargeTime);
    if (S.own) lanceCharge(by(), k);
    else lanceCharge(by(), k, p.x, p.y);
  }, 16);
});
const fireLance = () => {
  if (!lanceTimer) return;
  window.clearInterval(lanceTimer);
  lanceTimer = 0;
  ev({ t: "shoot", by: by(), ...pos(), angle: 0, weapon: "lance" });
};
lance.addEventListener("pointerup", fireLance);
lance.addEventListener("pointerleave", fireLance);
button(special, "Blade swing", () => ev({ t: "slash", by: by(), ...pos(), angle: 0 }));
button(special, "Blade hit", () => ev({ t: "hit", target: 9, by: by(), amount: 42, crit: false, source: "blade", ...pos(), armor: false }));
button(special, "Blade deflect", () => ev({ t: "deflect", by: by(), ...pos() }));

// ---- world ------------------------------------------------------------------------------------

const world = section("World");
for (const k of ["crate", "barrel", "glass", "fence"] as const) {
  button(world, `${k} hit`, () => ev({ t: "solidHit", id: SOLID_ID[k], ...pos() }));
}
button(world, "crate break", () => ev({ t: "solidBroken", id: SOLID_ID.crate, ...pos() }));
button(world, "glass shatter", () => ev({ t: "solidBroken", id: SOLID_ID.glass, ...pos() }));
button(world, "fence break", () => ev({ t: "solidBroken", id: SOLID_ID.fence, ...pos() }));
button(world, "barrel explosion", () => {
  ev({ t: "solidBroken", id: SOLID_ID.barrel, ...pos() });
  ev({ t: "explode", ...pos(), r: 190, source: "barrel", by: 0 });
});
button(world, "bullet impact", () => ev({ t: "impact", ...pos(), color: 0, size: 1 }));
button(world, "ricochet", () => ev({ t: "bounce", ...pos(), n: 1 }));

const moves = section("Footsteps (2 s walk at the chosen spot) and bush rustle");
let walkTimer = 0;
function walk(surface: Surface, enterBush = false) {
  window.clearInterval(walkTimer);
  const start = pos();
  const t0 = performance.now();
  const id = by();
  walkTimer = window.setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    if (t > 2) {
      window.clearInterval(walkTimer);
      return;
    }
    const x = start.x + t * 270;
    trackFootsteps([{ id, x, y: start.y }], () => (enterBush ? (t > 0.6 ? "bush" : "floor") : surface), ME);
  }, 16);
}
button(moves, "Walk: floor", () => walk("floor"));
button(moves, "Walk: water", () => walk("water"));
button(moves, "Walk: bush", () => walk("bush"));
button(moves, "Walk into a bush", () => walk("floor", true));

// ---- loot, heals, throwables -------------------------------------------------------------------

const loot = section("Loot and items");
for (let r = 0; r < 4; r++) {
  button(loot, `Weapon pickup (${["common", "rare", "epic", "legendary"][r]})`, () => ev({ t: "loot", by: by(), kind: "weapon", weapon: "rifle", rarity: r, ...pos() }));
}
for (const kind of ["ammo", "bandage", "medkit", "throwable", "shard"] as const) {
  button(loot, `${kind} pickup`, () => {
    ev({ t: "loot", by: by(), kind, weapon: "pistol", rarity: 0, ...pos() });
    if (kind === "shard") ev({ t: "shard", by: by() });
  });
}
button(loot, "Shield cell (armor equip + charge)", () => {
  ev({ t: "loot", by: by(), kind: "shield", weapon: "pistol", rarity: 0, ...pos() });
  ev({ t: "heal", by: by(), item: "shield", done: true });
});

const heals = section("Heals");
for (const item of ["bandage", "medkit"] as const) {
  button(heals, `Use ${item} (${ITEMS[item].time}s)`, () => {
    const who = by();
    ev({ t: "heal", by: who, item, done: false });
    later(ITEMS[item].time * 1000, () => ev({ t: "heal", by: who, item, done: true }));
  });
}
button(heals, "Cancel heals", () => sustains.release(`heal:${by()}`));

const throws = section("Throwables");
function grenade(item: ThrowableId) {
  const p = pos();
  const who = by();
  ev({ t: "throw", by: who, ...p, item });
  const g: NetProjectile = { id: 99, x: p.x, y: p.y, vx: 600, vy: 0, owner: who, kind: PROJ.grenade, flags: 0, bounces: 0, shotId: 0, r: 9, source: item, weapon: null, rarity: 0 };
  const t0 = performance.now();
  const fuse = ITEMS.throwables[item].fuse * 1000;
  const timer = window.setInterval(() => {
    const t = performance.now() - t0;
    if (t > fuse) {
      window.clearInterval(timer);
      trackProjectiles([]);
      if (item === "frag") ev({ t: "explode", ...pos(), r: 180, source: "frag", by: who });
      else audio.sfx(item === "smoke" ? "fx:smoke:on" : "fx:mine:on", p.x, p.y, { positional: !S.own });
      return;
    }
    const speed = 600 * Math.exp(-t / 600);
    g.vx = (Math.floor(t / 330) % 2 === 0 ? 1 : -1) * speed;
    trackProjectiles([g]);
  }, 30);
}
button(throws, "Frag (pin, bounces, explosion)", () => grenade("frag"));
button(throws, "Smoke (bounces, hiss)", () => grenade("smoke"));
button(throws, "Shock mine (arm)", () => grenade("mine"));
button(throws, "Shock mine trigger", () => ev({ t: "explode", ...pos(), r: 110, source: "mine", by: by() }));

// ---- match ------------------------------------------------------------------------------------

const match = section("Match flow");
let droneTimer = 0;
button(match, `Supply drop (full ${SUPPLY.fallTime}s sequence)`, () => {
  const p = pos();
  ev({ t: "supply", ...p, landed: false });
  later(SUPPLY.fallTime * 1000, () => ev({ t: "supply", ...p, landed: true }));
});
button(match, "Supply whistle", () => audio.sfx("supply:whistle", pos().x, pos().y, { range: 4200, ref: 900 }));
button(match, "Supply landing", () => ev({ t: "supply", ...pos(), landed: true }));
button(match, "Zone stage warning", () => ev({ t: "zoneStage", stage: 2 }));
const drone = button(match, "Zone drone (toggle)", () => {
  drone.classList.toggle("on");
  window.clearInterval(droneTimer);
  if (!drone.classList.contains("on")) return sustains.release("zone");
  droneTimer = window.setInterval(() => sustains.hold("zone", "zoneDrone", { param: S.intensity, level: 1 }), 100);
});
button(match, "Low-HP heartbeat", () => audio.sfx("heartbeat", 0, 0, { positional: false }));
button(match, "Hit (yours)", () => ev({ t: "hit", target: OTHER, by: ME, amount: 15, crit: false, source: "rifle", ...pos(), armor: false }));
button(match, "Crit (yours)", () => ev({ t: "hit", target: OTHER, by: ME, amount: 30, crit: true, source: "sniper", ...pos(), armor: false }));
button(match, "Shield broken", () => ev({ t: "hit", target: OTHER, by: ME, amount: 15, crit: false, source: "rifle", ...pos(), armor: true }));
button(match, "Kill (far fight)", () => ev({ t: "kill", victim: 5, killer: 6, source: "rifle", ...pos() }));
button(match, "Kill confirm (yours)", () => ev({ t: "kill", victim: OTHER, killer: ME, source: "rifle", ...pos() }));
button(match, "Eliminated (you)", () => ev({ t: "kill", victim: ME, killer: OTHER, source: "rifle", x: 0, y: 0 }));
button(match, "#1 Victory", () => ev({ t: "win", winner: ME }));
button(match, "Placement #3", () => placementSting(3));
button(match, "Placement #7", () => placementSting(7));

const music = section("Music (intensity slider in the bar above)");
slider("Music intensity", 0, 1, 0.05, S.intensity, (v) => {
  S.intensity = v;
  audio.music?.setIntensity(v);
});
button(music, "Start match music", () => {
  audio.startMusic(0.34, "game");
  audio.music?.setIntensity(S.intensity);
});
button(music, "Menu music", () => audio.startMusic(0.18, "menu"));
const duel = button(music, "Final duel layer (toggle)", () => {
  S.duel = !S.duel;
  duel.classList.toggle("on", S.duel);
  audio.music?.setDuel(S.duel);
});
button(music, "Stop music", () => audio.music?.stop());

const stress = section("Stress test");
button(stress, "12 fighters spraying for 3 s", () => {
  const guns: WeaponId[] = ["smg", "rifle", "pistol", "shotgun", "sniper", "smg"];
  for (let f = 0; f < 12; f++) {
    const w = guns[f % guns.length] ?? "smg";
    const a = Math.random() * Math.PI * 2;
    const d = 150 + Math.random() * 2800;
    const shots = Math.floor(3 / WEAPONS[w].fireCd);
    for (let i = 0; i < shots; i++) {
      later(i * WEAPONS[w].fireCd * 1000 + Math.random() * 40, () => ev({ t: "shoot", by: 10 + f, x: Math.cos(a) * d, y: Math.sin(a) * d, angle: 0, weapon: w }));
    }
  }
});

const all = section("Every recipe (raw)");
for (const name of Object.keys(RECIPES).sort()) button(all, name, () => audio.sfx(name, pos().x, pos().y, { positional: !S.own }));
