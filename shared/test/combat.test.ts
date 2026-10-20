// Weapons, items and match systems on the real World: firing, reload and rarity, every
// weapon's special behavior, healing and armor, loot pickup/swap/death piles, crates,
// barrel chains, throwables, supply drops and the zone.
import { describe, expect, test } from "vitest";
import {
  actFrame, addSolid, BTN, ITEMS, LOOT, magSize, MATCH, newWeapon, PLAYER, RARITY, SUPPLY, weaponDamage, WEAPONS, World, ZONE,
  type GameEvent, type InputFrame, type Player, type WeaponId,
} from "@prism/shared";
import { createLoot, dropFromCrate } from "../src/sim/loot";

const DT = 1 / 30;
let seq = 0;
const ticks = (s: number) => Math.ceil(s * 30);

interface Move {
  mx?: number;
  my?: number;
  buttons?: number;
  pressed?: number;
  aim?: number;
}

function setup(enemyAt: [number, number][] = []) {
  const w = new World("testYard", 3, { loot: false });
  const me = w.addPlayer(1, "ME", 0, false);
  const enemies = enemyAt.map(([x, y], i) => {
    const e = w.addPlayer(2 + i, `E${i}`, 1 + i, false);
    e.x = x;
    e.y = y;
    return e;
  });
  const events: GameEvent[] = [];
  const run = (n: number, moves?: (i: number, p: Player) => Move | undefined) => {
    for (let i = 0; i < n; i++) {
      const m = new Map<number, InputFrame[]>();
      for (const p of w.players.values()) {
        const mv = moves?.(i, p) ?? {};
        m.set(p.id, [{ seq: ++seq, mx: mv.mx ?? 0, my: mv.my ?? 0, aim: mv.aim ?? p.aim, buttons: mv.buttons ?? 0, pressed: mv.pressed ?? 0, dt: DT, shotId: 0 }]);
      }
      w.step(m);
      events.push(...w.events);
    }
  };
  const mine = (mv: Move) => (_i: number, p: Player) => (p.id === me.id ? mv : undefined);
  const give = (id: WeaponId, rarity = 0) => {
    me.inv.weapons[1] = newWeapon(id, rarity);
    me.inv.active = 1;
  };
  return { w, me, enemies, events, run, mine, give };
}

