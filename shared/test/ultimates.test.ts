// Ultimates on the real World: each one casts from a full meter, and does what it promises
// (meteor impacts, cooldown reset, rift pull + slam, echo doubling, absorb-and-release, homing).
import { describe, expect, test } from "vitest";
import {
  addBush,
  allUlts, BTN, PF, ULT_IDS, ULTIMATES, World, pointSegment,
  type GameEvent, type InputFrame, type Player, type PowerId, type UltId,
} from "@prism/shared";
import { finalStandDamage } from "../src/ultimates/final-stand";
import { meteorSpawnAt } from "../src/ultimates/meteor-rain";

const DT = 1 / 30;
let seq = 0;

function frame(p: Player, buttons = 0, pressed = 0, aim = p.aim): InputFrame {
  return { seq: ++seq, mx: 0, my: 0, aim, buttons, pressed, dt: DT, shotId: 0 };
}

interface Setup {
  w: World;
  caster: Player;
  enemies: Player[];
  events: GameEvent[];
  /** Steps n ticks; `inputs` gives the caster's frame for each tick (default idle). */
  run(n: number, input?: (i: number) => InputFrame): void;
}

function setup(ult: UltId, enemyAt: [number, number][], powers: PowerId[] = []): Setup {
  const w = new World("testYard", 7, { loot: false });
  const caster = w.addPlayer(1, "CASTER", 0, false);
  caster.x = 0;
  caster.y = 0;
  caster.aim = 0;
  caster.ult = { id: ult, charge: 100 };
  caster.slots = [powers[0] ? { id: powers[0], cd: 0, recast: 0 } : null, powers[1] ? { id: powers[1], cd: 0, recast: 0 } : null, null];
  const enemies = enemyAt.map(([x, y], i) => {
    const e = w.addPlayer(2 + i, `E${i}`, 1 + i, true);
    e.x = x;
    e.y = y;
    return e;
  });
  const events: GameEvent[] = [];
  const s: Setup = {
    w, caster, enemies, events,
    run(n, input) {
      for (let i = 0; i < n; i++) {
        const m = new Map<number, InputFrame[]>();
        m.set(caster.id, [input ? input(i) : frame(caster)]);
        for (const e of enemies) m.set(e.id, [frame(e)]);
        w.step(m);
        events.push(...w.events);
      }
    },
  };
  return s;
}

const castUlt = (s: Setup) => s.run(1, () => frame(s.caster, BTN.ult, BTN.ult));
const ticks = (seconds: number) => Math.ceil(seconds * 30);

