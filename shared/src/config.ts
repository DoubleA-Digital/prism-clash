// Every tunable number in Prism Clash. Server and client both read this file, so
// changing a value here changes the real game everywhere. Times are seconds, distances
// are world units (1 unit = 1 px at 1x zoom), speeds are units per second.

export const NET = {
  tickRate: 30,
  /** Remote entities render this far in the past (ticks). 3 ticks = 100 ms. */
  interpDelayTicks: 3,
  interpDelayMaxTicks: 6,
  /** Lag compensation never rewinds further than this. */
  lagCompMaxMs: 200,
  historySeconds: 1,
  /** A baseline older than this forces a full snapshot. */
  maxBaselineAgeTicks: 30,
  /** Predicted-position errors below this are invisible; above snap is instant. */
  correctionSmoothMs: 110,
  correctionSnapUnits: 140,
  pingIntervalMs: 1000,
  rejoinSeconds: 30,
  maxMessageBytes: 4096,
  rateLimit: { inputsPerSecond: 150, otherPerSecond: 25, roomsPerMinutePerIp: 6, floodStrikes: 3 },
  maxRooms: 200,
  roomCodeLength: 5,
  /** Humans per room. Bots fill the rest of MATCH.fighters. */
  maxPlayers: 5,
  nameMaxLength: 16,
  /** The alive-player list rides on a snapshot when it changes, and at least this often. */
  aliveListEveryTicks: 30,
  version: 2,
} as const;

/** The first five are the colors humans pick from in the lobby; bots take the rest. */
export const PLAYER_COLORS = [
  { id: 0, name: "Cyan", hex: "#00F0FF", shape: "circle" },
  { id: 1, name: "Magenta", hex: "#FF2E88", shape: "triangle" },
  { id: 2, name: "Lime", hex: "#9DFF3A", shape: "square" },
  { id: 3, name: "Gold", hex: "#FFC83D", shape: "diamond" },
  { id: 4, name: "Violet", hex: "#A970FF", shape: "cross" },
  { id: 5, name: "Orange", hex: "#FF8A2B", shape: "star" },
  { id: 6, name: "Teal", hex: "#2BFFC8", shape: "hex" },
  { id: 7, name: "Rose", hex: "#FF7BD5", shape: "ring" },
  { id: 8, name: "Sky", hex: "#5FA8FF", shape: "circle" },
  { id: 9, name: "Ember", hex: "#FF4A4A", shape: "triangle" },
  { id: 10, name: "Mint", hex: "#B6FF8F", shape: "square" },
  { id: 11, name: "Pearl", hex: "#E8E4FF", shape: "diamond" },
] as const;
export const HUMAN_COLORS = 5;

export const PLAYER = {
  radius: 22,
  maxHp: 100,
  speed: 330,
  /** How quickly velocity reaches the target (per second). High = snappy. */
  accel: 16,
  dash: { duration: 0.14, speedMult: 3.4, iframes: 0.18, cooldown: 2.4 },
  /** Hands and gun muzzle sit this far out from the body center. */
  muzzle: 34,
} as const;

/** Things every gun shares. */
export const GUN = {
  critMult: 1.75,
  /** Projectiles move with a bit of the shooter's velocity. */
  inheritVelocity: 0.15,
  /** Clamp on how long a single input batch may hold the trigger for semi-auto feel. */
  minFireCd: 0.05,
} as const;

export const WEAPON_IDS = ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket", "lance", "blade"] as const;
export type WeaponKey = (typeof WEAPON_IDS)[number];

