// Turning world state into compact integer arrays (and back), plus msgpack framing.
// Positions are quantized to 1/8 unit, angles to uint16, timers to milliseconds.

import { Packr, Unpackr } from "msgpackr";
import { dq8, dqAngle, q8, qAngle } from "../math/vec";
import type { ZoneState } from "../sim/zone";
import type { Effect, EffectKind, HealKind, InputFrame, Loot, LootKind, Player, PowerId, Projectile, ProjKind, SourceId, StatusId, ThrowableId, UltId, WeaponId } from "../sim/types";
import { BTN_MASK, FX_KIND, LOOT_KINDS, POWER_IDS, sourceAt, sourceIndex, STATUS_IDS, THROWABLE_IDS, ULT_IDS, WEAPON_IDS } from "../sim/types";
import type { ClientMsg, InputWire, ServerMsg } from "./protocol";

const packr = new Packr({ useRecords: false, int64AsType: "number" });
const unpackr = new Unpackr({ useRecords: false, int64AsType: "number" });

export function encode(msg: ClientMsg | ServerMsg): Uint8Array {
  return packr.pack(msg);
}

export function decode<T extends ClientMsg | ServerMsg>(data: Uint8Array): T {
  return unpackr.unpack(data) as T;
}

// ---- entity kinds on the wire ------------------------------------------------------------

export const EK = { player: 0, projectile: 1, effect: 2, solid: 3, loot: 4 } as const;

export function statusBits(st: Partial<Record<StatusId, number>>): number {
  let bits = 0;
  STATUS_IDS.forEach((s, i) => {
    if ((st[s] ?? 0) > 0) bits |= 1 << i;
  });
  return bits >>> 0;
}

export function hasStatusBit(bits: number, s: StatusId): boolean {
  return (bits & (1 << STATUS_IDS.indexOf(s))) !== 0;
}

/** Player flags packed in one field. */
export const PFLAG = { alive: 1, connected: 2, ultReady: 4, dashing: 8, bot: 16 } as const;
/** What a player's hands are doing (for animation). */
export const ACT = { reloading: 1, healing: 2, charging: 4, swinging: 8 } as const;

const widx = (id: WeaponId | null | undefined) => (id ? WEAPON_IDS.indexOf(id) : -1);

export function actBits(p: Player): number {
  return (p.reloadT > 0 ? ACT.reloading : 0) | (p.healKind ? ACT.healing : 0) | (p.charge > 0 ? ACT.charging : 0) | (p.swingT > 0 ? ACT.swinging : 0);
}

export function encodePlayer(p: Player): number[] {
  const flags = (p.alive ? PFLAG.alive : 0) | (p.connected ? PFLAG.connected : 0) |
    (p.ult && p.ult.charge >= 100 ? PFLAG.ultReady : 0) | (p.dashT > 0 ? PFLAG.dashing : 0) | (p.bot ? PFLAG.bot : 0);
  const w = p.inv.weapons[p.inv.active];
  return [
    EK.player, q8(p.x), q8(p.y), Math.round(p.vx + p.px), Math.round(p.vy + p.py), qAngle(p.aim), Math.ceil(p.hp), flags, statusBits(p.status), p.warp > 0 ? 1 : 0, p.color,
    widx(w?.id), w?.rarity ?? 0, Math.ceil(p.armor), actBits(p), Math.round(p.charge * 100),
  ];
}

export function encodeProjectile(pr: Projectile): number[] {
  return [EK.projectile, q8(pr.x), q8(pr.y), Math.round(pr.vx), Math.round(pr.vy), pr.owner, pr.kind, pr.flags, pr.bounces, pr.shotId, Math.round(pr.r), sourceIndex(pr.source), widx(pr.weapon), pr.rarity];
}

export function encodeEffect(e: Effect): number[] {
  return [
    EK.effect, q8(e.x), q8(e.y), Math.round(e.vx), Math.round(e.vy), Math.round(e.r), qAngle(e.angle), FX_KIND.indexOf(e.kind), e.owner,
    e.link, Math.round(e.x2), Math.round(e.y2), e.n, Math.round(e.v * 100), Math.round(e.age * 1000), Math.round(e.life * 1000), sourceIndex(e.source),
  ];
}

export function encodeSolid(hp: number, dead: boolean): number[] {
  return [EK.solid, Math.max(0, Math.ceil(hp)), dead ? 1 : 0];
}

export function encodeLoot(l: Loot): number[] {
  return [EK.loot, Math.round(l.x), Math.round(l.y), LOOT_KINDS.indexOf(l.kind), widx(l.weapon), l.rarity, THROWABLE_IDS.indexOf(l.throwable), l.count];
}

// ---- decoded views the client renders ------------------------------------------------------

export interface NetPlayer {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  hp: number;
  flags: number;
  status: number;
  warp: boolean;
  color: number;
  weapon: WeaponId | null;
  rarity: number;
  armor: number;
  act: number;
  charge: number;
}

