// Powers part B on the real World: Molten Path, Boomerang Glaive, Gravity Flip, Bounty Beacon,
// Decoy Swarm, Shockwave Slam, Third-Party, plus the Event Horizon Blade and Gravity Slam combos.
import { describe, expect, test } from "vitest";
import { addSolid, BTN, PLAYER, POWERS, TERRAIN, ULT_CHARGE, World, type Effect, type GameEvent, type InputFrame, type Player, type PowerId } from "@prism/shared";
import { bountyTargets } from "../src/powers/bounty-beacon";
import { GLAIVE } from "../src/powers/boomerang-glaive";

const DT = 1 / 30;
let seq = 0;

interface Move {
  mx?: number;
  my?: number;
  buttons?: number;
  pressed?: number;
  aim?: number;
}

function frame(p: Player, m: Move = {}): InputFrame {
  return { seq: ++seq, mx: m.mx ?? 0, my: m.my ?? 0, aim: m.aim ?? p.aim, buttons: m.buttons ?? 0, pressed: m.pressed ?? 0, dt: DT, shotId: 0 };
}

interface Setup {
  w: World;
  caster: Player;
  enemies: Player[];
  events: GameEvent[];
  /** Steps n ticks. `moves(i, p)` gives each player's input for tick i (default idle). */
  run(n: number, moves?: (i: number, p: Player) => Move | undefined): void;
  cast(): void;
  fx(kind: Effect["kind"]): Effect[];
}

function setup(power: PowerId, enemyAt: [number, number][]): Setup {
  const w = new World("testYard", 11, { loot: false });
  const caster = w.addPlayer(1, "CASTER", 0, false);
  caster.x = 0;
  caster.y = 0;
  caster.aim = 0;
  caster.slots = [{ id: power, cd: 0, recast: 0 }, null, null];
  const enemies = enemyAt.map(([x, y], i) => {
    const e = w.addPlayer(2 + i, `E${i}`, 1 + i, true);
    e.x = x;
    e.y = y;
    return e;
  });
  const events: GameEvent[] = [];
  const s: Setup = {
    w, caster, enemies, events,
    run(n, moves) {
      for (let i = 0; i < n; i++) {
        const m = new Map<number, InputFrame[]>();
        for (const p of w.players.values()) m.set(p.id, [frame(p, moves?.(i, p))]);
        w.step(m);
        events.push(...w.events);
      }
    },
    cast() {
      s.run(1, (_i, p) => (p === caster ? { pressed: BTN.p1 } : undefined));
    },
    fx(kind) {
      return [...w.effects.values()].filter((e) => e.kind === kind && !e.dead);
    },
  };
  return s;
}

const ticks = (seconds: number) => Math.ceil(seconds * 30);
const hpLost = (p: Player) => PLAYER.maxHp - p.hp;

describe("Molten Path", () => {
  const C = POWERS.moltenPath;

  test("leaves a linked lava ribbon that burns enemies on the ground, credited to the caster", () => {
    const s = setup("moltenPath", [[150, 300]]);
    const [enemy] = s.enemies as [Player];
    s.cast();
    s.run(ticks(1), (_i, p) => (p === s.caster ? { mx: 1 } : undefined));
    const lava = s.fx("molten");
    expect(lava.length).toBeGreaterThan(8);
    expect(lava.every((e) => e.owner === s.caster.id && e.source === "moltenPath")).toBe(true);
    // Every drop after the first is a capsule joined to the previous one.
    expect(lava.filter((e) => e.n === 1).length).toBe(lava.length - 1);
    // Step the enemy onto the trail (between drops, so the capsule matters).
    enemy.x = 150;
    enemy.y = 2;
    s.run(ticks(1));
    expect(hpLost(enemy)).toBeGreaterThan(C.dps * 0.7);
    // Overlapping drops never stack: at most dps per second (plus one tick of rounding).
    expect(hpLost(enemy)).toBeLessThanOrEqual(C.dps * (1 + 0.3));
    expect(enemy.lastHitBy).toBe(s.caster.id);
    expect(enemy.lastHitSource).toBe("moltenPath");
  });

  test("the caster and airborne players are not burned, and the lava expires", () => {
    const s = setup("moltenPath", [[0, 0]]);
    const [enemy] = s.enemies as [Player];
    enemy.status.airborne = 99;
    s.cast();
    s.run(ticks(1));
    expect(hpLost(s.caster)).toBe(0);
    expect(hpLost(enemy)).toBe(0);
    s.run(ticks(C.duration + C.trailLife + 0.2));
    expect(s.fx("molten").length).toBe(0);
  });
});

