// drawHero: composes one chibi hero for the frame from cached sprites (rim, torso, head),
// live hands / feet / weapon, and the animation layers (walk, recoil, reload, heal, throw,
// slash, dash, hit, death, cloak, drop-in). See types.ts for the input fields.

import { HEROES } from "@prism/shared";
import { drawGlow } from "../glow";
import { drawBandageStrip, drawDeath, drawDropStreak, drawDust, drawHealFx, drawHeld, drawLandRing, drawMuzzleFlash, drawShadow, drawSlashArc } from "./effects";
import { paintBlink } from "./head";
import { bucketView, BODY_Y, HEAD_Y, blit, bodySprite, facing, footSprite, handSprite, headSprite, rimSprite } from "./sprites";
import { PIVOT, computePose, type Pose } from "./pose";
import { clamp01 } from "./paint";
import { playing, type ChibiDrawState } from "./types";
import { blitWeapon, rarityHex } from "./weapons";

const RUN_SPEED = 330;
const FLASH_SIZE = { pistol: 0.8, smg: 0.8, rifle: 1, shotgun: 1.5, sniper: 1.4, rocket: 1.6, lance: 1, blade: 1 } as const;

function drawWeaponLayer(ctx: CanvasRenderingContext2D, s: ChibiDrawState, pose: Pose, hands: boolean, weapon: boolean) {
  const handS = handSprite(s.heroId, s.color);
  const w = pose.weapon;
  // The support hand goes under the gun when it sits on the far side of the barrel.
  if (hands && pose.off && w) blit(ctx, handS, pose.off[0], pose.off[1]);
  if (weapon && w) {
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.a);
    if (w.flip) ctx.scale(1, -1);
    blitWeapon(ctx, w.id, w.rarity, s.time, s.anim.charge ?? 0);
    ctx.restore();
  }
  if (hands) {
    if (pose.off && !w) blit(ctx, handS, pose.off[0], pose.off[1]);
    if (pose.main) blit(ctx, handS, pose.main[0], pose.main[1]);
  }
}

