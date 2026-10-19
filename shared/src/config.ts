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
  maxPlayers: 5,
  nameMaxLength: 16,
  version: 1,
} as const;

export const PLAYER_COLORS = [
  { id: 0, name: "Cyan", hex: "#00F0FF", shape: "circle" },
  { id: 1, name: "Magenta", hex: "#FF2E88", shape: "triangle" },
  { id: 2, name: "Lime", hex: "#9DFF3A", shape: "square" },
  { id: 3, name: "Gold", hex: "#FFC83D", shape: "diamond" },
  { id: 4, name: "Violet", hex: "#A970FF", shape: "cross" },
] as const;

export const PLAYER = {
  radius: 26,
  maxHp: 100,
  speed: 330,
  /** How quickly velocity reaches the target (per second). High = snappy. */
  accel: 16,
  /** Out-of-combat regen, Brawl Stars style. */
  regenDelay: 3.2,
  regenPerSecond: 9,
  dash: { duration: 0.14, speedMult: 3.4, iframes: 0.18, cooldown: 2.0 },
  spawnInset: 170,
} as const;

export const SHOT = {
  damage: 11,
  speed: 980,
  radius: 7,
  life: 0.85,
  fireCooldown: 0.17,
  /** Ammo: fire up to 5 quickly, then it refills one at a time. Rewards timing over spam. */
  ammoMax: 5,
  ammoReload: 0.42,
  critMult: 1.75,
  spawnOffset: 30,
  /** Pillars take this much from a basic shot. */
  pillarDamage: 1,
} as const;

export const ULT_CHARGE = {
  perDamageDealt: 0.55,
  perDamageTaken: 0.35,
  max: 100,
} as const;

export const KILL_CREDIT_SECONDS = 5;

export const POINTS = {
  placement: [5, 3, 2, 1, 0],
  perKill: 1,
  toWin: 15,
} as const;

export const MATCH = {
  ultSelectSeconds: 12,
  draftSeconds: 15,
  firstDraftSeconds: 11,
  countdownSeconds: 3,
  replaySeconds: 3.6,
  standingsSeconds: 6.5,
  replayWindowBefore: 2.0,
  replayWindowAfter: 0.6,
  replaySpeed: 0.32,
  draftOptions: 3,
  comebackOptions: 4,
  ultOptions: 3,
  /** Rounds cap so a match can't drag on forever. */
  maxRounds: 12,
} as const;

export const ARENA = {
  sides: 12,
  baseRadius: 820,
  perPlayerRadius: 150,
  wallBounce: 0.25,
  /** Damage from slamming into a wall at full knockback speed. */
  wallSlamDamage: 14,
  wallSlamMinSpeed: 520,
  pillarHp: { small: 14, medium: 26, large: 60 },
  pillarRadius: { small: 34, medium: 52, large: 120 },
  /** Nebula patches hide players from enemies farther than revealRange (Brawl Stars bushes). */
  nebula: { revealRange: 230, revealAfterShot: 1.1 },
} as const;

export const ZONE = {
  startDelay: 30,
  /** Each stage: warn, then shrink over shrinkTime to radiusFrac of the arena radius. */
  stages: [
    { warn: 8, shrink: 14, radiusFrac: 0.72, dps: 3 },
    { warn: 8, shrink: 12, radiusFrac: 0.5, dps: 5 },
    { warn: 7, shrink: 11, radiusFrac: 0.32, dps: 8 },
    { warn: 6, shrink: 10, radiusFrac: 0.18, dps: 12 },
    { warn: 5, shrink: 9, radiusFrac: 0.06, dps: 18 },
  ],
} as const;

export const PICKUPS = {
  interval: 12,
  firstAt: 8,
  maxOnMap: 4,
  radius: 22,
  heal: 20,
  ultCharge: 35,
  weights: { heal: 40, cooldown: 25, ult: 25, prism: 10 },
  minDistFromPlayers: 260,
} as const;

export const GHOST = {
  hauntCooldown: 10,
  lava: { radius: 70, duration: 3, dps: 10 },
  slow: { radius: 95, duration: 3, mult: 0.5 },
} as const;

export const HAZARD_TICK = 0.25;

