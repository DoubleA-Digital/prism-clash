// Core game types shared by server (authoritative) and client (prediction + rendering).

import { THROWABLE_IDS, WEAPON_IDS, type ThrowableKey, type WeaponKey } from "../config";

export const POWER_IDS = [
  "chronoRewind", "singularity", "mirrorSelf", "portalPair", "stormTether", "timeBubble",
  "ricochetPrism", "phantomMark", "hexSwap", "magnetar", "voidCloak", "moltenPath",
  "boomerangGlaive", "gravityFlip", "bountyBeacon", "decoySwarm", "shockwaveSlam", "thirdParty",
] as const;
export type PowerId = (typeof POWER_IDS)[number];

export const ULT_IDS = ["meteorRain", "overdrive", "riftCollapse", "echoStorm", "finalStand", "huntersEye"] as const;
export type UltId = (typeof ULT_IDS)[number];

export { THROWABLE_IDS, WEAPON_IDS };
export type WeaponId = WeaponKey;
export type ThrowableId = ThrowableKey;

/** What dealt damage, for the kill feed icon. Guns use their weapon id. */
export type SourceId = PowerId | UltId | WeaponId | ThrowableId | "zone" | "wall" | "haunt" | "combo" | "barrel";
export const SOURCE_IDS: readonly SourceId[] = [...POWER_IDS, ...ULT_IDS, ...WEAPON_IDS, ...THROWABLE_IDS, "zone", "wall", "haunt", "combo", "barrel"];
export const sourceIndex = (s: SourceId) => SOURCE_IDS.indexOf(s);
export const sourceAt = (i: number): SourceId => SOURCE_IDS[i] ?? "pistol";
export const isWeaponId = (s: string): s is WeaponId => (WEAPON_IDS as readonly string[]).includes(s);
export const isThrowableId = (s: string): s is ThrowableId => (THROWABLE_IDS as readonly string[]).includes(s);

/** Timed status effects on a player. Values are seconds remaining. */
export const STATUS_IDS = [
  "slowed", "inverted", "tethered", "airborne", "cloaked", "bountied", "invulnerable", "marked",
  "ricochet", "molten", "thirdParty", "overdrive", "echo", "hunter", "finalStand", "blinded", "dashing", "timeBubble", "shocked",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];
export type Statuses = Partial<Record<StatusId, number>>;

export const BTN = {
  shoot: 1,
  dash: 2,
  p1: 4,
  p2: 8,
  ult: 16,
  reload: 32,
  interact: 64,
  /** Toggle between the two weapon slots (mouse wheel). */
  swap: 128,
  slot1: 256,
  slot2: 512,
  throw: 1024,
  heal: 2048,
  scope: 4096,
} as const;
export const BTN_MASK = 8191;

export interface InputFrame {
  seq: number;
  /** Movement, each axis -1..1 (clamped to length 1 by the server). */
  mx: number;
  my: number;
  aim: number;
  /** Buttons held this frame. */
  buttons: number;
  /** Buttons newly pressed since the last frame (edges), so a tap is never lost. */
  pressed: number;
  /** Seconds this frame covers on the client (for prediction replay). */
  dt: number;
  /** Id for the predicted shot fired this frame (0 = none). Shotgun pellets share it. */
  shotId: number;
}

export interface PowerSlot {
  id: PowerId;
  /** Seconds until ready. */
  cd: number;
  /** Power-specific live state lives in effects; this flags "recast available". */
  recast: number;
}

export interface UltSlot {
  id: UltId;
  charge: number;
}

export interface WeaponItem {
  id: WeaponId;
  /** 0 common, 1 rare, 2 epic, 3 legendary. */
  rarity: number;
  mag: number;
  reserve: number;
}

export type HealKind = "bandage" | "medkit";

export interface Inventory {
  weapons: (WeaponItem | null)[];
  /** Index of the weapon in hand (0 or 1). */
  active: number;
  throwable: ThrowableId | null;
  throws: number;
  bandages: number;
  medkits: number;
}

export interface Player {
  id: number;
  kind: "player";
  name: string;
  color: number;
  bot: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** External push (knockback, pulls), decays separately so movement stays responsive. */
  px: number;
  py: number;
  r: number;
  aim: number;
  hp: number;
  /** Shield Cell armor: absorbs damage before HP. */
  armor: number;
  alive: boolean;
  connected: boolean;
  dashT: number;
  dashCd: number;
  dashX: number;
  dashY: number;
  inv: Inventory;
  fireCd: number;
  /** Seconds left on the current reload (0 = not reloading). */
  reloadT: number;
  /** Current spread bloom in degrees. */
  bloom: number;
  /** Prism Lance charge 0..1 while the trigger is held. */
  charge: number;
  /** Energy Blade swing time left (deflects bullets meanwhile). */
  swingT: number;
  throwCd: number;
  /** Healing channel: what is being used and how long is left. */
  healKind: HealKind | null;
  healT: number;
  sinceDamage: number;
  sinceShot: number;
  slots: (PowerSlot | null)[];
  ult: UltSlot | null;
  status: Statuses;
  lastHitBy: number;
  lastHitSource: SourceId;
  lastHitTick: number;
  /** Ticks since a displacement the client must not smooth (teleport, swap, rewind). */
  warp: number;
  /** Seq of the last input the server applied. */
  ackSeq: number;
  /** Damage absorbed during Final Stand. */
  absorbed: number;
  /** First shot out of cloak is a guaranteed crit. */
  cloakCrit: boolean;
  /** When someone else last damaged this player (for Third-Party). */
  damagedAt: number;
  damagedBy: number;
}