describe("guns", () => {
  test("pistol: fires at its rate, empties the magazine, auto-reloads with infinite reserve", () => {
    const s = setup();
    s.run(ticks(4.5), s.mine({ buttons: BTN.shoot }));
    const shots = s.events.filter((e) => e.t === "shoot").length;
    // 12-round magazine at 0.24s, then a 1.1s reload, then more.
    expect(shots).toBeGreaterThanOrEqual(15);
    expect(shots).toBeLessThanOrEqual(17);
    expect(s.events.some((e) => e.t === "reload")).toBe(true);
    expect(s.me.inv.weapons[0]!.reserve).toBe(0);
  });

  test("rarity scales damage and magazine size", () => {
    const common = newWeapon("rifle", 0);
    const legendary = newWeapon("rifle", 3);
    expect(magSize(legendary)).toBe(Math.round(WEAPONS.rifle.mag * RARITY[3].mag));
    expect(weaponDamage(legendary)).toBeCloseTo(weaponDamage(common) * RARITY[3].damage);
    expect(legendary.reserve).toBeGreaterThan(common.reserve);
  });

  test("manual reload refills from reserve; swapping cancels it", () => {
    const s = setup();
    s.give("smg");
    const g = s.me.inv.weapons[1]!;
    g.mag = 3;
    const res = g.reserve;
    s.run(1, s.mine({ pressed: BTN.reload }));
    expect(s.me.reloadT).toBeGreaterThan(0);
    s.run(ticks(WEAPONS.smg.reload) + 1);
    expect(g.mag).toBe(magSize(g));
    expect(g.reserve).toBe(res - (magSize(g) - 3));
    g.mag = 1;
    s.run(1, s.mine({ pressed: BTN.reload }));
    s.run(1, s.mine({ pressed: BTN.slot1 }));
    expect(s.me.inv.active).toBe(0);
    expect(s.me.reloadT).toBe(0);
  });

  test("SMG spread blooms while firing and recovers after", () => {
    const s = setup();
    s.give("smg");
    s.run(10, s.mine({ buttons: BTN.shoot }));
    expect(s.me.bloom).toBeGreaterThan(5);
    s.run(ticks(1));
    expect(s.me.bloom).toBe(0);
  });

  test("shotgun: 8 pellets, brutal up close, weak far away", () => {
    const near = setup([[120, 0]]);
    near.give("shotgun");
    near.me.aim = 0;
    near.run(1, near.mine({ buttons: BTN.shoot, aim: 0 }));
    expect(near.w.projectiles.filter((p) => p.owner === 1).length).toBe(WEAPONS.shotgun.pellets);
    near.run(3);
    const close = PLAYER.maxHp - near.enemies[0]!.hp;
    const far = setup([[380, 0]]);
    far.give("shotgun");
    far.run(1, far.mine({ buttons: BTN.shoot, aim: 0 }));
    far.run(12);
    const lost = PLAYER.maxHp - far.enemies[0]!.hp;
    expect(close).toBeGreaterThan(55);
    expect(lost).toBeLessThan(close * 0.6);
  });

  test("sniper pierces one target", () => {
    const s = setup([[300, 0], [500, 0], [700, 0]]);
    s.give("sniper");
    s.run(1, s.mine({ buttons: BTN.shoot, aim: 0 }));
    s.run(10);
    const [a, b, c] = s.enemies as [Player, Player, Player];
    expect(a.hp).toBeLessThan(PLAYER.maxHp);
    expect(b.hp).toBeLessThan(PLAYER.maxHp);
    expect(c.hp).toBe(PLAYER.maxHp);
  });

  test("rocket: splash damage, knockback, and it breaks crates", () => {
    const s = setup([[500, 60]]);
    const crate = addSolid(s.w.map, "crate", 480, -30, 534, 24);
    s.give("rocket");
    s.run(1, s.mine({ buttons: BTN.shoot, aim: 0 }));
    s.run(ticks(1));
    expect(crate.dead).toBe(true);
    expect(s.enemies[0]!.hp).toBeLessThan(PLAYER.maxHp);
    expect(s.events.some((e) => e.t === "explode" && e.source === "rocket")).toBe(true);
    // The crate dropped loot.
    expect(s.w.loot.size).toBeGreaterThan(0);
  });

  test("prism lance: hold to charge, release fires a beam that bounces off a wall", () => {
    const s = setup([[200, 300]]);
    addSolid(s.w.map, "wall", 400, -200, 430, 200);
    s.give("lance");
    s.me.aim = Math.atan2(150, 400);
    s.run(ticks(1), s.mine({ buttons: BTN.shoot, aim: s.me.aim }));
    expect(s.me.charge).toBe(1);
    s.run(1, s.mine({ aim: s.me.aim }));
    const beams = s.events.filter((e) => e.t === "shoot" && e.weapon === "lance");
    expect(beams.length).toBe(1);
    expect(s.events.some((e) => e.t === "bounce")).toBe(true);
    expect(s.w.effects.size).toBeGreaterThanOrEqual(2);
  });

  test("energy blade: arc hit with a lunge, and it deflects bullets during the swing", () => {
    const s = setup([[90, 0], [-400, 0]]);
    s.give("blade");
    const [front, shooter] = s.enemies as [Player, Player];
    s.run(1, s.mine({ buttons: BTN.shoot, aim: 0 }));
    expect(front.hp).toBeLessThan(PLAYER.maxHp);
    expect(s.me.px).toBeGreaterThan(0);
    s.me.aim = Math.PI;
    s.me.swingT = 0.3;
    const pr = s.w.spawnProjectile({ owner: shooter.id, x: s.me.x - 70, y: s.me.y, vx: 900, vy: 0, damage: 10, life: 1 });
    s.w.stepProjectile(pr, DT);
    expect(pr.owner).toBe(s.me.id);
    expect(pr.vx).toBeLessThan(0);
    expect(s.w.events.some((e) => e.t === "deflect")).toBe(true);
  });
});

