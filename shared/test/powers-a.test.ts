// Powers part A on the real World: Chrono Rewind, Mirror Self, Storm Tether, Time Bubble,
// Ricochet Prism, Phantom Mark, Hex Swap, Magnetar, Void Cloak, plus the Storm Gate,
// Lava Lock and Frozen Harvest combos.
import { describe, expect, test } from "vitest";
import { BTN, PF, PLAYER, POWERS, PROJ, weaponDamage, WEAPONS, World, type Effect, type GameEvent, type InputFrame, type Player, type PowerId } from "@prism/shared";

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

function setup(power: PowerId, enemyAt: [number, number][]) {
  const w = new World("testYard", 5, { loot: false });
  const caster = w.addPlayer(1, "CASTER", 0, false);
  caster.x = 0;
  caster.y = 0;
  caster.aim = 0;
  caster.slots = [{ id: power, cd: 0, recast: 0 }, null, null];
  const enemies = enemyAt.map(([x, y], i) => {
    const e = w.addPlayer(2 + i, `E${i}`, 1 + i, false);
    e.x = x;
    e.y = y;
    e.aim = Math.PI;
    return e;
  });
  const events: GameEvent[] = [];
  const run = (n: number, moves?: (i: number, p: Player) => Move | undefined) => {
    for (let i = 0; i < n; i++) {
      const m = new Map<number, InputFrame[]>();
      for (const p of w.players.values()) m.set(p.id, [frame(p, moves?.(i, p))]);
      w.step(m);
      events.push(...w.events);
    }
  };
  const cast = () => run(1, (_i, p) => (p.id === caster.id ? { pressed: BTN.p1 } : undefined));
  const fx = (kind: Effect["kind"]) => [...w.effects.values()].filter((e) => e.kind === kind && !e.dead);
  const combos = () => events.filter((e): e is Extract<GameEvent, { t: "combo" }> => e.t === "combo");
  return { w, caster, enemies, events, run, cast, fx, combos };
}

describe("Chrono Rewind", () => {
  test("snaps back 2.5s along the path and restores HP lost in that window", () => {
    const s = setup("chronoRewind", [[0, 600]]);
    const { caster } = s;
    caster.x = -600;
    s.run(30);
    const start = { x: caster.x, y: caster.y };
    s.run(60, (_i, p) => (p.id === 1 ? { mx: 1 } : undefined));
    s.w.damage(caster, 30, 2, "pistol");
    s.run(20, (_i, p) => (p.id === 1 ? { mx: 1 } : undefined));
    expect(caster.x - start.x).toBeGreaterThan(600);
    expect(caster.hp).toBeCloseTo(70, 0);
    s.cast();
    expect(Math.hypot(caster.x - start.x, caster.y - start.y)).toBeLessThan(120);
    expect(caster.hp).toBeCloseTo(100, 0);
    expect(caster.warp).toBeGreaterThan(0);
    expect(caster.status.invulnerable ?? 0).toBeGreaterThan(0);
    const trail = s.fx("rewindTrail");
    expect(trail.length).toBe(POWERS.chronoRewind.trailPoints - 1);
    expect(trail.every((e) => e.v === trail.length)).toBe(true);
  });

  test("damage taken before the window is not restored", () => {
    const s = setup("chronoRewind", [[0, 600]]);
    s.w.damage(s.caster, 30, 2, "pistol");
    s.run(84);
    s.cast();
    expect(s.caster.hp).toBeLessThanOrEqual(70.5);
  });
});