describe("Boomerang Glaive", () => {
  const C = POWERS.boomerangGlaive;

  test("cuts on the way out and on the way back", () => {
    const s = setup("boomerangGlaive", [[110, 0]]);
    const [enemy] = s.enemies as [Player];
    s.cast();
    s.run(ticks(0.3));
    expect(hpLost(enemy)).toBe(C.damage);
    const g = s.fx("glaive")[0] as Effect;
    let guard = 0;
    while (g.n === GLAIVE.out && guard++ < 90) s.run(1);
    expect(g.n).toBe(GLAIVE.back);
    s.run(ticks(0.15));
    // Stand in its return path.
    const sp = Math.hypot(g.vx, g.vy);
    enemy.x = g.x + (g.vx / sp) * 90;
    enemy.y = g.y + (g.vy / sp) * 90;
    enemy.px = 0;
    enemy.py = 0;
    s.run(ticks(0.3));
    expect(hpLost(enemy)).toBe(C.damage * 2);
  });

  test("catching it resets the cooldown; missing it doesn't", () => {
    const s = setup("boomerangGlaive", []);
    s.cast();
    const slot = s.caster.slots[0]!;
    expect(slot.cd).toBeGreaterThan(0);
    const g = s.fx("glaive")[0] as Effect;
    s.run(ticks(3));
    expect(g.n === GLAIVE.caught || g.dead).toBe(true);
    expect(slot.cd).toBe(0);

    const m = setup("boomerangGlaive", []);
    m.cast();
    const mslot = m.caster.slots[0]!;
    m.run(ticks(0.4));
    m.w.teleport(m.caster, -500, 400);
    m.run(ticks(C.maxFlight));
    expect(mslot.cd).toBeGreaterThan(0);
    expect(m.fx("glaive").length).toBe(0);
  });

  test("chips a crate and bounces back off it", () => {
    const s = setup("boomerangGlaive", []);
    const crate = addSolid(s.w.map, "crate", 200, -30, 260, 30);
    s.cast();
    s.run(ticks(0.3));
    expect(crate.hp).toBeCloseTo(crate.maxHp - POWERS.boomerangGlaive.solidDamage);
    const g = s.fx("glaive")[0];
    expect(g).toBeDefined();
    expect(g!.vx).toBeLessThan(0);
    expect(g!.x).toBeLessThan(200);
  });

  test("Event Horizon Blade: a Singularity captures it into orbit and it shreds anyone near the hole", () => {
    const s = setup("boomerangGlaive", [[330, -40], [-600, 0]]);
    const [victim, holeOwner] = s.enemies as [Player, Player];
    const hole = s.w.spawnEffect({ kind: "singularity", owner: holeOwner.id, source: "singularity", x: 300, y: -40, r: POWERS.singularity.radius, life: POWERS.singularity.duration });
    s.cast();
    s.run(ticks(0.5));
    const g = s.fx("glaive")[0] as Effect;
    expect(g.n).toBe(GLAIVE.orbit);
    expect(g.link).toBe(hole.id);
    const combo = s.events.find((e) => e.t === "combo");
    expect(combo).toMatchObject({ t: "combo", by: s.caster.id, name: "EVENT HORIZON BLADE", stolen: true });
    const before = victim.hp;
    victim.x = 300;
    victim.y = -40;
    s.run(ticks(1));
    // The orbit hits repeatedly (several hazard ticks), well past one blade hit.
    expect(before - victim.hp).toBeGreaterThan(POWERS.boomerangGlaive.damage);
    // It ends with the black hole.
    s.run(ticks(POWERS.singularity.duration));
    expect(s.fx("glaive").length).toBe(0);
  });
});

describe("Gravity Flip", () => {
  const C = POWERS.gravityFlip;

  test("a hit inverts the victim's movement for 2.5s and marks them", () => {
    const s = setup("gravityFlip", [[300, 0]]);
    const [enemy] = s.enemies as [Player];
    s.cast();
    s.run(ticks(0.5));
    expect(hpLost(enemy)).toBe(C.damage);
    expect(enemy.status.inverted ?? 0).toBeGreaterThan(C.duration - 0.6);
    const flip = s.fx("flip");
    expect(flip.length).toBe(1);
    expect(flip[0]?.link).toBe(enemy.id);
    const x0 = enemy.x;
    s.run(ticks(0.5), (_i, p) => (p === enemy ? { mx: 1 } : undefined));
    expect(enemy.x).toBeLessThan(x0 - 60);
    s.run(ticks(C.duration));
    expect(enemy.status.inverted ?? 0).toBe(0);
    expect(s.fx("flip").length).toBe(0);
  });

  test("a miss does nothing", () => {
    const s = setup("gravityFlip", [[0, 400]]);
    s.cast();
    s.run(ticks(1.5));
    expect(s.enemies[0]?.status.inverted ?? 0).toBe(0);
  });
});