export interface WeaponDef {
  name: string;
  /** Firing pattern. "bullet" = one projectile, "shotgun" = pellets, "rocket" = splash on impact,
   *  "lance" = hold to charge then a bouncing hitscan beam, "blade" = melee lunge arc. */
  kind: "bullet" | "shotgun" | "rocket" | "lance" | "blade";
  damage: number;
  fireCd: number;
  mag: number;
  reload: number;
  speed: number;
  life: number;
  radius: number;
  /** Base half-spread in degrees, plus bloom that grows per shot and recovers per second. */
  spread: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecover: number;
  pellets: number;
  /** Damage multiplier at the end of the projectile's life (linear falloff from 1). */
  falloffMin: number;
  /** Extra players a shot passes through. */
  pierce: number;
  /** Unlimited reserve ammo (still reloads). */
  infinite: boolean;
  /** Reserve ammo a freshly found weapon carries, in magazines. */
  reserveMags: number;
  moveMult: number;
  /** Rocket splash. */
  splash: number;
  knock: number;
  /** Lance: seconds to full charge, damage fraction at zero charge, beam reach and wall bounces. */
  chargeTime: number;
  minCharge: number;
  beamRange: number;
  bounces: number;
  /** Blade: swing arc (degrees), reach, swing time (bullets are deflected meanwhile), lunge impulse. */
  arc: number;
  reach: number;
  swingTime: number;
  lunge: number;
  /** Visual kick (world units the gun recoils). */
  recoil: number;
}

const W = (o: Partial<WeaponDef> & Pick<WeaponDef, "name" | "kind" | "damage" | "fireCd">): WeaponDef => ({
  mag: 0, reload: 1, speed: 1000, life: 0.7, radius: 6, spread: 0, bloomPerShot: 0, bloomMax: 0, bloomRecover: 0, pellets: 1, falloffMin: 1,
  pierce: 0, infinite: false, reserveMags: 3, moveMult: 1, splash: 0, knock: 0, chargeTime: 0, minCharge: 1, beamRange: 0, bounces: 0,
  arc: 0, reach: 0, swingTime: 0, lunge: 0, recoil: 4, ...o,
});

export const WEAPONS: Record<WeaponKey, WeaponDef> = {
  pistol: W({ name: "Pistol", kind: "bullet", damage: 14, fireCd: 0.24, mag: 12, reload: 1.1, speed: 1150, life: 0.75, spread: 2, infinite: true, recoil: 4 }),
  smg: W({ name: "SMG", kind: "bullet", damage: 9, fireCd: 0.075, mag: 30, reload: 1.6, speed: 1100, life: 0.55, spread: 3, bloomPerShot: 1.3, bloomMax: 12, bloomRecover: 30, moveMult: 1.03, recoil: 3 }),
  rifle: W({ name: "Assault Rifle", kind: "bullet", damage: 15, fireCd: 0.12, mag: 30, reload: 2, speed: 1350, life: 0.8, spread: 1.5, bloomPerShot: 0.6, bloomMax: 5, bloomRecover: 18, moveMult: 0.97, recoil: 5 }),
  shotgun: W({ name: "Shotgun", kind: "shotgun", damage: 11, fireCd: 0.85, mag: 5, reload: 2.4, speed: 1050, life: 0.38, spread: 14, pellets: 8, falloffMin: 0.3, moveMult: 0.97, recoil: 11 }),
  sniper: W({ name: "Sniper", kind: "bullet", damage: 80, fireCd: 1.4, mag: 5, reload: 2.8, speed: 2600, life: 0.75, radius: 7, pierce: 1, reserveMags: 2, moveMult: 0.9, recoil: 14 }),
  rocket: W({ name: "Rocket Launcher", kind: "rocket", damage: 70, fireCd: 1.3, mag: 2, reload: 3, speed: 760, life: 1.6, radius: 12, splash: 170, knock: 650, reserveMags: 2, moveMult: 0.88, recoil: 12 }),
  lance: W({ name: "Prism Lance", kind: "lance", damage: 62, fireCd: 0.35, mag: 6, reload: 2.4, chargeTime: 0.9, minCharge: 0.25, beamRange: 1600, bounces: 1, moveMult: 0.95, recoil: 8 }),
  blade: W({ name: "Energy Blade", kind: "blade", damage: 42, fireCd: 0.6, infinite: true, arc: 120, reach: 120, swingTime: 0.25, lunge: 720, moveMult: 1.08, recoil: 0 }),
};

/** Rarity tiers: index 0..3. Damage and magazine size scale with the tier. */
export const RARITY = [
  { name: "Common", color: "#B8C0D8", damage: 1, mag: 1 },
  { name: "Rare", color: "#4AA8FF", damage: 1.1, mag: 1.25 },
  { name: "Epic", color: "#B05CFF", damage: 1.22, mag: 1.5 },
  { name: "Legendary", color: "#FFC83D", damage: 1.36, mag: 1.75 },
] as const;

