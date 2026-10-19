// Core game types shared by server (authoritative) and client (prediction + rendering).

export const POWER_IDS = [
  "chronoRewind", "singularity", "mirrorSelf", "portalPair", "stormTether", "timeBubble",
  "ricochetPrism", "phantomMark", "hexSwap", "magnetar", "voidCloak", "moltenPath",
  "boomerangGlaive", "gravityFlip", "bountyBeacon", "decoySwarm", "shockwaveSlam", "thirdParty",
] as const;
export type PowerId = (typeof POWER_IDS)[number];

export const ULT_IDS = ["meteorRain", "overdrive", "riftCollapse", "echoStorm", "finalStand", "huntersEye"] as const;
export type UltId = (typeof ULT_IDS)[number];

/** What dealt damage, for the kill feed icon. */
export type SourceId = PowerId | UltId | "shot" | "zone" | "wall" | "haunt" | "combo";
export const SOURCE_IDS: readonly SourceId[] = [...POWER_IDS, ...ULT_IDS, "shot", "zone", "wall", "haunt", "combo"];
export const sourceIndex = (s: SourceId) => SOURCE_IDS.indexOf(s);
export const sourceAt = (i: number): SourceId => SOURCE_IDS[i] ?? "shot";

/** Timed status effects on a player. Values are seconds remaining. */
export const STATUS_IDS = [
  "slowed", "inverted", "tethered", "airborne", "cloaked", "bountied", "invulnerable", "marked",
  "ricochet", "molten", "thirdParty", "overdrive", "echo", "hunter", "finalStand", "blinded", "dashing", "timeBubble",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];
export type Statuses = Partial<Record<StatusId, number>>;

export const BTN = {
  shoot: 1,
  dash: 2,
  p1: 4,
  p2: 8,
  ult: 16,
  p3: 32,
} as const;

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
  /** Ids for predicted shots fired this frame. */
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
  alive: boolean;
  connected: boolean;
  dashT: number;
  dashCd: number;
  dashX: number;
  dashY: number;
  fireCd: number;
  ammo: number;
  ammoT: number;
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
  basic: 0,
  clone: 1,
  tether: 2,
  gravity: 3,
  singularityOrb: 4,
  meteor: 5,
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
  bounces: number;
  maxBounces: number;
  flags: number;
  source: SourceId;
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

export interface Pillar {
  id: number;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

export type PickupKind = "heal" | "cooldown" | "ult" | "prism";
export const PICKUP_KINDS: readonly PickupKind[] = ["heal", "cooldown", "ult", "prism"];

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  dead: boolean;
}

export interface Nebula {
  x: number;
  y: number;
  r: number;
}

/** Things that happened this tick; the client turns them into visuals and sound. */
export type GameEvent =
  | { t: "hit"; target: number; by: number; amount: number; crit: boolean; source: SourceId; x: number; y: number }
  | { t: "kill"; victim: number; killer: number; source: SourceId; x: number; y: number }
  | { t: "shoot"; by: number; x: number; y: number; angle: number }
  | { t: "cast"; by: number; power: PowerId | UltId; x: number; y: number; angle: number }
  | { t: "impact"; x: number; y: number; color: number; size: number }
  | { t: "pillarHit"; id: number; x: number; y: number }
  | { t: "pillarBroken"; id: number; x: number; y: number; r: number }
  | { t: "pickup"; by: number; kind: PickupKind; x: number; y: number }
  | { t: "dash"; by: number; x: number; y: number }
  | { t: "combo"; by: number; name: string; stolen: boolean; x: number; y: number }
  | { t: "explode"; x: number; y: number; r: number; source: SourceId; by: number }
  | { t: "bounce"; x: number; y: number; n: number }
  | { t: "portal"; x: number; y: number; x2: number; y2: number }
  | { t: "wallSlam"; target: number; x: number; y: number }
  | { t: "zoneStage"; stage: number }
  | { t: "haunt"; by: number; kind: "lava" | "slow"; x: number; y: number };
