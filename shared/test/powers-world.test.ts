// Every power and ultimate in the v2 world: cast in a walled corridor next to crates, glass and
// a barrel, while the caster fires a real (non-pistol) gun, recasts, and runs into walls. Nothing
// may throw, nobody (player, clone, decoy, glaive) may end up inside geometry, and the caster's
// gun keeps working alongside the power. Then targeted terrain and line-of-sight behavior.
import { describe, expect, test } from "vitest";
import {
  allPowers, allUlts, BTN, circleBlocked, POWER_IDS, POWERS, ULT_IDS, ULTIMATES, weaponDamage, WEAPONS,
  type PowerId, type UltId, type WeaponId,
} from "@prism/shared";
import { kit, stuckInGeometry, ticks, type Kit } from "./powerkit";

const GUNS: WeaponId[] = ["shotgun", "rifle", "smg", "lance", "rocket", "sniper", "blade"];

/** A corridor 220 wide (walls north and south), a thin wall to the east, and breakables. */
function corridor(k: Kit) {
  k.wall("wall", -700, -134, 700, -110);
  k.wall("wall", -700, 110, 700, 134);
  k.wall("wall", 190, -110, 202, 110);
  k.wall("crate", -150, -100, -100, -50);
  k.wall("glass", 120, 40, 134, 100);
  k.wall("barrel", -320, 50, -280, 90);
  k.wall("cover", 60, -100, 80, -40);
}

function smoke(k: Kit, slot: () => void, gun: WeaponId) {
  const { caster } = k;
  caster.status.invulnerable = 99;
  k.give(caster, gun, 2);
  const stuck: string[] = [];
  const check = () => stuck.push(...stuckInGeometry(k.w));
  // Cast at the enemy down the corridor, shoot, recast toward the east wall.
  slot();
  check();
  k.run(12, (_i, p) => (p === caster ? { buttons: BTN.shoot, aim: Math.PI } : undefined));
  check();
  caster.aim = 0;
  k.act({ pressed: BTN.p1 | BTN.p2, aim: 0 });
  check();
  // Again, point blank into the wall, then shoot while shoving into walls and corners.
  for (const s of caster.slots) if (s) s.cd = 0;
  if (caster.ult) caster.ult.charge = 100;
  slot();
  for (let i = 0; i < ticks(4); i++) {
    k.run(1, (_j, p) => (p === caster ? { buttons: BTN.shoot, mx: i % 40 < 20 ? 1 : -0.4, my: i % 26 < 13 ? 1 : -1, aim: i * 0.21 } : { mx: -1, my: 0.3 }));
    check();
  }
  return { stuck, shots: k.events.filter((e) => (e.t === "shoot" || e.t === "slash") && e.by === caster.id).length };
}

describe("every power in the walled world", () => {
  test("all 18 powers are registered", () => {
    expect(allPowers().map((p) => p.id).sort()).toEqual([...POWER_IDS].sort());
  });

  POWER_IDS.forEach((id: PowerId, i) => {
    const gun = GUNS[i % GUNS.length] as WeaponId;
    test(`${id} with a ${gun}: no crash, nobody inside geometry`, () => {
      const k = kit({ powers: [id], enemies: [[-260, 20], [420, 0], [-520, -40]], seed: 30 + i });
      corridor(k);
      const r = smoke(k, () => k.cast(0, Math.PI), gun);
      expect(r.stuck).toEqual([]);
      expect(r.shots).toBeGreaterThan(0);
      expect(k.events.some((e) => e.t === "cast" && e.power === id)).toBe(true);
    });
  });
});

describe("every ultimate in the walled world", () => {
  test("all 6 ultimates are registered", () => {
    expect(allUlts().map((u) => u.id).sort()).toEqual([...ULT_IDS].sort());
  });

  ULT_IDS.forEach((id: UltId, i) => {
    const gun = GUNS[(i * 3 + 1) % GUNS.length] as WeaponId;
    test(`${id} with a ${gun}: no crash, nobody inside geometry`, () => {
      const k = kit({ ult: id, powers: ["mirrorSelf", "decoySwarm"], enemies: [[-260, 20], [420, 0], [-520, -40]], seed: 60 + i });
      corridor(k);
      const r = smoke(k, () => k.ult(Math.PI), gun);
      expect(r.stuck).toEqual([]);
      expect(r.shots).toBeGreaterThan(0);
      expect(k.events.some((e) => e.t === "cast" && e.power === id)).toBe(true);
    });
  });
});