describe("healing and armor", () => {
  test("hold to heal; shooting interrupts; movement is slowed while healing", () => {
    const s = setup();
    s.me.hp = PLAYER.maxHp - ITEMS.medkit.heal;
    s.me.inv.bandages = 2;
    s.me.inv.medkits = 1;
    s.run(1, s.mine({ buttons: BTN.heal }));
    expect(s.me.healKind).toBe("medkit");
    s.run(1, s.mine({ buttons: BTN.heal | BTN.shoot }));
    expect(s.me.healKind).toBeNull();
    s.run(ticks(ITEMS.medkit.time) + 2, s.mine({ buttons: BTN.heal }));
    expect(s.me.hp).toBe(PLAYER.maxHp);
    expect(s.me.inv.medkits).toBe(0);
    // Slowed while healing.
    s.me.hp = PLAYER.maxHp * 0.7;
    const x0 = s.me.x;
    s.run(15, s.mine({ buttons: BTN.heal, mx: 1 }));
    expect(s.me.x - x0).toBeLessThan(PLAYER.speed * 0.5 * 0.6);
  });

  test("shield armor soaks damage first, the zone ignores it", () => {
    const s = setup([[200, 0]]);
    s.me.armor = 30;
    s.w.damage(s.me, 20, 2, "pistol");
    expect([s.me.armor, s.me.hp]).toEqual([10, PLAYER.maxHp]);
    s.w.damage(s.me, 20, 2, "pistol");
    expect([s.me.armor, s.me.hp]).toEqual([0, PLAYER.maxHp - 10]);
    s.me.armor = 50;
    s.w.damage(s.me, 5, 0, "zone", { pierce: true });
    expect([s.me.armor, s.me.hp]).toEqual([50, PLAYER.maxHp - 15]);
  });
});

describe("loot", () => {
  test("walk-over pickups: ammo, heals, shield, throwables, empty-slot weapon", () => {
    const s = setup();
    s.me.inv.weapons[1] = newWeapon("rifle", 0);
    const reserve = s.me.inv.weapons[1].reserve;
    for (const kind of ["ammo", "bandage", "medkit", "shield"] as const) createLoot(s.w, { kind, x: 10, y: 0, count: 2 });
    createLoot(s.w, { kind: "throwable", x: 10, y: 0, throwable: "frag", count: 2 });
    s.run(1);
    expect(s.me.inv.weapons[1]!.reserve).toBeGreaterThan(reserve);
    expect(s.me.inv.bandages).toBe(2);
    // Piles hand over their whole count (two medkits, two shield cells up to the armor cap).
    expect(s.me.inv.medkits).toBe(2);
    expect(s.me.armor).toBe(Math.min(ITEMS.shield.max, ITEMS.shield.amount * 2));
    expect([s.me.inv.throwable, s.me.inv.throws]).toEqual(["frag", 2]);
    expect(s.w.loot.size).toBe(0);
  });

  test("drops of the same item in one spot stack into a single pile with a count", () => {
    const s = setup();
    s.me.x = -600;
    const a = createLoot(s.w, { kind: "ammo", x: 200, y: 0 });
    const b = createLoot(s.w, { kind: "ammo", x: 200 + LOOT.stackRadius * 0.6, y: 0 });
    expect(b).toBe(a);
    expect(a.count).toBe(2);
    // Different kinds, other grenade types and far-away drops stay separate; weapons never stack.
    createLoot(s.w, { kind: "medkit", x: 200, y: 0 });
    createLoot(s.w, { kind: "throwable", x: 200, y: 0, throwable: "frag" });
    createLoot(s.w, { kind: "throwable", x: 200, y: 0, throwable: "smoke" });
    createLoot(s.w, { kind: "throwable", x: 210, y: 0, throwable: "frag", count: 2 });
    createLoot(s.w, { kind: "ammo", x: 200 + LOOT.stackRadius * 2, y: 0 });
    createLoot(s.w, { kind: "weapon", x: 200, y: 0, weapon: "smg" });
    createLoot(s.w, { kind: "weapon", x: 200, y: 0, weapon: "smg" });
    expect(s.w.loot.size).toBe(7);
    expect([...s.w.loot.values()].find((l) => l.kind === "throwable" && l.throwable === "frag")?.count).toBe(3);
    // A stacked ammo pile is worth its count in ammo boxes.
    s.me.inv.weapons[1] = newWeapon("rifle", 0);
    const reserve = s.me.inv.weapons[1].reserve;
    s.me.x = 200;
    s.run(1);
    expect(s.me.inv.weapons[1]!.reserve - reserve).toBe(Math.round(magSize(s.me.inv.weapons[1]!) * ITEMS.ammoMags * 2));
  });

  test("a medkit pile bigger than your pouch keeps the rest on the floor", () => {
    const s = setup();
    s.me.inv.medkits = ITEMS.medkit.max - 1;
    const l = createLoot(s.w, { kind: "medkit", x: 10, y: 0, count: 3 });
    s.run(1);
    expect(s.me.inv.medkits).toBe(ITEMS.medkit.max);
    expect(l.dead).toBe(false);
    expect(l.count).toBe(2);
  });

  test("crates drop one or two items", () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const w = new World("testYard", seed, { loot: false });
      dropFromCrate(w, 0, 0);
      counts.add(w.loot.size);
    }
    expect([...counts].sort()).toEqual([LOOT.crateRolls, LOOT.crateRolls + 1]);
  });

  test("F swaps the gun in hand when both slots are full, dropping the old one", () => {
    const s = setup();
    s.me.inv.weapons[1] = newWeapon("smg", 0);
    s.me.inv.active = 1;
    const l = createLoot(s.w, { kind: "weapon", x: 60, y: 0, weapon: "shotgun", rarity: 2, mag: 4, reserve: 9 });
    s.run(1);
    expect(s.w.loot.has(l.id)).toBe(true);
    s.run(1, s.mine({ pressed: BTN.interact }));
    expect(s.me.inv.weapons[1]).toMatchObject({ id: "shotgun", rarity: 2, mag: 4, reserve: 9 });
    const dropped = [...s.w.loot.values()].find((x) => x.kind === "weapon");
    expect(dropped?.weapon).toBe("smg");
  });

  test("death drops the whole loadout as a pile", () => {
    const s = setup([[100, 0]]);
    s.me.inv.weapons[1] = newWeapon("sniper", 3);
    s.me.inv.bandages = 4;
    s.me.inv.throwable = "smoke";
    s.me.inv.throws = 1;
    s.me.inv.medkits = 2;
    s.w.damage(s.me, 999, 2, "pistol");
    const kinds = [...s.w.loot.values()].map((l) => l.kind).sort();
    // Two medkits are one pile of two, not two items.
    expect(kinds).toEqual(["ammo", "bandage", "medkit", "throwable", "weapon"]);
    expect([...s.w.loot.values()].find((l) => l.kind === "medkit")?.count).toBe(2);
    expect([...s.w.loot.values()].find((l) => l.kind === "weapon")?.weapon).toBe("sniper");
  });

  test("initial floor loot spawns on the real maps", () => {
    const w = new World("neonCity", 5);
    expect(w.loot.size).toBeGreaterThan(80);
    const kinds = new Set([...w.loot.values()].map((l) => l.kind));
    expect(kinds.has("weapon") && kinds.has("ammo")).toBe(true);
  });

  test("with the leaner loot, every spawn still has a real gun within a few seconds' walk", () => {
    // 2600 units straight-line is about 8 s of walking: well inside the first 15-20 s.
    for (const map of ["neonCity", "crystalWilds"] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const w = new World(map, seed);
        for (let i = 1; i <= MATCH.fighters; i++) w.addPlayer(i, `P${i}`, i - 1, true);
        w.placeSpawns();
        const guns = [...w.loot.values()].filter((l) => l.kind === "weapon" && l.weapon !== "pistol");
        for (const p of w.players.values()) {
          const nearest = Math.min(...guns.map((g) => Math.hypot(g.x - p.x, g.y - p.y)));
          expect(nearest, `${map} seed ${seed} player ${p.id}`).toBeLessThan(2600);
        }
      }
    }
  });
});