export interface NetProjectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  kind: ProjKind;
  flags: number;
  bounces: number;
  shotId: number;
  r: number;
  source: SourceId;
  weapon: WeaponId | null;
  rarity: number;
}

export interface NetEffect {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  kind: EffectKind;
  owner: number;
  link: number;
  x2: number;
  y2: number;
  n: number;
  v: number;
  age: number;
  life: number;
  source: SourceId;
}

export interface NetSolid {
  id: number;
  hp: number;
  dead: boolean;
}

export interface NetLoot {
  id: number;
  x: number;
  y: number;
  kind: LootKind;
  weapon: WeaponId;
  rarity: number;
  throwable: ThrowableId;
  count: number;
}

const at = (a: readonly number[], i: number) => a[i] ?? 0;

export function decodePlayer(id: number, a: readonly number[]): NetPlayer {
  return {
    id, x: dq8(at(a, 1)), y: dq8(at(a, 2)), vx: at(a, 3), vy: at(a, 4), aim: dqAngle(at(a, 5)), hp: at(a, 6), flags: at(a, 7), status: at(a, 8), warp: at(a, 9) === 1, color: at(a, 10),
    weapon: WEAPON_IDS[at(a, 11)] ?? null, rarity: at(a, 12), armor: at(a, 13), act: at(a, 14), charge: at(a, 15) / 100,
  };
}

export function decodeProjectile(id: number, a: readonly number[]): NetProjectile {
  return {
    id, x: dq8(at(a, 1)), y: dq8(at(a, 2)), vx: at(a, 3), vy: at(a, 4), owner: at(a, 5), kind: at(a, 6) as ProjKind, flags: at(a, 7), bounces: at(a, 8), shotId: at(a, 9), r: at(a, 10),
    source: sourceAt(at(a, 11)), weapon: WEAPON_IDS[at(a, 12)] ?? null, rarity: at(a, 13),
  };
}

export function decodeEffect(id: number, a: readonly number[]): NetEffect {
  return {
    id, x: dq8(at(a, 1)), y: dq8(at(a, 2)), vx: at(a, 3), vy: at(a, 4), r: at(a, 5), angle: dqAngle(at(a, 6)), kind: FX_KIND[at(a, 7)] ?? "flash",
    owner: at(a, 8), link: at(a, 9), x2: at(a, 10), y2: at(a, 11), n: at(a, 12), v: at(a, 13) / 100, age: at(a, 14) / 1000, life: at(a, 15) / 1000, source: sourceAt(at(a, 16)),
  };
}

export function decodeSolid(id: number, a: readonly number[]): NetSolid {
  return { id, hp: at(a, 1), dead: at(a, 2) === 1 };
}

export function decodeLoot(id: number, a: readonly number[]): NetLoot {
  return {
    id, x: at(a, 1), y: at(a, 2), kind: LOOT_KINDS[at(a, 3)] ?? "ammo", weapon: WEAPON_IDS[at(a, 4)] ?? "pistol", rarity: at(a, 5),
    throwable: THROWABLE_IDS[at(a, 6)] ?? "frag", count: at(a, 7),
  };
}

// ---- global + private state ----------------------------------------------------------------

export const ZONE_PHASES = ["wait", "warn", "shrink", "done"] as const;

export interface NetGlobal {
  zx: number;
  zy: number;
  zr: number;
  tx: number;
  ty: number;
  tr: number;
  stage: number;
  phase: (typeof ZONE_PHASES)[number];
  remaining: number;
  alive: number;
  matchTime: number;
}

export function encodeGlobal(z: ZoneState, alive: number, matchTime: number): number[] {
  return [Math.round(z.x), Math.round(z.y), Math.round(z.r), Math.round(z.toX), Math.round(z.toY), Math.round(z.toR), z.stage, ZONE_PHASES.indexOf(z.phase), Math.round(z.remaining * 10), alive, Math.round(matchTime * 10)];
}

export function decodeGlobal(g: readonly number[]): NetGlobal {
  return {
    zx: at(g, 0), zy: at(g, 1), zr: at(g, 2), tx: at(g, 3), ty: at(g, 4), tr: at(g, 5), stage: at(g, 6),
    phase: ZONE_PHASES[at(g, 7)] ?? "wait", remaining: at(g, 8) / 10, alive: at(g, 9), matchTime: at(g, 10) / 10,
  };
}

export interface NetWeapon {
  id: WeaponId;
  rarity: number;
  mag: number;
  reserve: number;
}

/** Everything the local player needs to predict itself and draw the HUD. */
export interface NetSelf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  dashT: number;
  dashCd: number;
  dashX: number;
  dashY: number;
  fireCd: number;
  reloadT: number;
  bloom: number;
  charge: number;
  swingT: number;
  throwCd: number;
  healKind: HealKind | null;
  healT: number;
  status: number;
  ackSeq: number;
  hp: number;
  armor: number;
  alive: boolean;
  active: number;
  throwable: ThrowableId | null;
  throws: number;
  bandages: number;
  medkits: number;
  weapons: (NetWeapon | null)[];
  slots: ({ id: PowerId; cd: number; recast: number } | null)[];
  ult: { id: UltId; charge: number } | null;
}