export const THROWABLE_IDS = ["frag", "smoke", "mine"] as const;
export type ThrowableKey = (typeof THROWABLE_IDS)[number];

export const ITEMS = {
  bandage: { heal: 15, time: 2, max: 10, name: "Bandage" },
  medkit: { heal: 60, time: 5, max: 3, name: "Medkit" },
  shield: { amount: 25, max: 50, name: "Shield Cell" },
  /** Movement speed while healing. */
  healMoveMult: 0.5,
  /** An ammo box adds this many magazines to the reserve of each held gun. */
  ammoMags: 1.5,
  throwCd: 0.8,
  throwMax: 3,
  throwables: {
    frag: { name: "Frag Grenade", speed: 760, friction: 1.7, fuse: 1.6, damage: 70, radius: 180, knock: 520, color: "#FF8A2B" },
    smoke: { name: "Smoke Grenade", speed: 720, friction: 1.9, fuse: 1.3, radius: 240, duration: 9, color: "#B9C4E8" },
    mine: { name: "Shock Mine", speed: 600, friction: 3.2, fuse: 0.7, damage: 45, radius: 110, trigger: 72, life: 45, slow: 1.8, color: "#5FD0FF" },
  },
} as const;

export const LOOT = {
  itemRadius: 18,
  /** F reaches items within this range. */
  interactRange: 95,
  /** Death piles and crate drops scatter items this far apart. */
  scatter: 46,
  weaponWeights: { pistol: 0, smg: 22, rifle: 20, shotgun: 18, sniper: 9, rocket: 5, lance: 7, blade: 8 },
  tables: {
    street: { items: { weapon: 32, ammo: 22, bandage: 18, medkit: 4, shield: 10, throwable: 11, shard: 0.8 }, rarity: [70, 24, 5, 1] },
    building: { items: { weapon: 40, ammo: 18, bandage: 12, medkit: 7, shield: 12, throwable: 10, shard: 1.4 }, rarity: [48, 35, 14, 3] },
    crate: { items: { weapon: 36, ammo: 20, bandage: 12, medkit: 7, shield: 13, throwable: 10, shard: 2 }, rarity: [38, 38, 19, 5] },
  },
  /** Items rolled per crate. */
  crateRolls: 2,
  /** Chance each loot spot is filled at match start. */
  spotFill: 0.85,
} as const;

export const SUPPLY = {
  /** Match seconds when supply drops are announced. */
  times: [95, 190, 285],
  /** Seconds from announcement to landing. */
  fallTime: 11,
  /** Rarity weights for the guns inside (epic, legendary). */
  rarity: [0, 0, 60, 40],
  weapons: 2,
  shields: 2,
  medkits: 1,
  shards: 1,
  /** How long the landed beacon stays on the minimap. */
  beaconSeconds: 25,
} as const;

/** Terrain behavior. Solid kinds: what blocks vision, hit points, explosive-only damage. */
export const SOLIDS = {
  wall: { vision: true, hp: 0, tough: false },
  rock: { vision: true, hp: 0, tough: false },
  crystal: { vision: true, hp: 0, tough: false },
  cover: { vision: false, hp: 0, tough: false },
  fence: { vision: false, hp: 140, tough: true },
  car: { vision: false, hp: 0, tough: false },
  crate: { vision: false, hp: 50, tough: false },
  barrel: { vision: false, hp: 30, tough: false },
  glass: { vision: false, hp: 24, tough: false },
} as const;

export const TERRAIN = {
  gridCell: 256,
  /** Thickness of the walls around the map edge. */
  border: 200,
  wallThickness: 24,
  barrel: { radius: 190, damage: 55, knock: 620, chainDelay: 0.12 },
  waterSlow: 0.6,
  /** Bushes hide you from enemies farther than revealRange (unless you fired recently). */
  bush: { revealRange: 230, revealAfterShot: 1.1 },
  /** Damage from slamming into a wall at full knockback speed. */
  wallSlamDamage: 14,
  wallSlamMinSpeed: 520,
  /** Explosions damage destructibles by damage × this. */
  explosionSolidMult: 1.4,
} as const;