describe("destructibles and throwables", () => {
  test("barrels explode when broken and chain into nearby barrels", () => {
    const s = setup([[0, 400]]);
    const a = addSolid(s.w.map, "barrel", 300, -22, 344, 22);
    const b = addSolid(s.w.map, "barrel", 420, -22, 464, 22);
    s.w.damageSolid(a, 999, 1, false);
    s.run(ticks(0.5));
    expect(a.dead && b.dead).toBe(true);
    expect(s.events.filter((e) => e.t === "explode" && e.source === "barrel").length).toBe(2);
  });

  test("fences only break to explosions; glass breaks to bullets", () => {
    const s = setup();
    const fence = addSolid(s.w.map, "fence", 200, -60, 214, 60);
    const glass = addSolid(s.w.map, "glass", -214, -60, -200, 60);
    s.w.damageSolid(fence, 500, 1, false);
    expect(fence.dead).toBe(false);
    s.w.damageSolid(fence, 500, 1, true);
    expect(fence.dead).toBe(true);
    s.run(ticks(1.2), s.mine({ buttons: BTN.shoot, aim: Math.PI }));
    expect(glass.dead).toBe(true);
  });

  test("frag, smoke and shock mine", () => {
    const s = setup([[260, 0]]);
    s.me.inv.throwable = "frag";
    s.me.inv.throws = 3;
    s.run(1, s.mine({ pressed: BTN.throw, aim: 0 }));
    s.run(ticks(ITEMS.throwables.frag.fuse) + 2);
    expect(s.events.some((e) => e.t === "explode" && e.source === "frag")).toBe(true);
    expect(s.enemies[0]!.hp).toBeLessThan(PLAYER.maxHp);
    s.me.inv.throwable = "smoke";
    s.me.inv.throws = 1;
    s.run(1, s.mine({ pressed: BTN.throw, aim: -Math.PI / 2 }));
    s.run(ticks(ITEMS.throwables.smoke.fuse) + 30);
    expect([...s.w.effects.values()].some((e) => e.kind === "smoke")).toBe(true);
    expect(s.me.inv.throwable).toBeNull();
    s.me.inv.throwable = "mine";
    s.me.inv.throws = 1;
    s.me.throwCd = 0;
    s.enemies[0]!.x = 600;
    s.run(1, s.mine({ pressed: BTN.throw, aim: Math.PI }));
    s.run(ticks(2));
    const mine = [...s.w.effects.values()].find((e) => e.kind === "mine");
    expect(mine).toBeDefined();
    const hp = s.enemies[0]!.hp;
    s.enemies[0]!.x = mine!.x;
    s.enemies[0]!.y = mine!.y + 20;
    s.run(2);
    expect(s.enemies[0]!.hp).toBeLessThan(hp);
    expect(s.enemies[0]!.status.shocked ?? 0).toBeGreaterThan(0);
  });
});