export const PROJ = {
  /** Any gun bullet (pistol, SMG, rifle, shotgun pellet, sniper). */
  basic: 0,
  clone: 1,
  tether: 2,
  gravity: 3,
  singularityOrb: 4,
  meteor: 5,
  grenade: 6,
  rocket: 7,
} as const;
export type ProjKind = (typeof PROJ)[keyof typeof PROJ];

export const PF = {
  crit: 1,
  ricochet: 2,
  captured: 4,
  homing: 8,
  portalled: 16,
  bubbleBoost: 32,
  retargeted: 64,
  released: 128,
  /** Fired by a gun (any weapon): powers that hook "your shots" look for this. */
  gun: 256,
  deflected: 512,
} as const;

export interface Projectile {
  id: number;
  kind: ProjKind;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  life: number;
  /** Life at spawn (for falloff). */
  life0: number;
  bounces: number;
  maxBounces: number;
  flags: number;
  source: SourceId;
  /** The gun that fired it (null for power projectiles). */
  weapon: WeaponId | null;
  rarity: number;
  /** Players it may still pass through, and the last one it hit. */
  pierce: number;
  lastHit: number;
  /** Client id for predicted shots (0 = none). */
  shotId: number;
  /** Which portal it last exited (avoid instant re-entry). */
  portalCd: number;
  /** Combo bookkeeping: whose portal was used. */
  portalOwner: number;
  dead: boolean;
}

export const FX_KIND = [
  "portal", "singularity", "clone", "decoy", "glaive", "sigil", "lava", "slowField", "tether", "bubble",
  "magnet", "meteorWarn", "rift", "shockwave", "rewindTrail", "molten", "finalStand", "flash",
  "overdriveAura", "echoAura", "hunterMark",
  "beacon", "vulture", "flip",
  "prismAura", "hexFlash", "phantomDash", "voidBurst",
  "smoke", "mine", "beam", "slash", "supplyDrop",
] as const;
export type EffectKind = (typeof FX_KIND)[number];

/** Generic world effect: every power/ultimate entity (portals, black holes, clones…). */
export interface Effect {
  id: number;
  kind: EffectKind;
  owner: number;
  source: SourceId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  angle: number;
  /** A linked entity (portal partner, tether target, captured glaive…). */
  link: number;
  /** Second point (rift end, tether anchor…). */
  x2: number;
  y2: number;
  /** Small integer state (portal color, phase, count…). */
  n: number;
  /** Generic float value (hp for decoys, damage scale…). */
  v: number;
  dead: boolean;
  /** Server-only scratch (hit cooldowns etc.), never sent. */
  hits?: Map<number, number>;
}

export const LOOT_KINDS = ["weapon", "ammo", "bandage", "medkit", "shield", "throwable", "shard"] as const;
export type LootKind = (typeof LOOT_KINDS)[number];

/** An item lying on the floor. */
export interface Loot {
  id: number;
  kind: LootKind;
  x: number;
  y: number;
  /** For weapons: the gun and its ammo; for throwables: which one; count for stacks. */
  weapon: WeaponId;
  rarity: number;
  mag: number;
  reserve: number;
  throwable: ThrowableId;
  count: number;
  dead: boolean;
}

/** Things that happened this tick; the client turns them into visuals and sound. */
export type GameEvent =
  | { t: "hit"; target: number; by: number; amount: number; crit: boolean; source: SourceId; x: number; y: number; armor: boolean }
  | { t: "kill"; victim: number; killer: number; source: SourceId; x: number; y: number }
  | { t: "shoot"; by: number; x: number; y: number; angle: number; weapon: WeaponId }
  | { t: "cast"; by: number; power: PowerId | UltId; x: number; y: number; angle: number }
  | { t: "impact"; x: number; y: number; color: number; size: number }
  | { t: "solidHit"; id: number; x: number; y: number }
  | { t: "solidBroken"; id: number; x: number; y: number }
  | { t: "loot"; by: number; kind: LootKind; weapon: WeaponId; rarity: number; x: number; y: number }
  | { t: "reload"; by: number; weapon: WeaponId }
  | { t: "throw"; by: number; x: number; y: number; item: ThrowableId }
  | { t: "heal"; by: number; item: HealKind | "shield"; done: boolean }
  | { t: "supply"; x: number; y: number; landed: boolean }
  | { t: "shard"; by: number }
  | { t: "slash"; by: number; x: number; y: number; angle: number }
  | { t: "deflect"; by: number; x: number; y: number }
  | { t: "dash"; by: number; x: number; y: number }
  | { t: "combo"; by: number; name: string; stolen: boolean; x: number; y: number }
  | { t: "explode"; x: number; y: number; r: number; source: SourceId; by: number }
  | { t: "bounce"; x: number; y: number; n: number }
  | { t: "portal"; x: number; y: number; x2: number; y2: number }
  | { t: "wallSlam"; target: number; x: number; y: number }
  | { t: "zoneStage"; stage: number }
  | { t: "win"; winner: number }
  | { t: "haunt"; by: number; kind: "lava" | "slow"; x: number; y: number };