describe("Bounty Beacon", () => {
  test("marks the leader(s); the next-highest if the caster leads; the nearest if nobody scored", () => {
    const s = setup("bountyBeacon", [[500, 0], [-300, 0], [0, 200]]);
    const [a, b, c] = s.enemies as [Player, Player, Player];
    const ids = () => bountyTargets(s.w, s.caster).map((p) => p.id).sort();
    s.w.points = new Map([[s.caster.id, 0], [a.id, 5], [b.id, 5], [c.id, 3]]);
    expect(ids()).toEqual([a.id, b.id].sort());
    s.w.points = new Map([[s.caster.id, 9], [a.id, 3], [b.id, 5], [c.id, 1]]);
    expect(ids()).toEqual([b.id]);
    s.w.points = new Map([[s.caster.id, 6], [a.id, 6], [b.id, 2], [c.id, 0]]);
    expect(ids()).toEqual([a.id]);
    s.w.points = new Map();
    expect(ids()).toEqual([c.id]);
  });

  test("bountied target glows for 6s, the beacon follows them, and damaging them charges your ult", () => {
    const s = setup("bountyBeacon", [[400, 0], [-400, 0]]);
    const [leader, other] = s.enemies as [Player, Player];
    s.w.points = new Map([[leader.id, 7], [other.id, 2]]);
    other.ult = { id: "overdrive", charge: 0 };
    s.cast();
    expect(leader.status.bountied ?? 0).toBeGreaterThan(5);
    expect(other.status.bountied ?? 0).toBe(0);
    const beacon = s.fx("beacon")[0] as Effect;
    expect(beacon.link).toBe(leader.id);
    leader.x = 100;
    s.run(1);
    expect(beacon.x).toBeCloseTo(100, 0);
    s.w.damage(leader, 10, other.id, "pistol");
    expect(other.ult.charge).toBeCloseTo(10 * (ULT_CHARGE.perDamageDealt + POWERS.bountyBeacon.ultPerDamage));
    expect(other.ult.charge).toBeGreaterThan(10 * ULT_CHARGE.perDamageDealt);
    s.run(ticks(POWERS.bountyBeacon.duration + 0.1));
    expect(leader.status.bountied ?? 0).toBe(0);
    expect(s.fx("beacon").length).toBe(0);
  });
});

describe("Decoy Swarm", () => {
  const C = POWERS.decoySwarm;

  test("five decoys scatter; a shot pops one into a blinding flash", () => {
    const s = setup("decoySwarm", [[0, 600]]);
    const [enemy] = s.enemies as [Player];
    s.cast();
    s.run(ticks(0.4));
    const decoys = s.fx("decoy");
    expect(decoys.length).toBe(C.count);
    for (const d of decoys) expect(Math.hypot(d.x, d.y)).toBeGreaterThan(60);
    const d = decoys[0] as Effect;
    enemy.x = d.x + 80;
    enemy.y = d.y;
    s.w.spawnProjectile({ owner: enemy.id, x: d.x - 60, y: d.y, vx: 980, vy: 0 });
    s.run(2);
    expect(d.dead).toBe(true);
    expect(s.fx("decoy").length).toBe(C.count - 1);
    expect(s.fx("shockwave").some((e) => e.source === "decoySwarm")).toBe(true);
    expect(enemy.status.blinded ?? 0).toBeGreaterThan(0.5);
    expect(s.caster.status.blinded ?? 0).toBe(0);
  });

  test("decoys fade out after their life", () => {
    const s = setup("decoySwarm", []);
    s.cast();
    s.run(ticks(C.life * 1.15));
    expect(s.fx("decoy").length).toBe(0);
  });
});