describe("match systems", () => {
  test("supply drops are announced, fall, and land with epic or better gear and a shard", () => {
    const s = setup();
    s.w.time = (SUPPLY.times[0] ?? 0) - DT;
    s.run(2);
    expect(s.events.some((e) => e.t === "supply" && !e.landed)).toBe(true);
    const drop = [...s.w.effects.values()].find((e) => e.kind === "supplyDrop");
    expect(drop).toBeDefined();
    s.run(ticks(SUPPLY.fallTime) + 2);
    expect(s.events.some((e) => e.t === "supply" && e.landed)).toBe(true);
    const guns = [...s.w.loot.values()].filter((l) => l.kind === "weapon");
    expect(guns.length).toBe(SUPPLY.weapons);
    expect(guns.every((g) => g.rarity >= 2)).toBe(true);
    expect([...s.w.loot.values()].some((l) => l.kind === "shard")).toBe(true);
  });

  test("shard pickup emits a shard event for the room's in-match draft", () => {
    const s = setup();
    createLoot(s.w, { kind: "shard", x: 0, y: 0 });
    s.run(1);
    expect(s.events.some((e) => e.t === "shard" && e.by === 1)).toBe(true);
  });

  test("the zone runs six stages, moves its center, stays on the map and shrinks to the final circle", () => {
    const w = new World("neonCity", 77, { loot: false });
    const centers: string[] = [];
    let total = 0;
    while (w.zone.phase !== "done" && total < 30 * 600) {
      w.step(new Map());
      total++;
      if (w.zone.phase === "warn" && !centers.includes(`${w.zone.toX},${w.zone.toY}`)) centers.push(`${w.zone.toX},${w.zone.toY}`);
      expect(Math.abs(w.zone.toX)).toBeLessThanOrEqual(w.map.half);
      expect(Math.abs(w.zone.toY)).toBeLessThanOrEqual(w.map.half);
    }
    expect(centers.length).toBe(ZONE.stages.length);
    expect(w.zone.r).toBeCloseTo(ZONE.stages[ZONE.stages.length - 1]!.radius, 0);
    const minutes = total / 30 / 60;
    expect(minutes).toBeGreaterThan(2.5);
    expect(minutes).toBeLessThan(4);
  });

  test("actFrame is pure: replaying the same frames gives the same state (client prediction)", () => {
    const a = setup();
    const b = setup();
    for (const s of [a, b]) {
      s.give("smg");
      s.me.inv.bandages = 3;
      s.me.hp = 60;
    }
    const frames: InputFrame[] = [];
    for (let i = 0; i < 90; i++) frames.push({ seq: i + 1, mx: 0, my: 0, aim: 0.3, buttons: i < 40 ? BTN.shoot : BTN.heal, pressed: i === 50 ? BTN.reload : 0, dt: DT, shotId: i + 1 });
    const outA = frames.map((f) => actFrame(a.me, f, DT).shots);
    const outB = frames.map((f) => actFrame(b.me, f, DT).shots);
    expect(outA).toEqual(outB);
    expect(a.me.inv).toEqual(b.me.inv);
    expect([a.me.hp, a.me.reloadT, a.me.bloom]).toEqual([b.me.hp, b.me.reloadT, b.me.bloom]);
  });
});