const HEALS: (HealKind | null)[] = [null, "bandage", "medkit"];
const SELF_LEN = 44;

export function encodeSelf(p: Player): number[] {
  const inv = p.inv;
  const out = [
    q8(p.x), q8(p.y), Math.round(p.vx * 8), Math.round(p.vy * 8), Math.round(p.px * 8), Math.round(p.py * 8),
    Math.round(p.dashT * 1000), Math.round(p.dashCd * 1000), Math.round(p.dashX * 1000), Math.round(p.dashY * 1000),
    Math.round(p.fireCd * 1000), Math.round(p.reloadT * 1000), Math.round(p.bloom * 100), Math.round(p.charge * 1000), Math.round(p.swingT * 1000),
    Math.round(p.throwCd * 1000), HEALS.indexOf(p.healKind), Math.round(p.healT * 1000),
    statusBits(p.status), p.ackSeq, Math.ceil(p.hp), Math.ceil(p.armor), p.alive ? 1 : 0,
    inv.active, inv.throwable ? THROWABLE_IDS.indexOf(inv.throwable) : -1, inv.throws, inv.bandages, inv.medkits,
  ];
  for (let i = 0; i < 2; i++) {
    const w = inv.weapons[i];
    out.push(widx(w?.id), w?.rarity ?? 0, w?.mag ?? 0, w?.reserve ?? 0);
  }
  for (let i = 0; i < 2; i++) {
    const s = p.slots[i];
    out.push(s ? POWER_IDS.indexOf(s.id) : -1, s ? Math.round(s.cd * 100) : 0, s ? Math.round(s.recast * 100) : 0);
  }
  out.push(p.ult ? ULT_IDS.indexOf(p.ult.id) : -1, p.ult ? Math.round(p.ult.charge * 10) : 0);
  return out;
}

export function decodeSelf(a: readonly number[]): NetSelf | null {
  if (a.length < SELF_LEN) return null;
  const weapons: (NetWeapon | null)[] = [];
  for (let i = 0; i < 2; i++) {
    const id = WEAPON_IDS[at(a, 28 + i * 4)];
    weapons.push(id ? { id, rarity: at(a, 29 + i * 4), mag: at(a, 30 + i * 4), reserve: at(a, 31 + i * 4) } : null);
  }
  const slots: NetSelf["slots"] = [];
  for (let i = 0; i < 2; i++) {
    const id = POWER_IDS[at(a, 36 + i * 3)];
    slots.push(id ? { id, cd: at(a, 37 + i * 3) / 100, recast: at(a, 38 + i * 3) / 100 } : null);
  }
  const ultId = ULT_IDS[at(a, 42)];
  return {
    x: dq8(at(a, 0)), y: dq8(at(a, 1)), vx: at(a, 2) / 8, vy: at(a, 3) / 8, px: at(a, 4) / 8, py: at(a, 5) / 8,
    dashT: at(a, 6) / 1000, dashCd: at(a, 7) / 1000, dashX: at(a, 8) / 1000, dashY: at(a, 9) / 1000,
    fireCd: at(a, 10) / 1000, reloadT: at(a, 11) / 1000, bloom: at(a, 12) / 100, charge: at(a, 13) / 1000, swingT: at(a, 14) / 1000,
    throwCd: at(a, 15) / 1000, healKind: HEALS[at(a, 16)] ?? null, healT: at(a, 17) / 1000,
    status: at(a, 18), ackSeq: at(a, 19), hp: at(a, 20), armor: at(a, 21), alive: at(a, 22) === 1,
    active: at(a, 23), throwable: THROWABLE_IDS[at(a, 24)] ?? null, throws: at(a, 25), bandages: at(a, 26), medkits: at(a, 27),
    weapons, slots, ult: ultId ? { id: ultId, charge: at(a, 43) / 10 } : null,
  };
}

// ---- inputs ------------------------------------------------------------------------------

export function inputToWire(f: InputFrame): InputWire {
  return [f.seq, Math.round(f.mx * 127), Math.round(f.my * 127), qAngle(f.aim), f.buttons, f.pressed, Math.round(f.dt * 1000), f.shotId];
}

export function inputFromWire(w: readonly number[]): InputFrame | null {
  if (w.length !== 8 || !w.every((v) => Number.isFinite(v))) return null;
  const [seq, mx, my, aim, buttons, pressed, dtMs, shotId] = w as InputWire;
  return {
    seq: seq >>> 0, mx: Math.max(-1, Math.min(1, mx / 127)), my: Math.max(-1, Math.min(1, my / 127)), aim: dqAngle(aim & 0xffff),
    buttons: buttons & BTN_MASK, pressed: pressed & BTN_MASK, dt: Math.max(0, Math.min(0.1, dtMs / 1000)), shotId: shotId >>> 0,
  };
}