export const MAPS = {
  neonCity: { name: "Neon City", half: 3000 },
  crystalWilds: { name: "Crystal Wilds", half: 3000 },
  /** Empty walled yard used by tests and debugging. */
  testYard: { name: "Test Yard", half: 1400 },
} as const;

/** Interest management: what the server sends each viewer. */
export const INTEREST = {
  halfW: 2400,
  halfH: 1500,
  /** Extra sideways offset of the LOS probes, so players don't pop at corners. */
  losMargin: 44,
  lootRange: 2600,
} as const;

/** v2 retune: guns are the main damage source now. A typical fighter who reaches the mid game
 *  deals ~280 and takes ~200 (armor and heals included) over a 6-8 minute match:
 *  280 × 0.5 + 200 × 0.3 = 200 charge = about two ultimates. Winners get four or five. */
export const ULT_CHARGE = {
  perDamageDealt: 0.5,
  perDamageTaken: 0.3,
  max: 100,
} as const;

export const KILL_CREDIT_SECONDS = 5;

export const MATCH = {
  /** Total fighters in a match; bots fill the seats humans don't. */
  fighters: 12,
  ultSelectSeconds: 12,
  draftSeconds: 12,
  countdownSeconds: 3,
  draftOptions: 3,
  ultOptions: 3,
  /** In-match Prism Shard draft: seconds to pick before one is chosen for you. */
  shardDraftSeconds: 10,
  /** After the last fighter falls, the winner gets this long before the results. */
  victorySeconds: 4,
  /** Safety cap on match length. */
  maxSeconds: 900,
} as const;

export const ZONE = {
  startDelay: 60,
  /** Each stage: warn, then shrink over `shrink` seconds to `radius`. The center moves each stage. */
  stages: [
    { warn: 45, shrink: 35, radius: 2500, dps: 2 },
    { warn: 38, shrink: 30, radius: 1750, dps: 4 },
    { warn: 32, shrink: 25, radius: 1150, dps: 7 },
    { warn: 26, shrink: 20, radius: 680, dps: 11 },
    { warn: 22, shrink: 16, radius: 320, dps: 16 },
    { warn: 18, shrink: 14, radius: 70, dps: 24 },
  ],
  /** Stage centers stay this far inside the map edge. */
  edgeMargin: 300,
} as const;

export const GHOST = {
  hauntCooldown: 10,
  lava: { radius: 70, duration: 3, dps: 10 },
  slow: { radius: 95, duration: 3, mult: 0.5 },
} as const;

export const HAZARD_TICK = 0.25;

/** Powers. Cooldowns are in seconds; everything a power uses lives here.
 *  v2 retune: guns are the main damage source, so powers that multiply gun damage (Ricochet,
 *  Third-Party, Time Bubble, Mirror Self, Bounty Beacon's ult charge) were toned down to
 *  complement a gun instead of replacing it, and terrain interactions got their own numbers. */