describe("Mirror Self", () => {
  test("clone mirrors movement, fires 40% shots with you, recast swaps, hits shatter it", () => {
    const s = setup("mirrorSelf", [[700, 0]]);
    const { caster } = s;
    s.cast();
    const clone = s.fx("clone")[0]!;
    expect(clone).toBeDefined();
    expect(clone.v).toBe(POWERS.mirrorSelf.hp);
    const c0 = { x: clone.x, y: clone.y };
    s.run(15, (_i, p) => (p.id === 1 ? { mx: 1 } : undefined));
    expect(caster.x).toBeGreaterThan(40);
    expect(clone.x).toBeLessThan(c0.x - 40);
    // Fire: the clone fires too.
    s.run(1, (_i, p) => (p.id === 1 ? { buttons: BTN.shoot } : undefined));
    const cloneShots = s.w.projectiles.filter((p) => p.kind === PROJ.clone && p.owner === caster.id);
    expect(cloneShots.length).toBe(1);
    expect(cloneShots[0]!.damage).toBeCloseTo(weaponDamage({ id: "pistol", rarity: 0 }) * POWERS.mirrorSelf.damageMult);
    // Recast swaps places.
    const before = { px: caster.x, py: caster.y, cx: clone.x, cy: clone.y };
    s.run(1, (_i, p) => (p.id === 1 ? { pressed: BTN.p1 } : undefined));
    expect(Math.abs(caster.x - before.cx)).toBeLessThan(8);
    expect(Math.abs(clone.x - before.px)).toBeLessThan(8);
    expect(clone.n).toBe(1);
    expect(caster.slots[0]!.recast).toBe(0);
    // Enemy shots pop it after enough damage.
    for (let k = 0; k < 3; k++) {
      s.w.spawnProjectile({ owner: 2, x: clone.x + 60, y: clone.y, vx: -WEAPONS.pistol.speed, vy: 0, damage: 14 });
      s.run(3);
    }
    expect(clone.dead || !s.w.effects.has(clone.id)).toBe(true);
    expect(s.events.some((e) => e.t === "explode" && e.source === "mirrorSelf")).toBe(true);
  });
});

describe("Storm Tether", () => {
  test("bolt chains the target, chips both, and snaps for big damage when stretched", () => {
    const s = setup("stormTether", [[300, 0]]);
    const [enemy] = s.enemies;
    s.cast();
    s.run(8);
    const tether = s.fx("tether")[0]!;
    expect(tether).toBeDefined();
    expect(tether.link).toBe(enemy!.id);
    expect(enemy!.status.tethered ?? 0).toBeGreaterThan(0);
    expect(s.caster.status.tethered ?? 0).toBeGreaterThan(0);
    const hpE = enemy!.hp;
    const hpC = s.caster.hp;
    s.run(31);
    expect(enemy!.hp).toBeLessThan(hpE);
    expect(s.caster.hp).toBeLessThan(hpC);
    const beforeSnap = enemy!.hp;
    s.w.teleport(enemy!, 900, 0);
    s.run(1);
    expect(beforeSnap - enemy!.hp).toBeGreaterThanOrEqual(POWERS.stormTether.snapDamage);
    expect(tether.v).toBe(1);
  });

  test("Storm Gate: a bolt through a portal stays linked through the pair", () => {
    const s = setup("stormTether", [[-300, 500]]);
    const a = s.w.spawnEffect({ kind: "portal", owner: 1, source: "portalPair", x: 130, y: 0, r: POWERS.portalPair.radius, life: 10, n: 0 });
    const b = s.w.spawnEffect({ kind: "portal", owner: 1, source: "portalPair", x: -600, y: 500, r: POWERS.portalPair.radius, life: 10, n: 1, link: a.id });
    a.link = b.id;
    s.cast();
    s.run(12);
    const tether = s.fx("tether")[0]!;
    expect(tether).toBeDefined();
    expect(s.combos().some((c) => c.name === "STORM GATE")).toBe(true);
    s.run(1);
    expect(tether.n).toBe(1);
    expect(tether.x).toBeCloseTo(a.x);
    expect(tether.x2).toBeCloseTo(b.x);
    // Straight-line distance is beyond the max length, but the routed chain holds.
    expect(Math.hypot(s.enemies[0]!.x, s.enemies[0]!.y)).toBeGreaterThan(POWERS.stormTether.maxLength);
    expect(tether.v).toBe(0);
  });
});

describe("Time Bubble", () => {
  test("slows enemy shots and players inside; boosts the caster's shots leaving it", () => {
    const s = setup("timeBubble", [[120, 120]]);
    s.cast();
    expect(s.fx("bubble").length).toBe(1);
    const enemyShot = s.w.spawnProjectile({ owner: 2, x: -100, y: -100, vx: 0, vy: 600, life: 2 });
    const y0 = enemyShot.y;
    s.run(1);
    expect(enemyShot.y - y0).toBeCloseTo(600 * DT * POWERS.timeBubble.slow, 1);
    // Enemy inside moves at quarter speed.
    const e = s.enemies[0]!;
    const ex = e.x;
    s.run(10, (_i, p) => (p.id === 2 ? { mx: 1 } : undefined));
    expect(e.status.timeBubble ?? 0).toBeGreaterThan(0);
    expect(e.x - ex).toBeLessThan(PLAYER.speed * 10 * DT * 0.4);
    // Caster's shot from inside gets the exit boost once.
    const own = s.w.spawnProjectile({ owner: 1, x: 0, y: -200, vx: 0, vy: -WEAPONS.pistol.speed, life: 1 });
    s.run(4);
    expect(own.flags & PF.bubbleBoost).toBeTruthy();
    expect(Math.hypot(own.vx, own.vy)).toBeCloseTo(WEAPONS.pistol.speed * POWERS.timeBubble.exitSpeedMult, 0);
    expect(own.damage).toBeCloseTo(10 * POWERS.timeBubble.exitDamageMult);
  });
});