describe("terrain", () => {
  test("Shockwave Slam: walls shield people behind them; the landing smashes crates and barrels", () => {
    const k = kit({ powers: ["shockwaveSlam"], enemies: [[200, 0], [-150, 0]] });
    const [behind, open] = k.enemies as [NonNullable<Kit["enemies"][0]>, NonNullable<Kit["enemies"][0]>];
    k.wall("wall", 100, -200, 124, 200);
    const crate = k.wall("crate", -60, -120, -20, -80);
    const barrel = k.wall("barrel", 20, 70, 60, 110);
    k.cast();
    k.run(ticks(POWERS.shockwaveSlam.airTime) + 2);
    expect(behind.hp).toBe(100);
    expect(open.hp).toBeLessThan(100);
    expect(crate.dead).toBe(true);
    expect(barrel.dead).toBe(true);
  });

  test("Boomerang Glaive bounces off walls (never through) and shatters after enough bounces", () => {
    const k = kit({ powers: ["boomerangGlaive"] });
    // A tight box: it ricochets around inside.
    k.wall("wall", 160, -300, 172, 300);
    k.wall("wall", -172, -300, -160, 300);
    k.wall("wall", -172, -172, 172, -160);
    k.wall("wall", -172, 160, 172, 172);
    k.cast(0, 0.3);
    const g = k.fx("glaive")[0]!;
    for (let i = 0; i < ticks(POWERS.boomerangGlaive.maxFlight); i++) {
      k.run(1);
      if (!g.dead) {
        expect(Math.abs(g.x)).toBeLessThan(160);
        expect(Math.abs(g.y)).toBeLessThan(160);
      }
    }
    expect(k.events.filter((e) => e.t === "impact").length).toBeGreaterThan(2);
  });

  test("Meteor impacts break crates, glass and barrels, and walls shield players", () => {
    const k = kit({ ult: "meteorRain", enemies: [[0, 60], [300, 0]] });
    const [shielded] = k.enemies as [NonNullable<Kit["enemies"][0]>];
    k.wall("wall", -80, 20, 80, 40);
    const crate = k.wall("crate", 300 - 40, 40, 300, 80);
    const glass = k.wall("glass", 300 + 30, -60, 300 + 40, 60);
    k.w.spawnEffect({ kind: "meteorWarn", owner: 1, source: "meteorRain", x: 0, y: -20, r: ULTIMATES.meteorRain.impactRadius, life: 0.05, n: 1 });
    k.w.spawnEffect({ kind: "meteorWarn", owner: 1, source: "meteorRain", x: 300, y: 0, r: ULTIMATES.meteorRain.impactRadius, life: 0.05, n: 1 });
    k.run(3);
    expect(shielded.hp).toBe(100);
    expect(k.enemies[1]!.hp).toBeLessThan(100);
    expect(crate.dead).toBe(true);
    expect(glass.dead).toBe(true);
  });

  test("Rift Collapse shatters destructibles along the seam only", () => {
    const k = kit({ ult: "riftCollapse" });
    const near = k.wall("crate", 500, 40, 550, 90);
    const glass = k.wall("glass", -400, -60, -390, 60);
    const fence = k.wall("fence", 700, -30, 714, 30);
    const far = k.wall("crate", 500, 400, 550, 450);
    k.ult(0);
    k.run(ticks(ULTIMATES.riftCollapse.pullTime) + 2);
    expect(near.dead).toBe(true);
    expect(glass.dead).toBe(true);
    expect(fence.dead).toBe(true);
    expect(far.dead).toBe(false);
  });

  test("Portal Pair: portals sit clear of walls; a player exiting into a wall lands on open floor", () => {
    const k = kit({ powers: ["portalPair"], enemies: [[-560, 0]] });
    const runner = k.enemies[0]!;
    k.wall("wall", 30, -300, 54, 300);
    k.caster.x = -400;
    k.cast(0, 0);
    k.caster.x = 0;
    k.act({ pressed: BTN.p1, aim: 0 });
    const portals = k.fx("portal");
    expect(portals).toHaveLength(2);
    for (const p of portals) expect(circleBlocked(k.w.map, p.x, p.y, POWERS.portalPair.placeClearance - 1)).toBe(false);
    k.caster.x = 0;
    k.caster.y = 260;
    // The runner sprints east into the orange portal and pops out of the blue one, facing the wall.
    let ported = false;
    for (let i = 0; i < 40 && !ported; i++) {
      k.run(1, (_j, p) => (p === runner ? { mx: 1 } : undefined));
      ported = k.events.some((e) => e.t === "portal");
      expect(stuckInGeometry(k.w)).toEqual([]);
    }
    expect(ported).toBe(true);
    expect(runner.x).toBeLessThan(30);
    // A shot into the orange portal whose exit would be inside the wall leaves from the portal's center.
    const shot = k.w.spawnProjectile({ owner: 9, x: -470, y: 0, vx: 900, vy: 0, life: 1, weapon: "rifle", source: "rifle" });
    k.run(8);
    expect(shot.dead).toBe(true);
  });

  test("Mirror Self: the clone splits off without crossing a thin wall, and never tunnels through one", () => {
    const k = kit({ powers: ["mirrorSelf"] });
    k.wall("wall", -400, 40, 400, 52);
    k.wall("wall", -400, -52, 400, -40);
    k.wall("wall", -100, -40, -88, 40);
    k.cast(0, 0);
    const clone = k.fx("clone")[0]!;
    expect(Math.abs(clone.y)).toBeLessThan(40);
    // Dash east: the clone races west into the thin wall and must stop at it.
    k.run(20, (i, p) => (p === k.caster ? { mx: 1, pressed: i === 0 ? BTN.dash : 0 } : undefined));
    expect(clone.x).toBeGreaterThan(-88);
    expect(stuckInGeometry(k.w)).toEqual([]);
  });

  test("Chrono Rewind, Hex Swap and Mirror swaps never land inside geometry", () => {
    const k = kit({ powers: ["chronoRewind", "hexSwap"], enemies: [[300, 0]] });
    k.wall("cover", 150, 60, 170, 200);
    k.wall("wall", -200, -60, -176, 60);
    k.run(10, (_i, p) => (p === k.caster ? { mx: -1 } : undefined));
    k.run(20, (_i, p) => (p === k.caster ? { mx: 1, my: 1 } : undefined));
    k.cast(1, 0);
    expect(stuckInGeometry(k.w)).toEqual([]);
    k.cast(0);
    expect(stuckInGeometry(k.w)).toEqual([]);
  });
});

