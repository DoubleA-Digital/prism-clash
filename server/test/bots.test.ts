// Bot brain pieces: honest perception (sight box, walls, bushes, hearing, being hit), utility
// state choices, zone rotation pressure, fight judgement and cover, throwables, drafting,
// personalities, power tactics with the new API, and small end-to-end scenes on the test yard.
import { describe, expect, test } from "vitest";
import {
  addBush, addSolid, BOTS, createLoot, newWeapon, Rng, World, ZONE,
  type InputFrame, type Player, type PowerId,
} from "@prism/shared";
import { createBrain } from "../src/bots/brain";
import { findCover, winChance } from "../src/bots/combat";
import { pickPowerIndex, pickUltIndex } from "../src/bots/draft";
import { Nav } from "../src/bots/nav";
import { Perception, type Contact } from "../src/bots/perception";
import { makeProfile, PERSONALITY_IDS } from "../src/bots/personality";
import { SmartBrain } from "../src/bots/smart";
import { chooseCast } from "../src/bots/tactics";
import { planThrow } from "../src/bots/throws";
import { chooseState, zoneInfo, type Situation } from "../src/bots/utility";

function yard() {
  const w = new World("testYard", 1, { loot: false });
  const me = w.addPlayer(1, "BOT", 0, true);
  const foe = w.addPlayer(2, "FOE", 1, false);
  me.x = -300;
  me.y = 0;
  foe.x = 300;
  foe.y = 0;
  return { w, me, foe };
}

/** Steps the world with the bot thinking and everyone else standing still. */
function run(w: World, brains: Map<number, SmartBrain>, seconds: number, each?: () => void) {
  for (let i = 0; i < seconds * 30; i++) {
    const inputs = new Map<number, InputFrame[]>();
    for (const [id, b] of brains) {
      const p = w.players.get(id);
      if (p?.alive) inputs.set(id, [b.think(w, p)]);
    }
    w.step(inputs);
    each?.();
  }
}

const profile = makeProfile("normal", new Rng(1), "looter");

function situation(o: Partial<Situation>): Situation {
  return {
    hp: 100, armor: 0, canHeal: false, quiet: 10, quietNeeded: 2, target: null, hitRecently: false, lootValue: 0, lootDist: Infinity,
    crateDist: Infinity, armed: 0.6, zoneOutside: false, zonePressure: 0, supplyDist: Infinity, noiseDist: Infinity, noiseAge: Infinity,
    ambushSpot: false, ambushReady: false, lateGame: false, early: false, current: "roam", ...o,
  };
}

function contact(o: Partial<Contact>): Contact {
  return {
    id: 2, x: 0, y: 0, vx: 0, vy: 0, visible: true, seenAt: 0, heardAt: -Infinity, noticeAt: 0, hp: 100, armor: 0, weapon: "pistol", rarity: 0, hitUsAt: -99, ...o,
  };
}

describe("perception is honest", () => {
  test("sees an enemy in the open, after a reaction delay", () => {
    const { w, me } = yard();
    const per = new Perception(0.3, 1, new Rng(2));
    per.look(w, me);
    const c = per.contacts.get(2)!;
    expect(c.visible).toBe(true);
    expect(c.noticeAt).toBeGreaterThan(w.time + 0.2);
  });

  test("walls and bushes hide enemies; so does being off-screen", () => {
    const { w, me, foe } = yard();
    const wall = addSolid(w.map, "wall", -12, -300, 12, 300);
    const per = new Perception(0.3, 1, new Rng(2));
    per.look(w, me);
    expect(per.contacts.get(2)?.visible ?? false).toBe(false);
    wall.dead = true;
    addBush(w.map, 300, 0, 80);
    per.look(w, me);
    expect(per.contacts.get(2)?.visible ?? false).toBe(false);
    // Out of the bush but straight below, past the screen's half height.
    foe.x = -300;
    foe.y = 900;
    per.look(w, me);
    expect(per.contacts.get(2)?.visible ?? false).toBe(false);
    foe.y = 500;
    per.look(w, me);
    expect(per.contacts.get(2)?.visible).toBe(true);
  });

  test("hears gunshots in range (fuzzy, not seen), ignores far ones, and feels hits", () => {
    const { w, me } = yard();
    addSolid(w.map, "wall", -12, -300, 12, 300);
    const per = new Perception(0.3, 1, new Rng(2));
    w.tick = 5;
    w.events = [{ t: "shoot", by: 2, x: 300, y: 0, angle: 0, weapon: "rifle" }];
    per.listen(w, me);
    const c = per.contacts.get(2)!;
    expect(c.visible).toBe(false);
    expect(c.heardAt).toBe(w.time);
    expect(Math.hypot(c.x - 300, c.y)).toBeLessThan(600 * BOTS.perception.soundFuzz * 1.5);
    const far = new Perception(0.3, 1, new Rng(2));
    w.tick = 6;
    w.events = [{ t: "shoot", by: 2, x: 300 + BOTS.perception.hearing.gun + 400, y: 0, angle: 0, weapon: "pistol" }];
    far.listen(w, me);
    expect(far.contacts.size).toBe(0);
    w.tick = 7;
    w.events = [{ t: "hit", target: 1, by: 2, amount: 15, crit: false, source: "rifle", x: me.x, y: me.y, armor: false }];
    far.listen(w, me);
    expect(far.contacts.get(2)?.hitUsAt).toBe(w.time);
    expect(far.damageWithin(w.time, 1)).toBe(15);
  });
});