/** Draws one chibi hero. Cheap enough for 12 heroes plus effects every frame. */
export function drawHero(ctx: CanvasRenderingContext2D, s: ChibiDrawState) {
  const A = s.anim;
  if (A.deathT >= 1) return;
  const def = HEROES[s.heroId] ?? HEROES.blaze;
  const seed = s.seed ?? 0;
  const t = s.time;
  const { b, mirror } = facing(s.aim);

  ctx.save();
  ctx.translate(s.x, s.y);
  if (s.scale !== 1) ctx.scale(s.scale, s.scale);

  if (playing(A.deathT) && A.deathT >= 0.1) {
    drawDeath(ctx, s.heroId, s.color, b, mirror, A.deathT, seed);
    ctx.restore();
    return;
  }

  const cloak = clamp01(A.cloak);
  if (cloak > 0) ctx.globalAlpha *= (1 - cloak * 0.86) * (1 - cloak * 0.12 * (0.5 + 0.5 * Math.sin(t * 11 + seed)));

  // Drop-in: fall from above, then squash and ring on landing.
  let dropY = 0;
  let squash = 0;
  let shadowK = 1;
  let land = -1;
  if (playing(A.spawnT)) {
    const u = A.spawnT;
    if (u < 0.62) {
      const f = u / 0.62;
      dropY = -170 * (1 - f * f);
      shadowK = 0.35 + 0.65 * f;
    } else {
      land = (u - 0.62) / 0.38;
      squash = Math.sin(land * Math.PI) * (1 - land) * 0.42;
    }
  }
  const pop = playing(A.deathT) ? 1 + A.deathT * 3 : 1;

  const dashing = playing(A.dashT);
  const amp = dashing ? 0 : clamp01(A.speed / RUN_SPEED);
  const ph = A.walkPhase;
  const bob = -amp * 1.9 * Math.abs(Math.sin(ph));
  const breath = Math.sin(t * 2.5 + seed) * (1 - amp);
  const sway = amp * 0.075 * Math.sin(ph) + Math.cos(s.aim) * 0.05;
  const leanK = 0.5 + amp;
  const lx = Math.cos(s.aim) * 1.3 * leanK;
  const ly = Math.sin(s.aim) * 0.7 * leanK;

  // Hit: squash and a little shake.
  let hitK = 0;
  let shake = 0;
  if (playing(A.hitT)) {
    hitK = (1 - A.hitT) ** 2;
    squash += hitK * 0.2;
    shake = Math.sin(A.hitT * 42) * 1.6 * hitK;
  }
  if (playing(A.deathT)) hitK = 1;

  drawShadow(ctx, s.color, shadowK, s.floorGlow !== false);
  if (land >= 0) drawLandRing(ctx, land, s.color);

  const pose = computePose(s.aim, s.weapon, A, t, seed);

  // Dash afterimages trail behind in the player color.
  const da = A.dashAngle ?? s.aim;
  if (dashing) {
    const u = A.dashT;
    const rim = rimSprite(s.heroId, s.color, b);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 3; i >= 1; i--) {
      const d = i * 9 * (0.4 + u * 0.6);
      ctx.globalAlpha = (0.42 - i * 0.1) * (1 - u) * (1 - cloak * 0.86);
      ctx.save();
      ctx.translate(-Math.cos(da) * d, -Math.sin(da) * d);
      if (mirror) ctx.scale(-1, 1);
      blit(ctx, rim, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.translate(lx + pose.shove[0] + shake, ly + pose.shove[1] + dropY);
  if (pop !== 1) ctx.scale(pop, pop);
  if (squash !== 0) {
    ctx.translate(0, 20);
    ctx.scale(1 + squash, 1 - squash * 0.8);
    ctx.translate(0, -20);
  }
  if (dashing) {
    const st = Math.sin(A.dashT * Math.PI) * 0.22;
    ctx.rotate(da);
    ctx.scale(1 + st, 1 - st * 0.55);
    ctx.rotate(-da);
  }
  if (land < 0 && dropY < 0) drawDropStreak(ctx, -10, 90, s.color, 1);

  // Feet step on the ground (no bob).
  const mx = Math.cos(s.aim) * 0.8;
  const my = Math.sin(s.aim) * 0.45;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const p = ph + (i ? Math.PI : 0);
    const step = Math.cos(p) * 3.4 * amp;
    const lift = Math.max(0, Math.sin(p)) * 2.6 * amp;
    const fx = side * 5.3 + mx * step;
    const fy = 18.6 + my * step - lift;
    if (amp > 0.35) {
      const age = (((p - Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
      if (age < 0.35) drawDust(ctx, fx - mx * 4, 20.5, age / 0.35);
    }
    blit(ctx, footSprite(s.heroId, s.color, lift > 1), fx, fy);
  }

  ctx.translate(0, bob);
  ctx.rotate(sway);
  if (pose.weaponBehind || pose.handsBehind) drawWeaponLayer(ctx, s, pose, pose.handsBehind, pose.weaponBehind);

  const headBob = breath * 0.55 + amp * Math.sin(ph * 2 + 0.9) * 0.6;
  ctx.save();
  if (mirror) ctx.scale(-1, 1);
  blit(ctx, rimSprite(s.heroId, s.color, b), 0, 0);
  ctx.save();
  ctx.translate(0, BODY_Y + 7);
  ctx.scale(1, 1 + breath * 0.025);
  blit(ctx, bodySprite(s.heroId, b), 0, -7);
  ctx.restore();
  blit(ctx, headSprite(s.heroId, b), 0, HEAD_Y + headBob);
  const blink = (t + seed * 1.37) % 3.9 < 0.13;
  if (blink) {
    ctx.save();
    ctx.translate(0, HEAD_Y + headBob);
    paintBlink(ctx, def, bucketView(b));
    ctx.restore();
  }
  if (hitK > 0.02) {
    ctx.globalAlpha *= Math.min(1, hitK * 1.2);
    blit(ctx, rimSprite(s.heroId, "#ffffff", b), 0, 0);
  }
  ctx.restore();

  if (!pose.weaponBehind || !pose.handsBehind) drawWeaponLayer(ctx, s, pose, !pose.handsBehind, !pose.weaponBehind);

  const rarity = s.weapon?.rarity ?? 0;
  for (const h of pose.held) {
    if (h.kind === "bandage" && pose.main) drawBandageStrip(ctx, [h.x, h.y], pose.main);
    drawHeld(ctx, h, s.color, rarity);
  }
  if (pose.slash) drawSlashArc(ctx, PIVOT[0], PIVOT[1], pose.slash.a0, pose.slash.a1, pose.slash.r0, pose.slash.r1, s.color, pose.slash.k);
  if (pose.muzzle && s.muzzleFlash !== false && s.weapon) {
    drawMuzzleFlash(ctx, pose.muzzle.x, pose.muzzle.y, pose.muzzle.a, pose.muzzle.k, FLASH_SIZE[s.weapon.id], rarity > 0 ? rarityHex(rarity) : "#ffd34d");
  }
  ctx.restore();

  if (playing(A.healT)) drawHealFx(ctx, A.healT, t, seed);
  if (cloak > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = cloak * 0.22 * (0.6 + 0.4 * Math.sin(t * 7 + seed));
    ctx.translate(lx + Math.sin(t * 13) * 1.2, ly + bob);
    if (mirror) ctx.scale(-1, 1);
    blit(ctx, rimSprite(s.heroId, s.color, b), 0, 0);
    ctx.restore();
  }
  if (playing(A.deathT)) drawGlow(ctx, 0, -2, 50, "#ffffff", A.deathT * 8);
  ctx.restore();
}