export const POWERS = {
  chronoRewind: { cooldown: 14, window: 2.5, trailPoints: 9, trailLife: 1.1, arriveInvuln: 0.2 },
  singularity: { cooldown: 16, speed: 540, orbRadius: 28, fuse: 0.8, duration: 2.5, radius: 330, pull: 1900, projectilePull: 2400, damage: 25, coreRadius: 70, detonateRadius: 160 },
  /** The clone copies the gun in hand (pellets, rockets, a lance beam, a blade swing) at
   *  damageMult, firing at most every max(fireCooldown, the gun's own cooldown). sideOffset:
   *  where it splits off (it slides along walls, never through them). */
  mirrorSelf: { cooldown: 18, duration: 6, damageMult: 0.35, fireCooldown: 0.34, hp: 33, radius: 22, aimDistance: 420, sideOffset: 70 },
  /** placeClearance: portals are nudged out of walls so their ring never sinks into one. */
  portalPair: { cooldown: 15, duration: 10, radius: 46, exitCooldown: 0.35, placeWindow: 6, placeClearance: 30 },
  /** A wall cutting the chain for wallBreak seconds breaks it (no snap damage: ducking behind
   *  a wall is the escape). */
  stormTether: { cooldown: 13, speed: 1500, range: 720, maxLength: 470, snapDamage: 30, chipDps: 3, duration: 5, boltDamage: 6, boltRadius: 10, chipInterval: 0.5, snapLinger: 0.45, slack: 140, wallBreak: 0.3 },
  timeBubble: { cooldown: 17, duration: 4, radius: 260, slow: 0.25, exitSpeedMult: 1.6, exitDamageMult: 1.15 },
  /** Bounces apply to every gun: bullets and pellets ricochet, rockets bounce before they
   *  blow, the Prism Lance beam gets lanceBounces extra reflections. A bounce refreshes the
   *  shot's flight to at least bounceLife seconds. */
  ricochetPrism: { cooldown: 14, duration: 6, maxBounces: 3, damagePerBounce: 0.15, lanceBounces: 2, bounceLife: 0.5 },
  phantomMark: { cooldown: 11, dashSpeedMult: 3.6, dashDuration: 0.22, fuse: 1.5, damage: 20, shotMult: 2, markPad: 18, iframePad: 0.06, burstRadius: 90, streakLinger: 0.45 },
  /** coneDeg is the half-angle either side of the aim. */
  hexSwap: { cooldown: 20, range: 900, coneDeg: 32, retargetWithin: 0.6, retargetPad: 14, lavaLockSlow: 1.4, flashLife: 0.55 },
  magnetar: { cooldown: 15, duration: 5, radius: 150, maxCaptured: 12, orbitRadius: 58, releaseSpeed: 1050, orbitSpeed: 4.5, holdLife: 0.4, releaseLife: 0.9, minReleaseDamage: 14 },
  voidCloak: { cooldown: 16, duration: 3, shimmerAlpha: 0.08, burstLife: 0.6, critGrace: 1.5 },
  /** Lava drops every dropEvery while moving (at least minSpacing apart), every idleDropEvery
   *  when standing still. Each drop is a capsule back to the previous one, so the trail is solid. */
  moltenPath: { cooldown: 13, duration: 4, trailLife: 3, dps: 16, dropEvery: 0.07, radius: 34, minSpacing: 14, idleDropEvery: 0.3 },
  /** Outbound: decelerates from outSpeed to 0 over `range` while curving sideways (curve = peak
   *  sideways speed as a fraction of outSpeed). Then it flies back to the throw point at
   *  returnSpeed; within catchAssist of the thrower it's pulled into their hand (caught within
   *  catchRadius). It bounces off walls and cover (each contact hits destructibles for solidDamage);
   *  after wallBounces contacts it shatters. In a Singularity it orbits. */
  boomerangGlaive: {
    cooldown: 8, outSpeed: 980, range: 560, damage: 18, radius: 22, catchRadius: 52, hitCooldown: 0.35,
    curve: 0.24, returnSpeed: 1150, returnSteer: 7, catchAssist: 120, maxFlight: 4, knockback: 260, solidDamage: 18, wallBounces: 4, caughtLinger: 0.45,
    captureRadius: 170, orbitRadius: 95, orbitSpeed: 7, orbitHitRadius: 150,
  },
  gravityFlip: { cooldown: 19, speed: 760, radius: 18, duration: 2.5, damage: 8, range: 860 },
  bountyBeacon: { cooldown: 22, duration: 6, ultPerDamage: 0.5 },
  /** Decoys burst out at `speed`, slow with `drag`, then wander at wanderSpeed. A hit pops one:
   *  enemies within flashRadius are blinded for flashBlind seconds. */
  decoySwarm: { cooldown: 15, count: 5, speed: 420, life: 4, flashRadius: 170, flashBlind: 1.1, radius: 17, drag: 2.4, wanderSpeed: 150, wanderTurn: 7 },
  /** Knockback falls off to minKnock (fraction) at the edge. Anyone knocked into a wall within
   *  comboWindow takes wallBonus × TERRAIN.wallSlamDamage extra; anyone knocked into a
   *  Singularity's detonation zone within comboWindow triggers Gravity Slam. */
  shockwaveSlam: { cooldown: 12, airTime: 0.45, radius: 260, knockback: 1450, damage: 14, wallBonus: 1.0, minKnock: 0.6, comboWindow: 0.8, solidDamage: 55 },
  /** Targets someone else hurt within recentWindow take mult damage from you; the caster sees
   *  a crosshair on them that lingers markerLinger after they stop qualifying. */
  thirdParty: { cooldown: 18, duration: 5, recentWindow: 1.0, mult: 1.5, markerLinger: 0.25 },
} as const;

