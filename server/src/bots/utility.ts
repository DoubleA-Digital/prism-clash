// Utility scoring: every think, each high-level state gets a score from the bot's situation
// and personality, and the best one wins (the current state gets a small bonus so bots don't
// flip-flop). Pure functions, so the decisions are easy to test.

import { BOTS, PLAYER, ZONE, type World } from "@prism/shared";
import type { Profile } from "./personality";

export const BOT_STATES = ["fight", "flee", "heal", "loot", "crate", "rotate", "supply", "investigate", "ambush", "roam"] as const;
export type BotState = (typeof BOT_STATES)[number];

export interface TargetInfo {
  visible: boolean;
  dist: number;
  /** Duel win chance 0..1. */
  win: number;
  sinceSeen: number;
  /** They shot us lately, or they're already inside our gun's range. */
  engaged: boolean;
}

export interface Situation {
  hp: number;
  armor: number;
  canHeal: boolean;
  /** Seconds since anything threatening was seen, heard nearby or felt. */
  quiet: number;
  /** Quiet time the heal we'd use needs. */
  quietNeeded: number;
  target: TargetInfo | null;
  hitRecently: boolean;
  lootValue: number;
  lootDist: number;
  crateDist: number;
  /** 0 (spawn pistol) .. 1 (well armed). */
  armed: number;
  zoneOutside: boolean;
  zonePressure: number;
  supplyDist: number;
  noiseDist: number;
  noiseAge: number;
  ambushSpot: boolean;
  ambushReady: boolean;
  lateGame: boolean;
  /** The opening looting phase (BOTS.lootPhaseSeconds). */
  early: boolean;
  current: BotState;
}

export function scoreStates(s: Situation, p: Profile): Record<BotState, number> {
  const C = BOTS.combat;
  const U = BOTS.utility;
  const eff = s.hp + s.armor;
  const t = s.target;
  const sc: Record<BotState, number> = { fight: 0, flee: 0, heal: 0, loot: 0, crate: 0, rotate: 0, supply: 0, investigate: 0, ambush: 0, roam: U.roam };

  sc.rotate = s.zoneOutside ? U.outsideZone : s.zonePressure;

  if (t) {
    const F = U.fight;
    const agg = Math.pow(p.aggression, F.aggressionPow);
    // Someone far off who hasn't noticed us: worth it only when we're armed and favored
    // (early on, poorly armed bots keep looting instead of starting long-range duels).
    const appetite = t.engaged ? 1 : (F.unengagedBase + (1 - F.unengagedBase) * s.armed) * (s.early ? BOTS.earlyAppetite : 1) * (t.win < 0.5 ? F.unfavored : 1);
    if (t.visible) sc.fight = ((F.base + F.win * t.win) * agg + (t.dist < F.closeRange ? F.closeBonus : 0)) * appetite;
    else if (t.sinceSeen < C.pursueSeconds) sc.fight = (F.chaseBase + F.chaseWin * t.win) * agg;
    if (t.win < C.fleeBelow) sc.fight *= F.losing;
    if ((t.visible || s.hitRecently) && t.win < C.fleeBelow + 0.1) {
      sc.flee = (1 - t.win) * (eff < U.flee.lowHealth ? U.flee.hurt : U.flee.healthy) * Math.max(0.4, 2 - p.aggression) * U.flee.scale;
    }
  } else if (s.hitRecently && eff < U.flee.lowHealth - 10) sc.flee = U.flee.unseen;

  if (s.canHeal && s.hp < p.healBelow) {
    const H = U.heal;
    sc.heal = (H.base + (1 - s.hp / PLAYER.maxHp) * H.missing) * (s.quiet >= s.quietNeeded ? 1 : H.noisy);
    if (t?.visible && t.dist < H.threatRange) sc.heal *= H.threatened;
  }

  const L = U.loot;
  if (s.lootValue > 0) sc.loot = Math.min(L.cap, (s.lootValue / L.valueScale) * p.loot) / (1 + s.lootDist / L.falloff) + (s.armed < 0.3 ? L.unarmedBonus : 0);
  if (Number.isFinite(s.crateDist)) sc.crate = (U.crate.unarmed * (1 - s.armed) + U.crate.base) * p.loot * (1 - s.crateDist / (BOTS.crateRange * 1.5));

  const S = BOTS.supply;
  if (s.supplyDist < S.range && eff >= S.minHealth) sc.supply = U.supply.base * p.supply * (1 - s.supplyDist / (S.range * 1.4)) + s.armed * U.supply.armed;

  const I = BOTS.investigate;
  if (!s.early && s.noiseAge < I.memory && s.noiseDist < I.range && eff > I.minHealth) sc.investigate = U.investigate * p.thirdParty * p.aggression * (0.5 + s.armed * 0.6);

  if (s.ambushSpot && s.ambushReady && s.hp >= PLAYER.maxHp * 0.5) sc.ambush = U.ambush * p.ambush * (s.lateGame ? U.ambushLate : 1);

  sc[s.current] += BOTS.stickiness;
  return sc;
}

export function chooseState(s: Situation, p: Profile): BotState {
  const sc = scoreStates(s, p);
  let best: BotState = "roam";
  let bs = -Infinity;
  for (const k of BOT_STATES) {
    if (sc[k] > bs) {
      bs = sc[k];
      best = k;
    }
  }
  return best;
}

export interface ZoneInfo {
  /** Outside (or about to be outside) the current circle. */
  outside: boolean;
  /** 0 = no hurry … ~1.2 = leave now. */
  pressure: number;
  /** Where to head to be safe. */
  goalX: number;
  goalY: number;
  /** Is a point inside the circle that matters next? */
  safe: (x: number, y: number) => boolean;
}

/**
 * Zone rotation: compares how long the walk to a comfortable spot inside the next circle
 * takes (padded) against the time left before it closes, scaled by how early this bot likes
 * to leave.
 */
export function zoneInfo(w: World, x: number, y: number, rotateEarly: number): ZoneInfo {
  const z = w.zone;
  const Z = BOTS.zone;
  const known = z.phase === "warn" || z.phase === "shrink";
  const tx = known ? z.toX : z.x;
  const ty = known ? z.toY : z.y;
  const tr = known ? z.toR : z.r;
  const safe = (px: number, py: number) => Math.hypot(px - tx, py - ty) < tr - Z.edgeMargin * 0.5;
  if (z.stage < 0) return { outside: false, pressure: 0, goalX: x, goalY: y, safe };
  const dCur = Math.hypot(x - z.x, y - z.y);
  const outside = dCur > z.r - Z.edgeMargin;
  const dNext = Math.hypot(x - tx, y - ty);
  const inset = tr * Z.inset;
  const goalX = dNext > inset ? tx + ((x - tx) / dNext) * inset : x;
  const goalY = dNext > inset ? ty + ((y - ty) / dNext) * inset : y;
  if (!known || dNext < tr * 0.8) return { outside, pressure: 0, goalX, goalY, safe };
  const travel = Math.hypot(goalX - x, goalY - y);
  const eta = (travel * Z.etaSlack) / PLAYER.speed;
  const shrink = ZONE.stages[z.stage]?.shrink ?? 0;
  const avail = z.phase === "warn" ? z.remaining + shrink * 0.6 : z.remaining * 0.6;
  const ratio = (eta * rotateEarly) / Math.max(1, avail);
  const pressure = ratio < 0.4 ? 0 : Math.min(1.2, (ratio - 0.4) * 1.5);
  return { outside, pressure, goalX, goalY, safe };
}