describe("utility choices", () => {
  test("outside the zone beats everything else", () => {
    expect(chooseState(situation({ zoneOutside: true, lootValue: 5, lootDist: 50 }), profile)).toBe("rotate");
  });

  test("heals when hurt and it's quiet, loots good gear, fights winnable duels, flees losing ones", () => {
    expect(chooseState(situation({ hp: 30, canHeal: true }), profile)).toBe("heal");
    expect(chooseState(situation({ lootValue: 6, lootDist: 100 }), profile)).toBe("loot");
    const t = { visible: true, dist: 300, win: 0.8, sinceSeen: 0, engaged: true };
    expect(chooseState(situation({ target: t }), profile)).toBe("fight");
    expect(chooseState(situation({ hp: 25, hitRecently: true, target: { ...t, win: 0.08 } }), profile)).toBe("flee");
  });

  test("early on, a poorly armed bot keeps looting instead of starting a long-range duel", () => {
    const far = { visible: true, dist: 1100, win: 0.6, sinceSeen: 0, engaged: false };
    expect(chooseState(situation({ early: true, armed: 0, target: far, lootValue: 4, lootDist: 200 }), profile)).toBe("loot");
  });

  test("zone pressure grows when the next circle is far and time is short", () => {
    const { w } = yard();
    const z = w.zone;
    Object.assign(z, { stage: 1, phase: "shrink", x: 0, y: 0, r: 1300, toX: 900, toY: 0, toR: 300, remaining: 5 });
    const far = zoneInfo(w, -1200, 0, 1);
    expect(far.pressure).toBeGreaterThan(0.5);
    expect(far.goalX).toBeGreaterThan(500);
    expect(zoneInfo(w, 900, 0, 1).pressure).toBe(0);
    // Plenty of warning time left: no hurry yet, but a cautious bot (leaves early) feels it sooner.
    Object.assign(z, { phase: "warn", remaining: ZONE.stages[1]!.warn * 0.3 });
    const calm = zoneInfo(w, -1200, 0, 1);
    expect(calm.pressure).toBeLessThan(far.pressure);
    expect(zoneInfo(w, -1200, 0, 1.6).pressure).toBeGreaterThan(calm.pressure);
  });
});

describe("fight judgement, cover and throwables", () => {
  test("a shotgun wins up close and loses far away against a rifle", () => {
    const { me } = yard();
    me.x = 0;
    me.y = 0;
    const close = contact({ x: 120, weapon: "rifle" });
    const far = contact({ x: 900, weapon: "rifle" });
    expect(winChance(me, "shotgun", 0, close, 0, false)).toBeGreaterThan(0.5);
    expect(winChance(me, "shotgun", 0, far, 0, false)).toBeLessThan(0.3);
    expect(winChance(me, "rifle", 0, far, 2, false)).toBeLessThan(winChance(me, "rifle", 0, far, 0, false));
  });

  test("finds a spot behind a wall that blocks bullets from the threat", () => {
    const { w, me } = yard();
    me.x = 0;
    me.y = 0;
    addSolid(w.map, "wall", -150, 80, 150, 104);
    const nav = new Nav(w.map);
    const spot = findCover(w, nav.grid, me, 0, -500, () => true)!;
    expect(spot).not.toBeNull();
    expect(w.blocked(spot.x, spot.y, 0, -500)).toBe(true);
  });

  test("frags a target that ducked behind cover; smokes an escape; keeps it otherwise", () => {
    const { w, me } = yard();
    const grid = new Nav(w.map).grid;
    me.inv.throwable = "frag";
    me.inv.throws = 2;
    const hidden = contact({ x: me.x + 380, y: 0, visible: false, seenAt: w.time - 0.5 });
    const ctx = { w, me, grid, visible: [], target: hidden, now: w.time, fleeing: false, healing: false, holding: false, skill: 1, rand: () => 0 };
    expect(planThrow(ctx)).toBeCloseTo(0, 3);
    expect(planThrow({ ...ctx, target: contact({ x: me.x + 2000, visible: false, seenAt: w.time }) })).toBeNull();
    me.inv.throwable = "smoke";
    const chaser = contact({ x: me.x + 300 });
    expect(planThrow({ ...ctx, target: chaser, visible: [chaser] })).toBeNull();
    expect(planThrow({ ...ctx, target: chaser, visible: [chaser], fleeing: true })).not.toBeNull();
    me.inv.throwable = null;
    expect(planThrow({ ...ctx, fleeing: true })).toBeNull();
  });
});

