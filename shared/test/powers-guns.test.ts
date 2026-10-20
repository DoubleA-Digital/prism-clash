// Powers that touch "your shots" work with every gun's projectiles through the one generic
// firing path (and with the Prism Lance beam and Energy Blade where it makes sense), plus the
// Echo Storm buff rule and mid-match Prism Shard equips.
import { describe, expect, test } from "vitest";
import {
  BTN, equipPower, GUN, PF, PLAYER, POWERS, PROJ, ULTIMATES, weaponDamage, WEAPONS,
} from "@prism/shared";
import { kit, ticks } from "./powerkit";

describe("Ricochet Prism with any gun", () => {
  test("shotgun pellets ricochet off a wall", () => {
    const k = kit({ powers: ["ricochetPrism"] });
    k.wall("wall", 150, -300, 174, 300);
    k.give(k.caster, "shotgun");
    k.cast();
    k.act({ buttons: BTN.shoot, aim: 0 });
    const pellets = k.w.projectiles.filter((p) => p.owner === 1 && p.weapon === "shotgun");
    expect(pellets).toHaveLength(WEAPONS.shotgun.pellets);
    expect(pellets.every((p) => p.maxBounces === POWERS.ricochetPrism.maxBounces)).toBe(true);
    k.run(4);
    const bounced = pellets.filter((p) => p.bounces >= 1);
    expect(bounced.length).toBeGreaterThanOrEqual(4);
    expect(bounced.every((p) => p.dead || p.vx < 0)).toBe(true);
  });

  test("a rocket bounces before it blows", () => {
    const k = kit({ powers: ["ricochetPrism"] });
    k.wall("wall", 220, -300, 244, 300);
    k.give(k.caster, "rocket");
    k.caster.status.invulnerable = 99;
    k.cast();
    k.act({ buttons: BTN.shoot, aim: 0 });
    k.run(ticks(2));
    const firstBounce = k.events.findIndex((e) => e.t === "bounce");
    const firstBlast = k.events.findIndex((e) => e.t === "explode" && e.source === "rocket");
    expect(firstBounce).toBeGreaterThanOrEqual(0);
    expect(firstBlast).toBeGreaterThan(firstBounce);
  });

  test("the Prism Lance beam gets extra reflections that hit harder", () => {
    const segments = (ricochet: boolean) => {
      const k = kit({ powers: ["ricochetPrism"], enemies: [[0, 700]] });
      k.wall("wall", 300, -400, 324, 400);
      k.wall("wall", -324, -400, -300, 400);
      k.give(k.caster, "lance");
      if (ricochet) k.cast();
      k.run(ticks(WEAPONS.lance.chargeTime) + 2, (_i, p) => (p === k.caster ? { buttons: BTN.shoot, aim: 0 } : undefined));
      k.act({ aim: 0 });
      return k.fx("beam").filter((b) => b.owner === 1).length;
    };
    expect(segments(false)).toBe(WEAPONS.lance.bounces + 1);
    expect(segments(true)).toBe(WEAPONS.lance.bounces + POWERS.ricochetPrism.lanceBounces + 1);
  });
});

describe("Magnetar with any gun", () => {
  test("catches every shotgun pellet and a rocket, then flings them as yours", () => {
    const k = kit({ powers: ["magnetar"], enemies: [[260, 0]] });
    const shooter = k.enemies[0]!;
    k.give(shooter, "shotgun");
    k.cast();
    k.run(1, (_i, p) => (p === shooter ? { buttons: BTN.shoot, aim: Math.PI } : undefined));
    const rocket = k.w.spawnProjectile({ owner: shooter.id, kind: PROJ.rocket, x: 200, y: 40, vx: -WEAPONS.rocket.speed, vy: 0, life: 1, damage: 70, weapon: "rocket", source: "rocket", r: 12 });
    k.run(8);
    const held = k.w.projectiles.filter((p) => (p.flags & PF.captured) !== 0);
    expect(held.filter((p) => p.weapon === "shotgun").length).toBeGreaterThanOrEqual(WEAPONS.shotgun.pellets - 1);
    expect(held).toContain(rocket);
    expect(k.caster.hp).toBe(PLAYER.maxHp);
    k.act({ pressed: BTN.p1 });
    for (const pr of held) {
      expect(pr.owner).toBe(1);
      expect(pr.life0).toBe(POWERS.magnetar.releaseLife);
    }
    k.run(ticks(POWERS.magnetar.releaseLife) + 2);
    expect(k.events.some((e) => e.t === "explode" && e.source === "rocket" && e.by === 1)).toBe(true);
  });

  test("doesn't reach through a wall", () => {
    const k = kit({ powers: ["magnetar"], enemies: [[600, 0]] });
    k.wall("wall", 90, -200, 114, 200);
    k.cast();
    const pr = k.w.spawnProjectile({ owner: 2, x: 135, y: 0, vx: 400, vy: 0, life: 1, weapon: "smg", source: "smg" });
    k.run(2);
    expect(pr.flags & PF.captured).toBe(0);
  });
});

describe("Overdrive with any gun", () => {
  test("SMG fires faster for free and the Prism Lance charges faster", () => {
    const k = kit({ ult: "overdrive" });
    k.give(k.caster, "smg");
    k.ult();
    const mag = k.caster.inv.weapons[1]!.mag;
    k.run(30, (_i, p) => (p === k.caster ? { buttons: BTN.shoot } : undefined));
    expect(k.caster.inv.weapons[1]!.mag).toBe(mag);
    expect(k.events.filter((e) => e.t === "shoot" && e.by === 1).length).toBeGreaterThan(Math.floor(1 / WEAPONS.smg.fireCd));

    const l = kit({ ult: "overdrive" });
    l.give(l.caster, "lance");
    l.ult();
    l.run(9, (_i, p) => (p === l.caster ? { buttons: BTN.shoot } : undefined));
    expect(l.caster.charge).toBeCloseTo(Math.min(1, (9 / 30) * ULTIMATES.overdrive.fireRateMult / WEAPONS.lance.chargeTime), 2);
  });
});