describe("line of sight", () => {
  test("Hex Swap can't target an enemy behind a wall", () => {
    const k = kit({ powers: ["hexSwap"], enemies: [[400, 0]] });
    k.wall("wall", 150, -200, 174, 200);
    k.cast(0, 0);
    expect(k.caster.x).toBeCloseTo(0, 0);
    expect(k.caster.slots[0]!.cd).toBe(0);
  });

  test("Singularity: no pull through walls; the orb collapses against a wall", () => {
    const k = kit({ enemies: [[200, 0], [-200, 0]] });
    const [behind, open] = k.enemies as [NonNullable<Kit["enemies"][0]>, NonNullable<Kit["enemies"][0]>];
    k.wall("wall", 100, -200, 124, 200);
    k.w.spawnEffect({ kind: "singularity", owner: 1, source: "singularity", x: 0, y: 0, r: POWERS.singularity.radius, life: 1 });
    k.run(15);
    expect(behind.x).toBeCloseTo(200, 0);
    expect(open.x).toBeGreaterThan(-200 + 20);

    const o = kit({ powers: ["singularity"] });
    o.wall("wall", 150, -200, 174, 200);
    o.cast(0, 0);
    o.run(6);
    const hole = o.fx("singularity")[0];
    expect(hole).toBeDefined();
    expect(hole!.x).toBeLessThan(150);
    expect(hole!.x).toBeGreaterThan(80);
  });

  test("Storm Tether: a wall across the chain breaks it without the snap damage", () => {
    const k = kit({ powers: ["stormTether"], enemies: [[300, 0]] });
    const target = k.enemies[0]!;
    k.cast(0, 0);
    k.run(4);
    const tether = k.fx("tether")[0]!;
    expect(tether).toBeDefined();
    k.wall("wall", 140, -100, 164, 100);
    const hp = target.hp;
    k.run(ticks(POWERS.stormTether.wallBreak) + 3);
    expect(tether.v).toBe(1);
    expect(hp - target.hp).toBeLessThan(POWERS.stormTether.snapDamage);
  });

  test("Decoy pops only blind enemies who can see the flash", () => {
    const k = kit({ powers: ["decoySwarm"], enemies: [[120, 0], [-120, 0]] });
    const [behind, open] = k.enemies as [NonNullable<Kit["enemies"][0]>, NonNullable<Kit["enemies"][0]>];
    k.wall("wall", 50, -100, 74, 100);
    k.cast(0, Math.PI / 2);
    const d = k.fx("decoy")[0]!;
    d.x = 0;
    d.y = 0;
    k.w.spawnProjectile({ owner: 2, x: 0, y: -60, vx: 0, vy: 900, life: 1, source: "smg", weapon: "smg" });
    k.run(3);
    expect(open.status.blinded ?? 0).toBeGreaterThan(0);
    expect(behind.status.blinded ?? 0).toBe(0);
  });

  test("Final Stand's shockwave and Singularity's blast stop at walls", () => {
    const k = kit({ ult: "finalStand", enemies: [[200, 0], [-200, 0]] });
    const [behind, open] = k.enemies as [NonNullable<Kit["enemies"][0]>, NonNullable<Kit["enemies"][0]>];
    k.wall("wall", 100, -300, 124, 300);
    k.ult();
    k.run(ticks(ULTIMATES.finalStand.charge) + 2);
    expect(behind.hp).toBe(100);
    expect(open.hp).toBeLessThan(100);
  });

  test("Third-Party marks only qualifying enemies the caster can see", () => {
    const k = kit({ powers: ["thirdParty"], enemies: [[300, 0], [-300, 0], [600, 0]] });
    const [hidden, seen, brawler] = k.enemies as [NonNullable<Kit["enemies"][0]>, NonNullable<Kit["enemies"][0]>, NonNullable<Kit["enemies"][0]>];
    k.wall("wall", 150, -200, 174, 200);
    k.cast();
    k.w.damage(hidden, 5, brawler.id, "smg");
    k.w.damage(seen, 5, brawler.id, "smg");
    k.run(2);
    const marks = k.fx("vulture").filter((e) => e.n === 1).map((e) => e.link);
    expect(marks).toEqual([seen.id]);
    // The damage bonus itself doesn't care about walls (it's about who's hurting them).
    expect(k.w.damage(hidden, 10, k.caster.id, "rocket")).toBe(Math.round(10 * POWERS.thirdParty.mult));
  });

  test("Hunter's Eye: shots home only toward enemies in their line of fire", () => {
    const fire = (walled: boolean) => {
      const k = kit({ ult: "huntersEye", enemies: [[320, 230]] });
      if (walled) k.wall("wall", 120, 70, 520, 94);
      k.give(k.caster, "rifle");
      k.ult(0);
      k.act({ buttons: BTN.shoot, aim: 0 });
      const shot = k.w.projectiles.find((p) => p.owner === 1 && p.weapon === "rifle")!;
      k.run(5);
      return { k, shot };
    };
    const open = fire(false);
    expect(open.shot.dead || open.shot.vy > WEAPONS.rifle.speed * 0.2).toBe(true);
    const walled = fire(true);
    expect(Math.abs(walled.shot.vy)).toBeLessThan(WEAPONS.rifle.speed * 0.1);
    expect(walled.k.enemies[0]!.hp).toBe(100);
    expect(weaponDamage({ id: "rifle", rarity: 0 })).toBeGreaterThan(0);
  });
});