describe("Ricochet Prism", () => {
  test("shots gain bounces and bounce off walls with growing damage", () => {
    const s = setup("ricochetPrism", [[0, 700]]);
    s.caster.x = s.w.map.half * 0.6;
    s.cast();
    expect(s.caster.status.ricochet ?? 0).toBeGreaterThan(0);
    expect(s.fx("prismAura").length).toBe(1);
    s.run(1, (_i, p) => (p.id === 1 ? { buttons: BTN.shoot } : undefined));
    const shot = s.w.projectiles.find((p) => p.owner === 1)!;
    expect(shot.flags & PF.ricochet).toBeTruthy();
    expect(shot.maxBounces).toBe(POWERS.ricochetPrism.maxBounces);
    s.run(20);
    expect(s.events.some((e) => e.t === "bounce")).toBe(true);
    expect(shot.bounces).toBeGreaterThanOrEqual(1);
    expect(shot.damage).toBeGreaterThan(WEAPONS.pistol.damage);
  });
});

describe("Phantom Mark", () => {
  test("dash marks enemies passed; the sigil detonates for 20", () => {
    const s = setup("phantomMark", [[160, 0]]);
    s.cast();
    expect(s.caster.status.dashing ?? 0).toBeGreaterThan(0);
    expect(s.caster.status.invulnerable ?? 0).toBeGreaterThan(0);
    s.run(8);
    expect(s.caster.x).toBeGreaterThan(200);
    const sigil = s.fx("sigil")[0]!;
    expect(sigil.link).toBe(2);
    const hp = s.enemies[0]!.hp;
    s.run(Math.ceil(POWERS.phantomMark.fuse * 30) + 2);
    expect(hp - s.enemies[0]!.hp).toBeCloseTo(POWERS.phantomMark.damage, 0);
  });

  test("shooting the marked enemy doubles the detonation", () => {
    const s = setup("phantomMark", [[160, 0]]);
    s.cast();
    s.run(8);
    const e = s.enemies[0]!;
    s.w.spawnProjectile({ owner: 1, x: e.x, y: e.y - 80, vx: 0, vy: WEAPONS.pistol.speed });
    s.run(3);
    const sigil = s.fx("sigil")[0]!;
    expect(sigil.n).toBe(1);
    const hp = e.hp;
    s.run(Math.ceil(POWERS.phantomMark.fuse * 30));
    expect(hp - e.hp).toBeCloseTo(POWERS.phantomMark.damage * POWERS.phantomMark.shotMult, 0);
  });
});

describe("Hex Swap", () => {
  test("swaps with the nearest enemy in the cone and retargets incoming shots", () => {
    const s = setup("hexSwap", [[420, 40], [0, 500]]);
    const [target, shooter] = s.enemies;
    // A shot from the second enemy about to hit the caster.
    const pr = s.w.spawnProjectile({ owner: shooter!.id, x: 0, y: 150, vx: 0, vy: -WEAPONS.pistol.speed, life: 1 });
    s.cast();
    expect(s.caster.x).toBeCloseTo(420, 0);
    expect(target!.x).toBeCloseTo(0, 0);
    expect(pr.flags & PF.retargeted).toBeTruthy();
    expect(s.fx("hexFlash").length).toBe(1);
    expect(s.caster.slots[0]!.cd).toBeGreaterThan(0);
  });

  test("refuses with no enemy in the cone and keeps the cooldown", () => {
    const s = setup("hexSwap", [[420, 0]]);
    s.caster.aim = Math.PI;
    s.run(1, (_i, p) => (p.id === 1 ? { pressed: BTN.p1, aim: Math.PI } : undefined));
    expect(s.caster.x).toBeCloseTo(0, 0);
    expect(s.caster.slots[0]!.cd).toBe(0);
  });

  test("Lava Lock: swapping an enemy onto your molten trail slows them and announces the combo", () => {
    const s = setup("hexSwap", [[400, 0]]);
    s.w.spawnEffect({ kind: "molten", owner: 1, source: "moltenPath", x: 0, y: 0, r: POWERS.moltenPath.radius, life: 3 });
    s.cast();
    expect(s.combos().some((c) => c.name === "LAVA LOCK" && !c.stolen)).toBe(true);
    expect(s.enemies[0]!.status.slowed ?? 0).toBeGreaterThan(0);
  });
});