describe("Void Cloak with any weapon", () => {
  test("the first lance beam out of cloak crits", () => {
    const k = kit({ powers: ["voidCloak"], enemies: [[400, 0]] });
    k.give(k.caster, "lance");
    k.cast();
    k.run(10, (_i, p) => (p === k.caster ? { buttons: BTN.shoot, aim: 0 } : undefined));
    const charge = k.caster.charge;
    k.act({ aim: 0 });
    const hit = k.events.find((e) => e.t === "hit" && e.target === 2);
    expect(hit).toMatchObject({ crit: true, source: "lance" });
    const L = WEAPONS.lance;
    expect(PLAYER.maxHp - k.enemies[0]!.hp).toBeCloseTo(weaponDamage({ id: "lance", rarity: 0 }) * (L.minCharge + (1 - L.minCharge) * charge) * GUN.critMult, 0);
    expect(k.caster.status.cloaked ?? 0).toBe(0);
  });

  test("the first blade swing out of cloak crits", () => {
    const k = kit({ powers: ["voidCloak"], enemies: [[80, 0]] });
    k.give(k.caster, "blade");
    k.cast();
    k.act({ buttons: BTN.shoot, aim: 0 });
    expect(PLAYER.maxHp - k.enemies[0]!.hp).toBeCloseTo(weaponDamage({ id: "blade", rarity: 0 }) * GUN.critMult, 0);
  });
});

describe("Phantom Mark with any weapon", () => {
  test("a Prism Lance hit charges the sigil", () => {
    const k = kit({ powers: ["phantomMark"], enemies: [[160, 0]] });
    k.give(k.caster, "lance");
    k.cast(0, 0);
    k.run(8);
    const sigil = k.fx("sigil")[0]!;
    expect(sigil.n).toBe(0);
    k.run(6, (_i, p) => (p === k.caster ? { buttons: BTN.shoot, aim: Math.PI } : undefined));
    k.act({ aim: Math.PI });
    expect(sigil.n).toBe(1);
  });
});

describe("Mirror Self copies the gun in hand", () => {
  test("shotgun pellets, a rocket, a lance beam and a blade swing, at reduced damage", () => {
    const fire = (gun: "shotgun" | "rocket" | "lance" | "blade") => {
      const k = kit({ powers: ["mirrorSelf"], enemies: [[0, 900]] });
      k.give(k.caster, gun);
      k.cast(0, 0);
      if (gun === "lance") {
        k.run(10, (_i, p) => (p === k.caster ? { buttons: BTN.shoot, aim: 0 } : undefined));
        k.act({ aim: 0 });
      } else k.act({ buttons: BTN.shoot, aim: 0 });
      return k;
    };
    const s = fire("shotgun");
    const pellets = s.w.projectiles.filter((p) => p.source === "mirrorSelf");
    expect(pellets).toHaveLength(WEAPONS.shotgun.pellets);
    expect(pellets[0]!.damage).toBeCloseTo(weaponDamage({ id: "shotgun", rarity: 0 }) * POWERS.mirrorSelf.damageMult);
    expect(pellets[0]!.weapon).toBe("shotgun");
    const r = fire("rocket");
    expect(r.w.projectiles.filter((p) => p.source === "mirrorSelf" && p.kind === PROJ.rocket)).toHaveLength(1);
    const l = fire("lance");
    expect(l.fx("beam").some((b) => b.source === "mirrorSelf")).toBe(true);
    const b = fire("blade");
    expect(b.fx("slash").some((e) => e.source === "mirrorSelf")).toBe(true);
  });
});

describe("Echo Storm and buffs", () => {
  test("an echoed Ricochet Prism stretches the buff instead of refreshing it", () => {
    const k = kit({ ult: "echoStorm", powers: ["ricochetPrism"] });
    k.ult();
    k.cast();
    k.run(ticks(ULTIMATES.echoStorm.echoDelay) + 2);
    const C = POWERS.ricochetPrism;
    expect(k.caster.status.ricochet ?? 0).toBeGreaterThan(C.duration);
    expect(k.caster.status.ricochet ?? 0).toBeLessThanOrEqual(C.duration * (1 + ULTIMATES.echoStorm.buffExtend));
    expect(k.fx("prismAura")).toHaveLength(1);
  });
});

describe("Prism Shard equips", () => {
  test("fills an empty slot ready to cast", () => {
    const k = kit({ powers: ["singularity"] });
    const slot = equipPower(k.w, k.caster, 1, "magnetar");
    expect(k.caster.slots[1]).toBe(slot);
    expect(slot).toMatchObject({ id: "magnetar", cd: 0, recast: 0 });
    k.cast(1);
    expect(k.fx("magnet")).toHaveLength(1);
  });

  test("replacing a power winds it down: an open portal fizzles, a waiting cloak crit is dropped", () => {
    const k = kit({ powers: ["portalPair", "voidCloak"] });
    k.cast(0);
    expect(k.fx("portal")).toHaveLength(1);
    equipPower(k.w, k.caster, 0, "hexSwap");
    k.run(1);
    expect(k.fx("portal")).toHaveLength(0);
    expect(k.caster.slots[0]?.id).toBe("hexSwap");
    k.cast(1);
    k.run(ticks(POWERS.voidCloak.duration) + 1);
    expect(k.caster.cloakCrit).toBe(true);
    equipPower(k.w, k.caster, 1, "magnetar");
    expect(k.caster.cloakCrit).toBe(false);
  });
});