describe("drafts and personalities", () => {
  test("power picks never duplicate, and favor an attack power when holding none", () => {
    const rng = new Rng(9);
    let attack = 0;
    for (let i = 0; i < 60; i++) {
      const opts: PowerId[] = ["chronoRewind", "singularity", "portalPair"];
      const k = pickPowerIndex(opts, [null, null], "looter", rng);
      if (opts[k] === "singularity") attack++;
      expect(pickPowerIndex(["voidCloak", "singularity"], ["singularity", null], "aggressive", rng)).toBe(0);
    }
    expect(attack).toBeGreaterThan(40);
    const u = pickUltIndex(["meteorRain", "overdrive", "finalStand"], "cautious", rng);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(3);
  });

  test("difficulty sets reaction and aim; a lobby of bots gets mixed personalities", () => {
    const easy = makeProfile("easy", new Rng(3));
    const hard = makeProfile("hard", new Rng(3));
    expect(hard.reaction).toBeLessThan(easy.reaction);
    expect(hard.aimErrorDeg).toBeLessThan(easy.aimErrorDeg);
    expect(hard.coverUse).toBeGreaterThan(easy.coverUse * 0.9);
    const kinds = new Set<string>();
    for (let i = 0; i < 11; i++) kinds.add(new SmartBrain("normal", 100 + i).profile.personality);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    expect(PERSONALITY_IDS.length).toBe(3);
  });

  test("power tactics only use enemies the bot can see", () => {
    const { w, me, foe } = yard();
    me.slots = [{ id: "singularity", cd: 0, recast: 0 }, { id: "shockwaveSlam", cd: 0, recast: 0 }];
    foe.x = me.x + 150;
    const base = { w, me, target: null, visible: [] as Player[], threats: 0, recentLoss: 0, inZoneDanger: false, eagerness: 1, rand: () => 0.1 };
    // Someone right next to us but unseen (say, behind a wall): no slam.
    expect(chooseCast(base, [0, 0])).toBeNull();
    const plan = chooseCast({ ...base, visible: [foe] }, [0, 0]);
    expect(plan?.slot).toBe(1);
    foe.x = me.x + 400;
    const aimed = chooseCast({ ...base, target: foe, visible: [foe] }, [0, 0]);
    expect(aimed?.slot).toBe(0);
  });
});

describe("bots in action", () => {
  test("shoots a visible enemy but not one hidden behind a wall", () => {
    const { w, me, foe } = yard();
    me.inv.weapons = [newWeapon("rifle", 0), null];
    const wall = addSolid(w.map, "wall", -12, -400, 12, 400);
    const brains = new Map([[1, new SmartBrain("hard", 7, "aggressive")]]);
    run(w, brains, 2);
    expect(w.stat(1).shots).toBe(0);
    expect(foe.hp).toBe(100);
    wall.dead = true;
    run(w, brains, 3);
    expect(w.stat(1).shots).toBeGreaterThan(0);
    expect(foe.hp + foe.armor).toBeLessThan(100);
  });

  test("paths through a doorway to loot a better gun on the other side of a wall", () => {
    const w = new World("testYard", 1, { loot: false });
    const me = w.addPlayer(1, "BOT", 0, true);
    me.x = -400;
    me.y = -300;
    const h = w.map.half;
    addSolid(w.map, "wall", -12, -h, 12, 400);
    addSolid(w.map, "wall", -12, 510, 12, h);
    createLoot(w, { kind: "weapon", x: 250, y: -300, weapon: "rifle", rarity: 2, mag: 30, reserve: 60 });
    const brains = new Map([[1, new SmartBrain("normal", 3, "looter")]]);
    let got = false;
    run(w, brains, 15, () => {
      got ||= me.inv.weapons.some((g) => g?.id === "rifle");
    });
    expect(got).toBe(true);
  });

  test("heals behind cover when hurt and nobody is around", () => {
    const w = new World("testYard", 1, { loot: false });
    const me = w.addPlayer(1, "BOT", 0, true);
    me.hp = 30;
    me.inv.bandages = 4;
    const brains = new Map([[1, new SmartBrain("normal", 5, "cautious")]]);
    run(w, brains, 6);
    expect(me.hp).toBeGreaterThan(30);
  });

  test("every difficulty builds a working brain that drafts", () => {
    for (const d of ["easy", "normal", "hard"] as const) {
      const b = createBrain(d, 42);
      expect(b.pickPower(["singularity", "voidCloak", "portalPair"], [null, null])).toBeGreaterThanOrEqual(0);
      expect(b.pickUlt(["meteorRain", "overdrive", "finalStand"])).toBeGreaterThanOrEqual(0);
    }
  });
});