describe("Magnetar", () => {
  test("captures enemy shots into a harmless orbit and releases them as yours", () => {
    const s = setup("magnetar", [[600, 0]]);
    s.cast();
    const hp = s.caster.hp;
    const shots = [0, 1, 2].map((k) => s.w.spawnProjectile({ owner: 2, x: 140, y: -20 + k * 20, vx: -WEAPONS.pistol.speed, vy: 0, life: 1 }));
    s.run(20);
    for (const pr of shots) {
      expect(pr.flags & PF.captured).toBeTruthy();
      expect(Math.hypot(pr.x - s.caster.x, pr.y - s.caster.y)).toBeCloseTo(POWERS.magnetar.orbitRadius, -1);
    }
    expect(s.caster.hp).toBe(hp);
    expect(s.fx("magnet")[0]!.n).toBe(3);
    s.run(1, (_i, p) => (p.id === 1 ? { pressed: BTN.p1 } : undefined));
    for (const pr of shots) {
      expect(pr.owner).toBe(1);
      expect(pr.flags & PF.captured).toBeFalsy();
      expect(pr.flags & PF.released).toBeTruthy();
      expect(Math.hypot(pr.vx, pr.vy)).toBeCloseTo(POWERS.magnetar.releaseSpeed, 0);
    }
    expect(s.fx("magnet").length).toBe(0);
    // Released shots are the caster's now: they fly away and never hurt the caster.
    s.run(10);
    expect(s.caster.hp).toBe(hp);
    for (const pr of shots) expect(pr.dead || Math.hypot(pr.x - s.caster.x, pr.y - s.caster.y) > POWERS.magnetar.orbitRadius * 2).toBe(true);
  });

  test("holds at most the cap; expiry releases automatically", () => {
    const s = setup("magnetar", [[600, 0]]);
    s.cast();
    for (let k = 0; k < 15; k++) s.w.spawnProjectile({ owner: 2, x: 120 + k * 2, y: -70 + k * 10, vx: -200, vy: 0, life: 3 });
    s.run(3);
    const held = s.w.projectiles.filter((p) => (p.flags & PF.captured) !== 0);
    expect(held.length).toBe(POWERS.magnetar.maxCaptured);
    s.run(Math.ceil(POWERS.magnetar.duration * 30));
    expect(s.w.projectiles.some((p) => (p.flags & PF.released) !== 0 && p.owner === 1)).toBe(true);
  });

  test("Frozen Harvest: capturing a shot inside someone else's Time Bubble is a stolen combo", () => {
    const s = setup("magnetar", [[600, 0], [0, 600]]);
    s.w.spawnEffect({ kind: "bubble", owner: 3, source: "timeBubble", x: 100, y: 0, r: POWERS.timeBubble.radius, life: 4 });
    s.cast();
    s.w.spawnProjectile({ owner: 2, x: 130, y: 0, vx: -WEAPONS.pistol.speed, vy: 0, life: 1 });
    s.run(2);
    expect(s.combos().some((c) => c.name === "FROZEN HARVEST" && c.stolen)).toBe(true);
  });
});

describe("Void Cloak", () => {
  test("cloaks, first shot out is a crit, and the reveal is announced", () => {
    const s = setup("voidCloak", [[600, 0]]);
    s.cast();
    expect(s.caster.status.cloaked ?? 0).toBeGreaterThan(0);
    expect(s.fx("voidBurst").filter((e) => e.n === 0).length).toBe(1);
    s.run(10);
    s.run(1, (_i, p) => (p.id === 1 ? { buttons: BTN.shoot } : undefined));
    const shot = s.w.projectiles.find((p) => p.owner === 1)!;
    expect(shot.flags & PF.crit).toBeTruthy();
    expect(s.caster.status.cloaked ?? 0).toBe(0);
    expect(s.fx("voidBurst").some((e) => e.n === 1)).toBe(true);
  });

  test("taking damage breaks the cloak and spends the crit", () => {
    const s = setup("voidCloak", [[600, 0]]);
    s.cast();
    s.w.damage(s.caster, 5, 2, "pistol");
    s.run(1);
    expect(s.caster.status.cloaked ?? 0).toBe(0);
    expect(s.caster.cloakCrit).toBe(false);
  });
});