describe("ultimates", () => {
  test("all six are registered with icons and bot hints", () => {
    const ids = allUlts().map((u) => u.id).sort();
    expect(ids).toEqual([...ULT_IDS].sort());
    for (const u of allUlts()) {
      expect(typeof u.drawIcon).toBe("function");
      expect(u.bot.minTargets).toBeGreaterThanOrEqual(1);
    }
  });

  test("casting spends the full meter and emits a cast event", () => {
    const s = setup("overdrive", [[600, 0]]);
    castUlt(s);
    expect(s.caster.ult?.charge).toBe(0);
    expect(s.events.some((e) => e.t === "cast" && e.power === "overdrive" && e.by === 1)).toBe(true);
  });

  test("meteor rain: 12 warned impacts inside the marked area, credited to the caster", () => {
    const s = setup("meteorRain", [[-600, -400]]);
    const target = s.enemies[0] as Player;
    castUlt(s);
    const area = [...s.w.effects.values()].find((e) => e.kind === "meteorWarn" && e.n === 0);
    expect(area).toBeDefined();
    if (!area) return;
    expect(Math.hypot(area.x - ULTIMATES.meteorRain.centerDist, area.y)).toBeLessThan(1);
    // Park the enemy on the first warning circle: it must take exactly one meteor.
    s.run(1);
    const first = [...s.w.effects.values()].find((e) => e.kind === "meteorWarn" && e.n === 1);
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.life).toBeCloseTo(ULTIMATES.meteorRain.warn);
    s.w.teleport(target, first.x, first.y);
    s.run(ticks(meteorSpawnAt(1) + ULTIMATES.meteorRain.warn) - 1);
    expect(target.hp).toBeLessThan(100);
    expect(target.lastHitBy).toBe(1);
    expect(target.lastHitSource).toBe("meteorRain");
    s.run(ticks(ULTIMATES.meteorRain.duration) + 5);
    const booms = s.events.filter((e): e is Extract<GameEvent, { t: "explode" }> => e.t === "explode" && e.source === "meteorRain");
    expect(booms).toHaveLength(ULTIMATES.meteorRain.count);
    const reach = ULTIMATES.meteorRain.radius * 1.2;
    for (const b of booms) expect(Math.hypot(b.x - area.x, b.y - area.y)).toBeLessThan(reach);
    expect(s.caster.hp).toBe(100);
  });

  test("overdrive: cooldowns reset, faster fire with no ammo spent", () => {
    const s = setup("overdrive", [[700, 400]], ["singularity", "portalPair"]);
    for (const sl of s.caster.slots) if (sl) sl.cd = 12;
    s.caster.aim = Math.PI;
    castUlt(s);
    expect(s.caster.slots[0]?.cd).toBe(0);
    expect(s.caster.slots[1]?.cd).toBe(0);
    expect(s.w.hasStatus(s.caster, "overdrive")).toBe(true);
    expect([...s.w.effects.values()].some((e) => e.kind === "overdriveAura" && e.owner === 1)).toBe(true);
    s.run(60, () => frame(s.caster, BTN.shoot, 0));
    // The pistol fires every 0.24s (~8 in 2s, plus a reload); overdrive doubles the rate and spends no ammo.
    const shots = s.events.filter((e) => e.t === "shoot" && e.by === 1).length;
    expect(shots).toBeGreaterThanOrEqual(15);
    expect(s.caster.inv.weapons[0]?.mag).toBe(12);
  });

  test("rift collapse: pulls enemies toward the line, then slams anyone near it", () => {
    const s = setup("riftCollapse", [[0, 420], [250, 90]]);
    const [far, near] = s.enemies as [Player, Player];
    castUlt(s);
    const rift = [...s.w.effects.values()].find((e) => e.kind === "rift");
    expect(rift).toBeDefined();
    if (!rift) return;
    // The segment runs through the caster along the aim and stays inside the walls.
    expect(pointSegment(0, 0, rift.x, rift.y, rift.x2, rift.y2).d).toBeLessThan(1);
    expect(s.w.insideArena(rift.x, rift.y)).toBe(true);
    expect(s.w.insideArena(rift.x2, rift.y2)).toBe(true);
    s.run(ticks(1.5));
    expect(far.y).toBeLessThan(420 - 60);
    expect(far.hp).toBe(100);
    s.run(ticks(ULTIMATES.riftCollapse.pullTime - 1.5) + 2);
    expect(near.hp).toBeCloseTo(100 - ULTIMATES.riftCollapse.closeDamage);
    expect(near.lastHitSource).toBe("riftCollapse");
    expect(s.caster.hp).toBe(100);
    expect(Math.hypot(s.caster.x, s.caster.y)).toBeLessThan(1);
    expect(s.events.filter((e) => e.t === "explode" && e.source === "riftCollapse").length).toBeGreaterThanOrEqual(2);
  });

  test("echo storm: every power cast happens twice, echoes never echo", () => {
    const s = setup("echoStorm", [[700, 400]], ["singularity", "portalPair"]);
    castUlt(s);
    expect(s.w.hasStatus(s.caster, "echo")).toBe(true);
    s.run(1, () => frame(s.caster, BTN.p1, BTN.p1));
    s.run(ticks(1.5));
    const casts = () => s.events.filter((e) => e.t === "cast" && e.power === "singularity").length;
    expect(casts()).toBe(2);
    expect([...s.w.effects.values()].filter((e) => e.kind === "singularity").length).toBe(2);
    s.run(ticks(3));
    expect(casts()).toBe(2);
    expect(s.caster.slots[0]?.cd).toBeGreaterThan(0);
  });

  test("echo storm: recast powers echo both halves (two linked portal pairs)", () => {
    const s = setup("echoStorm", [[700, 400]], ["portalPair"]);
    castUlt(s);
    s.run(1, () => frame(s.caster, BTN.p1, BTN.p1));
    s.run(ticks(0.6));
    s.caster.x = 300;
    s.run(1, () => frame(s.caster, BTN.p1, BTN.p1));
    s.run(ticks(0.6));
    const portals = [...s.w.effects.values()].filter((e) => e.kind === "portal" && e.owner === 1);
    expect(portals).toHaveLength(4);
    for (const p of portals) expect(p.link).not.toBe(0);
  });

  test("final stand: absorbs all damage, can't shoot, then releases a scaled shockwave", () => {
    const s = setup("finalStand", [[200, 0], [1000, 400]]);
    const [close, away] = s.enemies as [Player, Player];
    castUlt(s);
    expect(s.w.damage(s.caster, 30, close.id, "pistol")).toBe(0);
    expect(s.w.damage(s.caster, 20, away.id, "pistol")).toBe(0);
    expect(s.caster.hp).toBe(100);
    expect(s.caster.absorbed).toBe(50);
    s.run(ticks(1), () => frame(s.caster, BTN.shoot, BTN.shoot));
    expect(s.events.some((e) => e.t === "shoot" && e.by === 1)).toBe(false);
    const fs = [...s.w.effects.values()].find((e) => e.kind === "finalStand");
    expect(fs?.v).toBe(50);
    s.run(ticks(ULTIMATES.finalStand.charge) + 2);
    const expected = finalStandDamage(50);
    expect(expected).toBeCloseTo(ULTIMATES.finalStand.baseDamage + ULTIMATES.finalStand.absorbMult * 50);
    expect(close.hp).toBeCloseTo(100 - expected);
    expect(close.x).toBeGreaterThan(200);
    expect(away.hp).toBe(100);
    expect(s.w.hasStatus(s.caster, "finalStand")).toBe(false);
    expect(s.caster.absorbed).toBe(0);
    // Vulnerable again afterwards.
    expect(s.w.damage(s.caster, 10, close.id, "pistol")).toBe(10);
    expect(finalStandDamage(10_000)).toBe(ULTIMATES.finalStand.maxDamage);
  });

  test("hunter's eye: reveals hidden enemies, marks each, and shots home in", () => {
    const s = setup("huntersEye", [[350, 180], [-700, -300]]);
    const [target] = s.enemies as [Player];
    addBush(s.w.map, -700, -300, 200);
    const hidden = s.enemies[1] as Player;
    expect(s.w.hiddenFrom(s.caster, hidden)).toBe(true);
    castUlt(s);
    expect(s.w.hiddenFrom(s.caster, hidden)).toBe(false);
    const marks = [...s.w.effects.values()].filter((e) => e.kind === "hunterMark" && e.owner === 1);
    expect(marks.map((m) => m.link).sort()).toEqual([2, 3]);
    s.run(1, () => frame(s.caster, BTN.shoot, BTN.shoot, 0));
    const shot = s.w.projectiles.find((p) => p.owner === 1);
    expect(shot).toBeDefined();
    if (!shot) return;
    expect(shot.flags & PF.homing).toBe(PF.homing);
    s.run(4);
    expect(shot.dead || shot.vy > 0).toBe(true);
    s.run(ticks(0.6));
    expect(target.hp).toBeLessThan(100);
  });
});