/** Powers. Cooldowns are in seconds; everything a power uses lives here. */
export const POWERS = {
  chronoRewind: { cooldown: 14, window: 2.5, trailPoints: 9, trailLife: 1.1, arriveInvuln: 0.2 },
  singularity: { cooldown: 16, speed: 360, fuse: 0.8, duration: 2.5, radius: 330, pull: 1250, projectilePull: 2400, damage: 25, coreRadius: 70, detonateRadius: 160 },
  mirrorSelf: { cooldown: 18, duration: 6, damageMult: 0.4, fireCooldown: 0.34, hp: 33, radius: 26, aimDistance: 420 },
  portalPair: { cooldown: 15, duration: 10, radius: 46, exitCooldown: 0.35, placeWindow: 6 },
  stormTether: { cooldown: 13, speed: 1500, range: 720, maxLength: 470, snapDamage: 30, chipDps: 3, duration: 5, boltDamage: 6, boltRadius: 10, chipInterval: 0.5, snapLinger: 0.45, slack: 140 },
  timeBubble: { cooldown: 17, duration: 4, radius: 260, slow: 0.25, exitSpeedMult: 1.6, exitDamageMult: 1.2 },
  ricochetPrism: { cooldown: 14, duration: 6, maxBounces: 4, damagePerBounce: 0.22 },
  phantomMark: { cooldown: 11, dashSpeedMult: 3.6, dashDuration: 0.22, fuse: 1.5, damage: 20, shotMult: 2, markPad: 18, iframePad: 0.06, burstRadius: 90, streakLinger: 0.45 },
  /** coneDeg is the half-angle either side of the aim. */
  hexSwap: { cooldown: 20, range: 900, coneDeg: 32, retargetWithin: 0.6, retargetPad: 14, lavaLockSlow: 1.4, flashLife: 0.55 },
  magnetar: { cooldown: 15, duration: 5, radius: 150, maxCaptured: 12, orbitRadius: 58, releaseSpeed: 1050, orbitSpeed: 4.5, holdLife: 0.4, releaseLife: 0.9 },
  voidCloak: { cooldown: 16, duration: 3, shimmerAlpha: 0.08, burstLife: 0.6, critGrace: 1.5 },
  /** Lava drops every dropEvery while moving (at least minSpacing apart), every idleDropEvery
   *  when standing still. Each drop is a capsule back to the previous one, so the trail is solid. */
  moltenPath: { cooldown: 13, duration: 4, trailLife: 3, dps: 16, dropEvery: 0.07, radius: 34, minSpacing: 14, idleDropEvery: 0.3 },
  /** Outbound: decelerates from outSpeed to 0 over `range` while curving sideways (curve = peak
   *  sideways speed as a fraction of outSpeed). Then it flies back to the throw point at
   *  returnSpeed; within catchAssist of the thrower it's pulled into their hand (caught within
   *  catchRadius). Hitting a pillar or wall turns it around early. In a Singularity it orbits. */
  boomerangGlaive: {
    cooldown: 8, outSpeed: 980, range: 560, damage: 18, radius: 22, catchRadius: 52, hitCooldown: 0.35,
    curve: 0.24, returnSpeed: 1150, returnSteer: 7, catchAssist: 120, maxFlight: 4, knockback: 260, pillarDamage: 4, caughtLinger: 0.45,
    captureRadius: 170, orbitRadius: 95, orbitSpeed: 7, orbitHitRadius: 150,
  },
  gravityFlip: { cooldown: 19, speed: 760, radius: 18, duration: 2.5, damage: 8, range: 860 },
  bountyBeacon: { cooldown: 22, duration: 6, ultPerDamage: 1.4 },
  /** Decoys burst out at `speed`, slow with `drag`, then wander at wanderSpeed. A hit pops one:
   *  enemies within flashRadius are blinded for flashBlind seconds. */
  decoySwarm: { cooldown: 15, count: 5, speed: 420, life: 4, flashRadius: 170, flashBlind: 1.1, radius: 17, drag: 2.4, wanderSpeed: 150, wanderTurn: 7 },
  /** Knockback falls off to minKnock (fraction) at the edge. Anyone knocked into a wall or pillar
   *  within comboWindow takes wallBonus × ARENA.wallSlamDamage extra; anyone knocked into a
   *  Singularity's detonation zone within comboWindow triggers Gravity Slam. */
  shockwaveSlam: { cooldown: 12, airTime: 0.45, radius: 260, knockback: 1450, damage: 14, wallBonus: 1.0, minKnock: 0.6, comboWindow: 0.8 },
  /** Targets someone else hurt within recentWindow take mult damage from you; the caster sees
   *  a crosshair on them that lingers markerLinger after they stop qualifying. */
  thirdParty: { cooldown: 18, duration: 5, recentWindow: 1.0, mult: 2, markerLinger: 0.25 },
} as const;

export const ULTIMATES = {
  /** Meteors land at evenly spread (jittered) points of a disc centered `centerDist` along your
   *  aim (pulled back toward you if that's outside the arena). Each shows its warning circle
   *  for `warn` seconds; impacts are spread over `duration`. */
  meteorRain: { count: 12, duration: 3, radius: 420, impactRadius: 95, damage: 22, warn: 0.75, centerDist: 420, jitter: 0.35, knock: 420 },
  /** fireRateMult divides the shot cooldown (and shots cost no ammo); reloadMult speeds ammo refill. */
  overdrive: { duration: 6, fireRateMult: 2, reloadMult: 2.2 },
  /** Pull is a per-second impulse (steady drift ≈ 180 u/s, slower than walking, so you can
   *  fight it), scaled from nearMult on the line to farMult at farRange. */
  riftCollapse: { pullTime: 3, pull: 900, nearMult: 1.25, farMult: 0.6, farRange: 1200, closeDamage: 45, closeRadius: 150, closeKnock: 650, halfLength: 900, afterglow: 0.5 },
  echoStorm: { duration: 8, echoDelay: 0.25 },
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
    easy: { reaction: 0.45, aimErrorDeg: 14, castChance: 0.35, dodgeSkill: 0.35, preferredRange: 420 },
    normal: { reaction: 0.3, aimErrorDeg: 8, castChance: 0.65, dodgeSkill: 0.65, preferredRange: 380 },
    hard: { reaction: 0.17, aimErrorDeg: 4, castChance: 0.9, dodgeSkill: 0.9, preferredRange: 340 },
  },
  names: ["NOVA", "VEX", "ORBIT", "KILO", "ZEPHYR", "QUASAR", "HALO", "RIFT", "ECHO", "PULSE"],
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
  viewHeight: 1150,
  minimapRange: 900,
  fireRevealSeconds: 1.4,
} as const;