describe("Shockwave Slam", () => {
  const C = POWERS.shockwaveSlam;

  test("airborne during the leap, then damages and blasts everyone nearby", () => {
    const s = setup("shockwaveSlam", [[120, 0], [600, 0]]);
    const [near, far] = s.enemies as [Player, Player];
    s.cast();
    expect(s.caster.status.airborne ?? 0).toBeGreaterThan(0);
    // Shots pass under an airborne player.
    s.w.spawnProjectile({ owner: near.id, x: -80, y: 0, vx: 980, vy: 0 });
    s.run(ticks(C.airTime) + 1);
    expect(hpLost(s.caster)).toBe(0);
    expect(hpLost(near)).toBeGreaterThanOrEqual(C.damage);
    expect(near.px).toBeGreaterThan(400);
    expect(hpLost(far)).toBe(0);
    expect(s.events.some((e) => e.t === "explode" && e.source === "shockwaveSlam")).toBe(true);
  });

  test("knocking someone into a wall deals bonus slam damage", () => {
    const s = setup("shockwaveSlam", [[0, 0]]);
    const [enemy] = s.enemies as [Player];
    // The east edge wall of the yard, then inward from it.
    const mx = s.w.map.half;
    enemy.x = mx - 90;
    enemy.y = 0;
    s.caster.x = mx - 200;
    s.caster.y = 0;
    s.cast();
    s.run(ticks(C.airTime + C.comboWindow));
    expect(s.events.some((e) => e.t === "wallSlam" && e.target === enemy.id)).toBe(true);
    expect(hpLost(enemy)).toBeGreaterThanOrEqual(C.damage + TERRAIN.wallSlamDamage * C.wallBonus + 5);
  });

  test("Gravity Slam: blasting an enemy into a Singularity doubles its detonation", () => {
    const s = setup("shockwaveSlam", [[80, 0]]);
    const [enemy] = s.enemies as [Player];
    const hole = s.w.spawnEffect({ kind: "singularity", owner: s.caster.id, source: "singularity", x: 340, y: 0, r: POWERS.singularity.radius, life: 3 });
    s.cast();
    s.run(ticks(C.airTime + C.comboWindow));
    expect(hole.v).toBe(2);
    expect(s.events.find((e) => e.t === "combo")).toMatchObject({ name: "GRAVITY SLAM", stolen: false, by: s.caster.id });
    const hp = enemy.hp;
    s.run(ticks(3));
    // Detonation at double damage (plus maybe a touch of anything else).
    expect(hp - enemy.hp).toBeGreaterThanOrEqual(POWERS.singularity.damage * 2);
  });

  test("Gravity Slam with someone else's Singularity is stolen", () => {
    const s = setup("shockwaveSlam", [[80, 0], [-700, 0]]);
    const [, other] = s.enemies as [Player, Player];
    const hole = s.w.spawnEffect({ kind: "singularity", owner: other.id, source: "singularity", x: 340, y: 0, r: POWERS.singularity.radius, life: 3 });
    s.cast();
    s.run(ticks(C.airTime + C.comboWindow));
    expect(hole.v).toBe(2);
    expect(s.events.find((e) => e.t === "combo")).toMatchObject({ name: "GRAVITY SLAM", stolen: true });
  });
});

describe("Third-Party", () => {
  test("bonus damage on targets someone else is hurting, even after you start hitting them", () => {
    const s = setup("thirdParty", [[300, 0], [600, 0]]);
    const [target, brawler] = s.enemies as [Player, Player];
    const boosted = Math.round(10 * POWERS.thirdParty.mult);
    s.cast();
    expect(s.caster.status.thirdParty ?? 0).toBeGreaterThan(4);
    expect(s.w.damage(target, 10, s.caster.id, "pistol")).toBe(10);
    s.w.damage(target, 5, brawler.id, "pistol");
    expect(s.w.damage(target, 10, s.caster.id, "pistol")).toBe(boosted);
    // The brawler's hit still counts after our own hit.
    expect(s.w.damage(target, 10, s.caster.id, "pistol")).toBe(boosted);
    // The other player stops: the bonus fades after the window.
    s.run(ticks(POWERS.thirdParty.recentWindow + 0.1));
    expect(s.w.damage(target, 5, s.caster.id, "pistol")).toBe(5);
  });

  test("the caster gets a crosshair marker on qualifying targets only", () => {
    const s = setup("thirdParty", [[300, 0], [600, 0], [0, 400]]);
    const [target, brawler, bystander] = s.enemies as [Player, Player, Player];
    s.cast();
    s.w.damage(target, 5, brawler.id, "pistol");
    s.run(2);
    const markers = s.fx("vulture").filter((e) => e.n === 1);
    expect(markers.map((m) => m.link)).toEqual([target.id]);
    expect(markers[0]?.owner).toBe(s.caster.id);
    expect(markers.some((m) => m.link === bystander.id)).toBe(false);
    s.run(ticks(POWERS.thirdParty.recentWindow + POWERS.thirdParty.markerLinger + 0.2));
    expect(s.fx("vulture").filter((e) => e.n === 1).length).toBe(0);
    s.run(ticks(POWERS.thirdParty.duration));
    expect(s.fx("vulture").length).toBe(0);
  });
});