export const ULTIMATES = {
  /** Meteors land at evenly spread (jittered) points of a disc centered `centerDist` along your
   *  aim (pulled back toward you if that's outside the map). Each shows its warning circle
   *  for `warn` seconds; impacts are spread over `duration`. Walls shield players from an
   *  impact; every destructible in it takes solidDamage (crates, glass and barrels break). */
  meteorRain: { count: 12, duration: 3, radius: 420, impactRadius: 95, damage: 24, warn: 0.75, centerDist: 420, jitter: 0.35, knock: 420, trackEvery: 2, trackJitter: 40, solidDamage: 60 },
  /** fireRateMult divides the gun's cooldown and speeds the Prism Lance charge. Decision: shots
   *  cost no ammo (6s of free magazine is the fantasy; 1.6x instead of 2x keeps rockets and
   *  snipers sane), a reload in progress finishes at once, reloadMult covers the rest. */
  overdrive: { duration: 6, fireRateMult: 1.6, reloadMult: 2.2 },
  /** Pull is a per-second impulse (steady drift ≈ 180 u/s, slower than walking, so you can
   *  fight it), scaled from nearMult on the line to farMult at farRange.
   *  The rift tears through buildings (it rips space itself: pull and slam ignore walls), and the
   *  slam smashes every destructible within closeRadius of the seam for solidDamage. */
  riftCollapse: { pullTime: 3, pull: 1250, nearMult: 1.25, farMult: 0.6, farRange: 1200, closeDamage: 45, closeRadius: 150, closeKnock: 650, halfLength: 900, afterglow: 0.5, solidDamage: 200 },
  /** A buff power (Ricochet, Third-Party, Void Cloak, Molten Path) cast again while it's still
   *  running, as an echo does, adds buffExtend × its duration instead of a wasted refresh. */
  echoStorm: { duration: 8, echoDelay: 0.25, buffExtend: 0.5 },
  /** While charging you're immune (damage is absorbed), slowed and can't shoot. */
  finalStand: { charge: 3, baseDamage: 20, absorbMult: 0.8, maxDamage: 75, radius: 380, knockback: 900 },
  huntersEye: { duration: 8, homingTurn: 3.2, homingRange: 520 },
} as const;

export const COMBOS = {
  singularityOrbitDps: 30,
  slamIntoSingularityMult: 2,
  labelSeconds: 1.6,
} as const;

export const BOTS = {
  thinkHz: 10,
  difficulty: {
    easy: { reaction: 0.45, aimErrorDeg: 12, castChance: 0.35, dodgeSkill: 0.35, rangeMult: 0.8 },
    normal: { reaction: 0.3, aimErrorDeg: 7, castChance: 0.65, dodgeSkill: 0.65, rangeMult: 0.72 },
    hard: { reaction: 0.17, aimErrorDeg: 4, castChance: 0.9, dodgeSkill: 0.9, rangeMult: 0.65 },
  },
  /** Bots notice loot within this range when not fighting. */
  lootRange: 650,
  /** Heal when below this HP and nobody is shooting at them. */
  healBelow: 55,
  names: ["NOVA", "VEX", "ORBIT", "KILO", "ZEPHYR", "QUASAR", "HALO", "RIFT", "ECHO", "PULSE", "ION", "AXIOM", "JINX", "TALON"],
} as const;

export const FX = {
  maxParticles: 4096,
  shakeMax: 22,
  shakeDecay: 1.6,
  hitStopBig: 0.075,
  hitStopKill: 0.11,
  bigHitThreshold: 18,
  chromaticMs: 140,
  zoomPunch: 0.06,
  camLead: 0.18,
  camStiffness: 9,
  /** World units visible vertically at 1x; the camera scales to fit the window. */
  viewHeight: 1250,
  /** Right-click with a sniper: the camera shows this much more. */
  scopeZoom: 1.55,
  minimapRange: 1100,
  fireRevealSeconds: 1.4,
  /** How dark the area outside your line of sight is. */
  shadowAlpha: 0.62,
} as const;
