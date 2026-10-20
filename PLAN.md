# Prism Clash: build plan

`SPEC.md` is the source of truth. This plan explains how I'll build it. Section 9 lists every decision I made where the spec was open or technically tricky. Nothing here is built yet; I'm waiting for your approval.

---

## 1. Folder structure

```
prism-clash/
  SPEC.md                     # your spec (source of truth)
  PLAN.md                     # this file
  PROGRESS.md                 # what's done per phase, how to run, known issues (kept current)
  package.json                # npm workspaces: shared, server, client; root scripts
  tsconfig.base.json          # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
  eslint.config.js            # bans `any`, floating promises, console.log outside the logger
  shared/
    src/
      config.ts               # EVERY tunable number (damage, cooldowns, speeds, radii, tick rates, zone, points)
      math/                   # vec2, angles, seeded RNG (mulberry32), easing, fixed-point quantize
      sim/
        world.ts              # World: entity store, component tables, tick(), events
        entities.ts           # entity kinds + component types (Transform, Body, Health, Owner, Lifetime, …)
        systems/              # movement, dash, projectiles, collisions, pillars, hazards, zone, pickups, status effects
        arena/                # the 3 layouts, scaled by player count; wall + pillar geometry
        collide.ts            # circle-vs-circle, circle-vs-segment, swept circle (no tunneling)
        history.ts            # position history ring buffer for lag compensation and Chrono Rewind
      powers/
        power.ts              # the Power interface + PowerContext
        registry.ts           # id -> Power; adding a power = one file + one line here
        chrono-rewind.ts … third-party.ts   # 18 files
      ultimates/              # 6 files + registry
      combos.ts               # the 6 named combos + "stolen" detection
      match/
        rules.ts              # placement points, kill credit (5 s window), win at 15
        draft.ts              # offers (3, or 4 for last place), auto-pick, slot replacement
      net/
        protocol.ts           # every message type, typed both directions
        codec.ts              # msgpackr encode/decode + quantization helpers
        delta.ts              # snapshot delta encode/apply against an acked baseline
    test/                     # vitest: sim determinism, collisions, every power, draft, rules, delta codec
  server/
    src/
      main.ts                 # http server (health check, serves client build in prod) + ws upgrade
      rooms/room.ts           # one room: players, host, state machine, 30 Hz loop, snapshots
      rooms/registry.ts       # room codes, lifecycle, cleanup
      session.ts              # session tokens, 30 s rejoin window
      lagcomp.ts              # rewinding other players by the shooter's latency
      validate.ts             # input clamping, cooldown checks, rate limits
      bots/                   # bot brain: perception, utility scoring, steering, aim error, draft picks
      log.ts
    test/                     # room flow, reconnect, rate limits, headless bot matches
  client/
    index.html
    src/
      main.ts                 # boot, screen router, resize/letterbox
      net/                    # socket, clock sync, prediction + reconciliation, interpolation buffer, net simulator
      render/                 # renderer, glow sprite cache, starfield, hex floor + ripples, cores, powers' visuals
      fx/                     # particle pools, trails, shockwaves, damage numbers, shake, hit-stop, chromatic flash
      audio/                  # WebAudio synth: SFX voices, positional mixer, procedural synthwave track
      input/                  # keyboard/mouse, Gamepad API, rebinding
      ui/                     # title, settings, how-to-play, lobby, ultimate pick, draft cards, HUD, scoreboard,
                              #   standings, slow-mo replay, match end, F2 net panel, F1 debug panel
      replay.ts               # snapshot ring buffer -> slow-mo killing-blow replay
  e2e/                        # Playwright (installed Edge): two-tab smoke test, 4-bot match, latency runs
```

## 2. Tech choices and dependencies

| Package | Why |
|---|---|
| `typescript` (strict) | Required. `any` is banned by ESLint (`no-explicit-any`, `no-unsafe-*`). |
| `vite` (client) | Required. Dev server with hot reload; production build served by the game server. |
| `ws` (server) | Required. |
| `msgpackr` (shared) | A compact binary encoding that is faster than JSON. Values are quantized before encoding (below). |
| `tsx` (server dev) | Runs the TypeScript server with watch mode. `esbuild` bundles it for production. |
| `vitest` | Unit tests for the shared simulation and server logic. |
| `playwright-core` | End-to-end tests driving your installed Edge, the same setup that already works for your other projects. |
| Google Fonts: **Orbitron** (display), **JetBrains Mono** (numbers) | Loaded with `display=swap`. Fallbacks are `system-ui` and `ui-monospace`. These are the only external assets, and the spec allows them. |

There's no game engine, no image files, and no audio files. Everything is drawn on canvas and synthesized with WebAudio.

## 3. Simulation model (shared)

- **Fixed step.** 30 ticks per second (`TICK_RATE` in config). The server runs exactly one tick per 33.3 ms with drift correction. The client runs the same shared code only to predict the local player and their own shots.
- **Units.** The world is in "units" (1 unit = 1 px at 1× zoom). Velocities are units per second, multiplied by `dt = 1/30`.
- **Entity/component.** `World` holds typed component tables keyed by entity id (`Map<EntityId, T>` per component), plus systems that run in a fixed order:
  `inputs → statusEffects → movement/dash → powers.onUpdate → projectiles → collisions/hits → hazards → pickups → zone → deaths → events`.
  Entity kinds: `player`, `projectile`, `clone`, `decoy`, `portal`, `singularity`, `glaive`, `hazard` (lava, slow field, molten trail), `sigil`, `pickup`, `pillar`, `meteor`, `rift`.
- **Determinism.** All gameplay randomness uses a seeded RNG (mulberry32) owned by the room. Clients never roll gameplay dice; they only use their own cosmetic RNG for particles.
- **Collisions.** Every body is a circle. Arena walls are segments (the arena is a polygon). Pillars are circles with HP. Projectiles use swept circle checks, so nothing tunnels at high speed.
- **Events.** Each tick emits typed events: `hit`, `kill`, `cast`, `combo`, `pillarBroken`, `pickup`, `portalUse`, `bounce`, and so on. The server sends them to clients, which turn them into visuals and sound. Events are how juice stays perfectly in sync without the client guessing.
- **Pooling.** The server pools projectiles. The client pools particles (a 4,096 typed-array pool), damage numbers, shockwave rings, and trail points.

## 4. Networking model

### 4.1 Connection and clock
- One WebSocket per player. Messages are binary msgpack frames.
- **Clock sync.** The client pings every second. The server echoes with its tick and time. The client keeps a smoothed RTT, an offset estimate, and a server-tick estimate, all shown on the F2 panel.

### 4.2 Inputs (client → server, every rendered frame)
`{ seq, tick, move: [x,y] (quantized to −127..127), aim (uint16 angle), buttons (bitfield: shoot, dash, p1, p2, ult, recast) }`.
Inputs are sent once per animation frame, about 60 Hz. The server buffers them per player and consumes one per tick. If several arrived, it merges them by OR-ing button edges and using the latest move and aim, so no tap is ever lost. Each tick, the server acks the latest consumed `seq` in that player's snapshot.

### 4.3 Client-side prediction and reconciliation (local player)
- The client applies its own inputs to a local copy of its player, using the same shared `movement`, `dash` and collision code.
- It keeps the unacked inputs in a ring buffer.
- When a snapshot arrives, it resets the predicted player to the server state at `ackSeq`, then replays every unacked input.
- **Smoothing.** The difference between the old predicted position and the new one becomes a visual offset that decays over about 100 ms. Below 2 units the correction is invisible. Above `SNAP_THRESHOLD` (120 units, for example after a Hex Swap or a rewind) it snaps.
- **Server-driven displacement** (portals, swaps, knockback, pulls) is flagged in the snapshot. The client accepts it without counting it as a "correction" in the stats.

### 4.4 Own projectiles (predicted)
- Pressing shoot spawns a **predicted projectile** on the client immediately, tagged `(clientShotId)`.
- The server creates the real projectile with the same `clientShotId`. When the client sees it, it swaps its predicted one for the real one and blends the positions over 80 ms.
- If the server rejects the shot (cooldown or dead), the predicted shot fades out over 100 ms instead of popping.
- Hits on enemies are never predicted. Damage numbers and hit-stop wait for the server's `hit` event, about half an RTT later. That's normal for authoritative shooters and avoids fake hits.

### 4.5 Interpolation (everything else)
- The client renders remote players and all server entities at `renderTick = estimatedServerTick − INTERP_DELAY_TICKS`. At 30 Hz, 3 ticks is 100 ms.
- It interpolates between the two snapshots around that time, and extrapolates for at most 1 tick if a snapshot is late.
- Angles interpolate along the shortest arc.
- The buffer adapts: if jitter rises, the delay grows to 5 ticks and shrinks back slowly.

### 4.6 Lag compensation
- The server keeps a 1-second position history (30 entries) for every player.
- When the server spawns a shot from player S, it rewinds the other players by `min(S.oneWayLatency + S.interpDelay, 200 ms)`. The spec caps the rewind at 200 ms, and I include the interpolation delay because that's where S actually saw them.
- The projectile is then **fast-forwarded** by that amount: its first moments of flight are checked against those rewound positions. After that it simulates normally against live positions.
- The same approach applies to instant powers that target players: Storm Tether, Hex Swap, and the Phantom Mark dash-through.

### 4.7 Snapshots and delta compression
- The server sends a snapshot to each client every tick (30 Hz).
- Each snapshot is a delta against the **last snapshot that client acknowledged**. The client acks snapshot ticks in its input packets.
- Per entity, only changed fields are sent, as a field bitmask plus values.
  - Positions are quantized to 1/8 unit (int).
  - Angles become uint16, HP becomes uint8, and timers become uint16 tick counts.
- Entities that appeared carry full state; entities that were removed send their ids.
- If a client's baseline is older than 1 second (packet loss), it gets a full snapshot.
- **Expected bandwidth:** about 2–6 KB/s down per client in a heavy 5-player fight, and about 1.5 KB/s up. That's measured and shown on F2.

### 4.8 Validation and safety
- Move vectors are clamped to length 1.
- Aim is any angle. Button presses are ignored while on cooldown, dead, stunned, or in the wrong phase.
- Cooldowns and ultimate charge are tracked only on the server.
- Rate limits:
  - Inputs: 120 messages/s per client.
  - Other messages: 20/s.
  - Room creation: 5 per minute per IP.
  - Anything above a limit is dropped, and a sustained flood gets the client disconnected.
- Names are trimmed, stripped of control characters and zero-width marks, and capped at 16 characters. Duplicate names get " 2".
- Message size is capped at 4 KB, and a schema check runs before any handler.

### 4.9 Disconnects and rejoin
- Each player gets a random session token, stored in `sessionStorage` per tab so two tabs are two players.
- If a socket drops, that player's core goes idle (inputs zeroed), dims, and shows "reconnecting…". It can still be hit.
- Rejoining with the token within 30 s restores the same player: same color, points and powers. After 30 s, the player is removed. Mid-round, that counts as a death with no killer.
- If the host leaves, host passes to the longest-connected human. If only bots remain, the room closes.

### 4.10 Debug and network simulator (F2)
- The panel shows:
  - RTT, jitter, server tick, client render tick, interpolation delay
  - Snapshots per second and bytes per second up and down
  - Prediction corrections per minute and the largest correction
  - Dropped and late snapshots
- The **network simulator** wraps the socket on the client. It adds latency (0–500 ms), jitter (0–150 ms) and packet loss (0–30%) to both directions, with sliders and presets ("Good", "100 ms", "Bad Wi-Fi").
- Because WebSockets use TCP, "loss" is modeled as dropping whole snapshot or input messages before delivery. Prediction and delta acks are built to survive that.

## 5. Message protocol

Every message is `[type: uint8, payload]`, encoded with msgpack and typed in `shared/net/protocol.ts`.

**Client → server**

| Type | Payload | When |
|---|---|---|
| `hello` | `{ name, sessionToken? , version }` | On connect; with a token it means rejoin |
| `createRoom` | `{}` | Main menu |
| `joinRoom` | `{ code }` | Main menu or `?room=` |
| `lobbySet` | `{ color?, ready?, botDifficulty?, fillBots?, arena? }` | Lobby (host-only fields checked) |
| `kick` | `{ playerId }` | Host |
| `start` | `{}` | Host, when 2+ ready |
| `pickUltimate` | `{ index }` | Ultimate select |
| `pickPower` | `{ index }` | Draft |
| `input` | `{ seq, tick, move, aim, buttons, ackSnap, clientShotIds[] }` | Every frame in a round |
| `haunt` | `{ kind: lava\|slow, x, y }` | Ghosts, at most once per 10 s |
| `spectate` | `{ targetId }` | Ghosts |
| `ping` | `{ t }` | Every 1 s |
| `rematch` | `{}` | Match end |
| `debugGrant` | `{ playerId, powerId \| ultId }` | F1, test rooms only (rejected otherwise) |

**Server → client**

| Type | Payload |
|---|---|
| `welcome` | `{ playerId, sessionToken, serverTime, tickRate, config hash }` |
| `roomState` | Lobby: `{ code, hostId, players[{id,name,color,ready,bot,connected}], settings }` |
| `error` | `{ code, message }` (room full, bad code, name taken, etc.) |
| `phase` | `{ phase: ultSelect\|draft\|countdown\|round\|replay\|standings\|matchEnd, endsAtTick, data }` |
| `ultOffer` / `draftOffer` | `{ options[] }` (per player, private) |
| `draftReveal` | `{ loadouts[{playerId, slots[2], ult}] }` (all at once, after everyone locks in) |
| `snapshot` | `{ tick, baseTick, ackSeq, entities delta, removed[], events[] }` |
| `roundEnd` | `{ placements[], points, killTick, killerId, victimId, winnerId }` |
| `matchEnd` | `{ podium, stats per player (damage, kills, powers used, combos, accuracy, chaos moment) }` |
| `pong` | `{ t, serverTime, tick }` |

## 6. Core systems

### 6.1 Room and match state machine (server)

```
lobby → ultSelect (10 s) → draft (15 s) → countdown (3 s) → round → replay (≈3.5 s) → standings (6 s)
        → draft → countdown → round → … → matchEnd → (rematch → lobby)
```

- Every phase has a server deadline. Clients only render the phase they're told about.
- A round ends when one player is alive. If all die on the same tick, they share last place and no one gets first-place points.
- Matches end at the end of a round in which someone reaches 15+ points. The highest total wins. A tie is broken by most round wins, then most kills.

### 6.2 Core combat
- Every tunable number lives in `config.ts`. Starting values:

| Stat | Value |
|---|---|
| HP | 100 |
| Basic shot | 9 dmg, 0.18 s cooldown, 900 u/s, 1.1 s life |
| Dash | 0.12 s, 3.2× speed, 0.15 s of i-frames, 2 s cooldown |
| Crit | ×1.75 |

- **Ultimate charge:** +1% per 2 damage dealt and +1% per 3 damage taken. When full, the meter pulses and the shell glows brighter.
- **Kill credit:** every damage instance records `(attackerId, sourcePowerId, tick)` on the victim. On death, the attacker with the latest hit in the last 5 s gets the kill. Hazards (molten lava, singularity, meteors) carry their owner, so they credit the owner. Ghost hazards credit no one (ghosts can't damage players directly).

### 6.3 Powers
```ts
interface Power<S extends PowerState = PowerState> {
  id: PowerId; name: string; description: string; color: string;
  cooldown: number;                        // seconds (from config)
  drawIcon(ctx: CanvasRenderingContext2D, size: number, t: number): void;   // client only
  onCast(ctx: PowerContext, caster: PlayerRef, aim: number): S | null;      // null = cast refused
  onUpdate?(ctx: PowerContext, state: S, dt: number): boolean;             // false = expired
  onHit?(ctx: PowerContext, state: S, hit: HitEvent): void;
  onExpire?(ctx: PowerContext, state: S): void;
  serialize(state: S): EncodedPowerState;  deserialize(e: EncodedPowerState): S;
}
```
- `PowerContext` exposes the world, the rng, the event bus, config, and helpers (`spawnProjectile`, `applyDamage`, `applyImpulse`, `addStatus`, `queryCircle`, `raycast`). Powers never touch internals directly, which keeps each power at about 80–200 lines.
- The **client** imports the same registry for icons, names and the visual "language". It renders each power's networked state through a matching `render/powers/<id>.ts`.
- Each power has a signature color and shape. For example:
  - Chrono = teal clock ticks with ghost afterimages
  - Singularity = violet accretion swirl with lensing distortion lines
  - Portal = orange/blue rings with a spiral
  - Storm = white-blue jagged arcs
  - Molten = orange lava cells
- Readability rule: every hazard shows its area clearly (a filled, low-alpha shape plus a bright edge) and is visible to every player.
- **Status effects** run as a small shared system with stack rules: `slowed`, `timeScaled` (Time Bubble), `inverted` (Gravity Flip), `tethered`, `airborne`, `cloaked`, `bountied`, `invulnerable`, `marked`.

### 6.4 Ultimates and combos
- Ultimates use the same interface in their own registry.
- **Echo Storm** wraps `onCast`: for 8 s, every power cast is cast again 0.25 s later, from the same position, at the current aim.
- **Combos** are explicit checks in `combos.ts`, each hooked at the precise event (for example, a projectile with a `ricochet` tag entering a portal):
  1. Ricochet shots through a portal keep their bounce count
  2. Singularity captures a glaive into orbit
  3. Magnetar captures projectiles slowed by Time Bubble
  4. Hex Swap into your own Molten Path
  5. Shockwave Slam knocks an enemy into a Singularity
  6. Storm Tether connects through portals
- A combo emits `combo { name, playerId, stolen }`. It's "stolen" when an ingredient belongs to someone else, for example using another player's portal. The client shows a floating "COMBO!" or "STOLEN COMBO!" label and plays a special chord.

### 6.5 Draft
- The server builds each player's offer from the seeded RNG:
  - 3 distinct powers (4 for anyone tied for last on points, but not in round 1 when everyone has 0).
  - An offer avoids the player's current two powers.
- Picks are hidden. When everyone has locked in, or after 15 s (auto-pick at random), the server sends `draftReveal`, and the clients play the flip animation.
- Each player has two slots. The new pick replaces the **older** slot.
- **Round 1:** everyone drafts twice (two quick 10 s picks), so they start with two powers.
- Bots score offers by preference, by synergy with what they hold (combo pairs), and by difficulty.

### 6.6 Battle royale systems
- **Arena.** The shape is a 12-sided polygon. Its radius scales with player count, `R = ARENA_BASE + ARENA_PER_PLAYER × n` (about 900 + 140n). The three layouts place pillars relative to R:
  - Shattered Grid: 14 small pillars
  - Twin Cores: 2 large pillars plus 4 small
  - Open Void: 3 tiny pillars
- **Pillars** have HP. Shots, explosions and wall-slams damage them. At 0 HP they shatter: the server emits `pillarBroken`, and the client bursts shards and ripples the floor.
- **Zone.** Shrinking starts at 30 s, in 5 stages. Each stage gives a warning countdown, then lerps the safe circle toward a new center inside the old circle. The final center is chosen by the seeded RNG. Damage outside the zone grows each stage (2, 4, 7, 11, 16 HP/s). It's drawn as a crackling energy wall with animated arcs.
- **Pickups.** One spawns every 12 s, inside the safe zone and away from players. The weights are:

| Pickup | Weight |
|---|---|
| Health +20 | 40 |
| Cooldown reset | 25 |
| Ultimate charge +35% | 25 |
| Prism Core (a random third power for the rest of the round, cast with F or gamepad X) | 10 |

- **Ghosts and spectating.** Dead players become ghosts. A ghost's camera follows a chosen survivor. Every 10 s a ghost can place a lava puddle (3 s) or a slow field (3 s) anywhere on its screen. Each hazard is outlined in the ghost's color with a small ghost glyph and its name.

### 6.7 Bots (server)
- A bot is a normal player whose inputs come from a brain, not a socket. Bots therefore go through the same validation and cooldowns.
- **Perception** (at 10 Hz) reads the live world only:
  - visible enemies (line of sight, cloak respected)
  - incoming projectiles (time to impact)
  - zone edge, pickups, hazards
- **Utility AI** scores the possible actions each think and picks one:

| Action | Purpose |
|---|---|
| fight (strafe at preferred range) | trade shots |
| take cover (a point behind the nearest pillar from the threat) | break line of sight |
| dodge (perpendicular to an incoming projectile, dash if impact is close) | avoid damage |
| rotate to zone | stay inside the safe zone |
| grab pickup | heal or charge up |
| reposition / third-party | join an ongoing fight |

  - **Steering** combines seek, flee and wall avoidance, then outputs a move vector.
- **Aim** leads the target by projectile travel time, plus noise and reaction delay set by difficulty:

| | Easy | Normal | Hard |
|---|---|---|---|
| Reaction delay | 450 ms | 300 ms | 170 ms |
| Aim error | ±14° | ±8° | ±4° |
| Cast usage | rarely | sensible | combo-aware |

- **Power use:** each power has a small `botHint`, for example "use when an enemy is within 300 u", "defensive: use when HP < 40", or "combo after X". Bots use ultimates when they would hit 2+ enemies or when it's a finishing chance.

### 6.8 Client rendering ("Neon Void")
- **Layers:**
  1. Background gradient
  2. 3-layer parallax starfield (pre-rendered tiles that drift)
  3. Hex floor (pre-rendered tile plus a ripple pass driven by up to 16 active ripple rings, rippling only the cells near each ring)
  4. Arena edges
  5. Hazards
  6. Pillars
  7. Pickups
  8. Projectiles with trails
  9. Cores
  10. Particles
  11. World-space text (damage numbers, combo labels)
  12. Post effects (chromatic flash, vignette, zoom punch)
  13. HUD canvas
- **Glow.** Every glowing shape uses pre-rendered radial-glow sprites (per color and size bucket, cached on offscreen canvases) drawn with `globalCompositeOperation = "lighter"`. Per-frame `shadowBlur` is not used anywhere hot.
- **Cores:**
  - an inner orb (glow sprite plus a bright center)
  - a rotating angular shell (a hexagon of 6 shards, with crack lines added at 75/50/25% HP, and shards falling off below 25%)
  - a motion trail (a 14-point ribbon)
  - the name above
  - in colorblind mode, a shape marker for each player (●▲■◆✚)
- **Camera:** it follows the local player with a critically damped spring and leads up to 18% toward the mouse. The zoom fits the arena to the screen at a consistent world-units-per-pixel. Letterboxing keeps the HUD at the edges.
- **Juice** (client only; never alters the simulation):
  - **Hit-stop:** a 40–90 ms render freeze on big hits you deal or take, including your ult. Snapshots keep buffering, and the client catches up smoothly.
  - **Trauma shake:** offset = `maxShake × trauma² × noise`. It decays at 1.5/s, is scaled by distance to the event and by the settings slider, and ignores far-away events.
  - **Chromatic aberration:** an RGB-split blit for 120 ms, with a 6% zoom punch on ultimate casts and your own kills.
  - **Damage numbers:** they pop with an arc. Crits are gold and 1.6× size.
  - **Impacts:** sparks, a shockwave ring, and a floor ripple.

### 6.9 Slow-motion replay
- The client keeps the last 4 s of decoded snapshots and events in a ring buffer (it already has them for interpolation).
- On `roundEnd`, it replays from `killTick − 2 s` to `killTick + 0.5 s` at 0.3× speed. It zooms toward the killer, then the winner, with letterbox bars and a "FINAL BLOW" title.
- No extra bandwidth is needed.
- If a client joined too late to have the buffer, it skips straight to standings.

### 6.10 Audio (WebAudio, all synthesized)
- **SFX voices** are built from oscillators, noise buffers, filters and envelopes. Every power, hit, dash, pickup, pillar shatter, zone tick, UI click and combo chord has a recipe.
- **Positional mixing:**
  - Pan comes from the source's x position relative to the camera.
  - Gain falls off with distance (inverse, clamped), with a little low-pass filtering for far sounds.
  - Max 24 voices; quiet ones are stolen first.
- **Music:** a procedural synthwave loop at 110 BPM.
  - Saw bass with a sidechained kick, a pluck arpeggio over i–VI–III–VII, and a pad.
  - Intensity rises with zone stage and as fewer players remain: hats come in, the filter opens, the arp doubles, and the BPM nudges to 118.
- Master, music and SFX volume buses are controlled by settings.

### 6.11 UI screens
- **Screens:** title (animated logo, starfield, Play / Settings / How to Play), name entry, create/join, lobby, ultimate select, draft, countdown, HUD, Tab scoreboard, standings, replay, match end, settings, and the F1/F2 panels.
- **Implementation:** DOM overlays for menus (accessible, keyboard- and gamepad-navigable) on top of the canvas. The in-game HUD is drawn on canvas. Everything shares one design: Orbitron headings, JetBrains Mono numbers, glass-free neon panels.

### 6.12 Input
- Keyboard and mouse, plus the Gamepad API. Bindings are stored in `localStorage` and rebindable in settings.
- Gamepad aim uses the right stick with a radial deadzone and a response curve. Aim assist is off (competitive fairness).
- The Prism Core third power binds to **F** (keyboard) and **X** (gamepad).

## 7. Performance plan
- Particles live in a struct-of-arrays pool (Float32Arrays, 4,096 capacity). They're updated and drawn in one pass, batched by sprite.
- Glow sprites are cached. Text such as names and damage digits is pre-rendered per string and cached with LRU eviction.
- Only visible things are drawn, using camera-rect culling.
- The F1 panel shows FPS, frame time, particle count, and draw calls per layer.
- **Target:** 60 fps at 1080p in a 5-player fight with ultimates and 2,000+ particles. I'll verify with a scripted e2e stress scene (4 bots plus forced ults) and record frame-time stats.

## 8. Testing
- **Shared (vitest):**
  - collision and swept collision
  - determinism: the same seed and inputs give an identical world hash
  - the delta codec round-trips exactly
  - one test per power for its cast, update, hit and expire behavior
  - draft rules, points and kill credit
- **Server:**
  - room lifecycle, join codes, host transfer, the 30 s rejoin, rate limiting
  - **headless matches:** 4–5 bots play full matches to 15 points at 50× speed with no errors and plausible outcomes (every power is used at least once across a seed sweep)
- **E2E (Playwright + Edge):**
  - two tabs join one room, move and shoot, and see each other
  - a run at 150 ms simulated latency checks prediction-correction stats stay within budget
  - a 4-bot match completes
  - screenshots of every screen are reviewed visually
- **Each phase ends** with the build plus a typecheck of all three packages, the tests, a console-error check in e2e, and a short playtest guide.

## 9. Decisions where the spec was open (documented, per rule 5)

1. **Location and repo.** This lives at `projects/prism-clash` as its own git repo. I'll push it to a **private** GitHub repo `DoubleA-Digital/prism-clash`, matching your other projects. It's added to CoolMattGames in Phase 8, and I'll ask before pushing to Matthew's repo.
2. **Package manager: npm workspaces.** It deploys most simply on Render, Railway and Fly with zero config.
3. **Snapshot rate: 30 Hz** (every tick), delta-compressed. 100 ms of interpolation is then 3 snapshots of buffer, which makes jitter forgiving.
4. **Lag-compensation window:** `min(oneWayLatency + interpDelay, 200 ms)`. Including the interpolation delay is what makes "I saw it, I hit it" true.
5. **Hit feedback isn't predicted.** Only your own movement, dash and projectile flight are predicted. Damage waits for the server, which prevents fake hits.
6. **Round 1 has two quick picks** so everyone starts with two powers. Later rounds pick one, which replaces the older slot.
7. **Placement points with fewer than 5 players** use the top of the table. For example, with 2 players: 1st = 5, 2nd = 3.
8. **Simultaneous final deaths** share the lowest of the tied placements.
9. **Comeback** applies to everyone tied for last on points, except round 1 (everyone is at 0).
10. **Tie at 15+** is broken by round wins, then kills.
11. **Kill credit for ghost hazards** goes to no one (ghosts can't damage players directly). An environment kill gives no kill point.
12. **Mirror Self** is a server entity. It moves with your movement input reflected (x and y mirrored), fires real 40%-damage shots at your aim point, and shows your name and colors. Recasting swaps your position with the clone's (a flagged displacement, so no "correction" stutter).
13. **Hex Swap retargeting:** enemy projectiles that would reach you within 0.6 s get their velocity rotated to point at the swapped enemy. They keep their speed.
14. **Time Bubble:** inside the bubble, other players and all non-owner projectiles run at 25% time scale. Your shots leaving the bubble get ×1.6 speed and +20% damage.
15. **Phantom Mark** triggers the dash. The mark lands on any enemy your dash path crosses. "Doubled if you shoot them" means one of your basic shots hits them before it pops.
16. **Magnetar** captures enemy projectiles within 140 units that enter its field, up to 12. A recast or expiry fires them outward as yours, evenly spread.
17. **Bounty Beacon** with a tie for most points marks all tied players. If the caster is the leader, it marks the next highest, so it's never useless.
18. **Third-Party:** "currently being damaged by someone else" means the target took damage from another source within the last 1.0 s.
19. **Shockwave Slam:** you're airborne for 0.45 s (immune to ground hazards; you can't shoot). Knockback that sends someone into a wall or pillar deals bonus damage scaled by impact speed.
20. **Rift Collapse** is a line segment through the arena center along your aim, clipped to the arena. It pulls toward the nearest point on the segment.
21. **Final Stand** damage is `base + 0.8 × damage absorbed`, capped (all in config).
22. **Prism Core third power** binds to F and gamepad X. It lasts for the round.
23. **Arena shape** is a 12-sided polygon, not a rectangle: it reads well as "arena", shrinks toward a circle zone, and keeps spawns fair.
24. **Rejoin token** lives in `sessionStorage`, so two tabs on one machine are two players (needed for your local testing).
25. **Network "packet loss"** on TCP WebSockets is simulated by dropping whole messages in the client-side simulator.
26. **Aim assist** is off for gamepads, for fairness. The right stick gets a radial deadzone and a response curve.
27. **Fonts** come from Google Fonts. If they're offline, the system fallbacks still look clean.

## 10. Build phases and acceptance criteria

Every phase ends with three things:
1. `npm run check`: build, plus strict typecheck and lint of shared, server and client, plus all tests.
2. The e2e smoke test with zero console errors or warnings.
3. A playtest guide with exact commands.

PROGRESS.md is updated each time.

### Phase 1: Foundation and networking
**Build:**
- Monorepo, config, math, World and ECS, movement, dash, basic shots, collisions, and the 12-sided arena with a few pillars (simple placeholder-free visuals: clean glowing circles and lines, ahead of the full Phase 3 look).
- The authoritative server loop, rooms with 5-letter codes, `?room=` links, lobby (names, colors without duplicates, ready, host start, kick), and the 30 Hz delta snapshots.
- Prediction, reconciliation and interpolation on the client, plus own-projectile prediction, lag compensation, the F2 net panel and the network simulator.

**Done when:**
- Two tabs create and join a room, ready up, start, and both move and shoot. Each sees the other moving smoothly, and hits register and kill.
- At 150 ms simulated latency plus 30 ms jitter, the local player feels instant: zero visible snaps, and fewer than 2 corrections over 5 units per minute while moving and dashing.
- F2 shows live ping, tick, snapshot rate, bandwidth and corrections.
- Invalid inputs and spam are rejected (unit-tested).
- `npm run check` is green with no console errors.

### Phase 2: Bots
**Build:** the bot brain (perception, utility actions, steering, aim with error, dash dodging, cover, zone awareness ready for Phase 6), the "Fill with bots" toggle, and the difficulty setting.

**Done when:**
- From one tab you can start a 5-player game against 4 bots and have a real fight.
- Bots strafe, dodge visibly, break line of sight behind pillars, and miss believably on Easy.
- A headless test runs 50 bot-only rounds with no exceptions and no stuck bots (each bot moves at least 80% of the time).

### Phase 3: Juice
**Build:** the full Neon Void renderer (starfield, hex floor with ripples, glow sprite cache, cores with rotating cracked shells and trails, names), particle pools, impacts, damage numbers, trauma shake, hit-stop, chromatic flash with zoom punch, the camera with mouse lead, and positional synthesized SFX for everything that exists so far.

**Done when:**
- A 5-player bot fight holds 60 fps with 2,000+ particles (shown on the F1 FPS readout and in the e2e frame-time report).
- Every action has a sound that pans and falls off with distance.
- Shake and hit-stop only trigger for nearby or own events.
- The screenshot review shows no flat, unlit gameplay elements.

### Phase 4: Powers
**Build:** the Power interface and registry, status effects, all 18 powers with unique visuals, icons and sounds, network sync, Q/E (and LB/RB) casting, the cooldown HUD with radial sweeps, and bot hints for every power.

**Done when:**
- Every power has a unit test for its core behavior.
- An e2e "power gallery" test casts each power at 100 ms simulated latency, and the casting client sees its effect with no desync (server and client state match within tolerance).
- Bots use all 18 across a seed sweep.
- Every power is readable from the other player's screen (screenshot review).

### Phase 5: Ultimates, combos, draft, points, standings
**Build:**
- The ultimate pick (1 of 3), all 6 ultimates with their meter and pulse, and the 6 combos with COMBO! and STOLEN COMBO! labels and chords.
- The draft cards with a 15 s timer, auto-pick, hidden picks, the flip reveal, the older-slot replacement, and the comeback 4th card.
- Placement and kill points, standings between rounds, first to 15, and the tie-breaks.

**Done when:**
- A full match against bots plays all the way through from ultimate pick to match end.
- Each combo has a scripted test that triggers it, including the stolen variant.
- Every draft rule is unit-tested.

### Phase 6: Battle royale systems
**Build:**
- The 5-stage shrinking zone with warnings and its crackling wall, and pickups including Prism Core.
- The 3 arena layouts scaled by player count, with destructible synced pillars.
- Ghosts with spectate and haunt.
- The kill feed with power icons, the minimap with range and fire-reveal rules, and the slow-mo final-blow replay.
- The match end screen (winner flood, podium, full stats, Most Chaotic Moment, Rematch and Main Menu), the adaptive synthwave music, and the full settings screen (volumes, shake, rebinding, colorblind shapes, ping toggle).

**Done when:**
- Bots stay in the zone.
- Pillars break identically on every client.
- Ghosts can haunt with labeled hazards.
- The replay shows the actual killing blow.
- Music intensifies over a round.
- Every setting persists and takes effect immediately.

### Phase 7: Hardening and polish
**Build:**
- Disconnect and rejoin (30 s), host migration, and full rate limiting with fuzz tests that throw garbage messages at the server.
- A bandwidth profile (a report per scenario) and a performance profile (frame-time percentiles).
- A visual consistency pass on every screen.
- **F1 debug mode:** hitboxes, FPS and timing, and grant any power or ultimate to any player in a local test room.

**Done when:**
- Killing a tab mid-round and reopening it within 30 s restores the player.
- The fuzz test can't crash the server.
- Bandwidth is under 8 KB/s per client in a worst-case 5-player fight.
- Frame time is under 16.7 ms at the 95th percentile in the stress scene.
- There are no console warnings anywhere.

### Phase 8: Deployment and CoolMattGames
**Build:**
- The server serves the built client from the same origin (the WebSocket URL derives from `location`, with an override env var).
- A `/healthz` endpoint, a production config, and a Dockerfile plus `render.yaml`.
- Step-by-step deploy docs for **Render (free)** (recommended), with Fly.io and Railway as alternatives.
- The env vars: `PORT`, `PUBLIC_WS_URL` (optional), `NODE_ENV`, `LOG_LEVEL`, `MAX_ROOMS`.
- The CoolMattGames entry: id, name, description, url, creator, tags and color, with a cover screenshot like the other games.

**Done when:**
- Friends can open one public URL, create and join rooms, and play.
- The health check passes on the host.
- The game appears on CoolMattGames (after you OK the push to Matthew's repo).

**What to expect from free hosting:** Render's free tier sleeps after about 15 minutes idle, so the first visit takes about 30–50 s to wake. Fly.io avoids that for a few dollars a month. The docs will cover both.

## 11. Risks and how I'll handle them

- **Scope.** 18 powers, 6 ultimates and 6 combos is a lot of game. The power interface and context helpers keep each one small, and every power gets a test and a gallery check, so they don't quietly break each other.
- **Netcode feel.** I'll tune the interpolation delay, correction smoothing and input merging against the simulator at 150 ms latency before building anything on top (end of Phase 1).
- **Canvas performance.** Everything is cached sprites and pooled particles from day one, and the F1 readout keeps it honest.
- **Determinism between client and server.** Prediction only covers your own movement, dash and shots, the code that's easy to keep identical. Everything else is authoritative and interpolated.

---

## 12. Version 2: combat overhaul (looter-shooter)

After playing v1 you said the UI is right but the combat gets boring: floating cores with one weak gun on an empty arena. v2 keeps the look (menus, draft cards, HUD style, neon palette, audio engine, netcode) and rebuilds what you actually do in a match. Your answers on 2026-10-19: **keep powers and ultimates**, **floor loot + crates**, **chibi heroes**, **one long round**.

Work happens on branch `v2-combat` so v1 on `master` stays playable.

### 12.1 Mini characters
- Top-down chibi heroes: big head with hair or headgear, small body, two hands gripping whatever they hold, pointed at your aim. Walk bob, footstep dust, recoil kick, reload animation, hit flash, a death pop.
- **8 heroes** to choose from in the lobby (look only, same stats, so the game stays fair). Each wears your player color as an outline glow so you can still tell people apart at a glance.
- Hitbox stays a circle (radius 22) so netcode and hit detection stay exact.

### 12.2 Weapons and gear (found, not given)
Everyone drops in with a **Pistol**. Everything else is on the floor, in crates, or in supply drops.

| Weapon | Feel |
|---|---|
| Pistol | Accurate, unlimited reserve ammo, the fallback |
| SMG | Very fast fire rate, spread grows while firing, short range |
| Assault Rifle | All-rounder, 30-round mag |
| Shotgun | 8 pellets, brutal up close, useless far away |
| Sniper | Huge damage, slow bolt, pierces 1 target, right-click scope zooms the camera |
| Rocket Launcher | Splash damage, knockback, breaks crates and cover walls |
| Prism Lance | Neon laser: hold to charge, beam bounces once off walls |
| Energy Blade | Melee: dash slash with a wide arc, deflects bullets during the swing |

- **Rarity** (gray, blue, purple, gold) adds damage and magazine size, shown as the glow color of the item on the floor.
- **Inventory**: 2 weapon slots (1/2 or scroll to swap), 1 throwable slot, heals, armor.
- **Throwables**: Frag grenade, Smoke grenade (blocks vision), Shock mine.
- **Healing and armor**: Bandage (small, fast), Medkit (big, slow), Shield Cell (armor that absorbs damage first, up to 50).
- Magazines and reloading. Ammo comes from ammo boxes and crates. Kills drop the victim's whole loadout as a loot pile.
- **Supply drops** fall from the sky a few times per match (announced on the minimap) with purple and gold gear. Whoever gets there first wins the fight for it.

### 12.3 Maps with real terrain
- One big map instead of the small polygon: about 6000 x 6000 units for up to 10 fighters (humans plus bots filling empty seats).
- **Two maps**, hand-built from reusable prefabs with seeded variation each match:
  - **Neon City**: buildings with doorways and rooms (the roof fades when you walk in), alleys, a plaza, fences, parked hover cars as cover.
  - **Crystal Wilds**: forest of bushes and rocks, a river that slows you, bridges, ruins, crystal caves.
- Terrain:
  - **Walls** block movement and bullets.
  - **Low cover** blocks bullets but you can see over it.
  - **Bushes** hide you until someone is close or you shoot.
  - **Crates** break and drop loot. **Explosive barrels** blow up when shot.
  - **Glass** shatters. **Water** slows you down.
- **Line of sight**: walls cast shadows. You can't see around a corner, and the server doesn't send you players you can't see. That makes flanking and holding angles matter, and stops wallhacks.

### 12.4 One long round
- **Before the match**: pick your ultimate and draft your first power, using the existing screens.
- **During the match**: rare **Prism Shards** (in crates and supply drops) open the draft cards as an in-game overlay, without pausing. You get a second power, or upgrade or replace one.
- The zone shrinks in 6 stages, so a match lasts about 2 to 4 minutes (the last circle closes about 3:15 in).
- When you die, you spectate your killer (or haunt as a ghost, as in v1). You can leave or wait for the match to end.
- **Results**: placement plus kills, on the same podium screen. Rematch drops everyone into a fresh map seed.
- First to 15 points and between-round standings are removed.

### 12.5 Powers and ultimates in the new world
All 18 powers and 6 ultimates stay. Anything that touched "basic shots" now works on any gun's bullets: Ricochet Prism, Magnetar, Overdrive, Hunter's Eye, Echo Storm, Third-Party and Void Cloak's crit. Anything that used crystal pillars uses walls and cover instead:
- Shockwave Slam: hitting a wall does slam damage.
- Glaive: bounces off walls.
- Meteor Rain and Rift: break cover.

Numbers get retuned so a power complements your gun rather than replacing it.

### 12.6 Controls (all rebindable in Settings)
- WASD: move. Left click: shoot. Right click: scope or aim down sights.
- R: reload. F: pick up or open. 1/2 or scroll: swap weapon.
- G: throwable. H: heal (hold). Space: dash.
- Q/E: powers. **X: ultimate** (it moves off R, since R becomes reload).

### 12.7 Bots
Navigation grid and A* pathfinding around walls. Bots loot (go for better guns, open crates, heal when hurt), use cover and bushes, rotate ahead of the zone, fight over supply drops, and use the existing per-power tactics.

### 12.8 Phases (each ends with typecheck, lint, tests, build, screenshots)
1. **Map engine**: rectangle and circle geometry, a spatial grid for collisions on a big map, line of sight and shadows, all terrain types, both maps, and neon-style terrain rendering.
2. **Weapons and loot**: weapon definitions and rarity, firing patterns, reload, crates, floor loot, inventory, throwables, heals and armor, supply drops, death loot piles. Netcode for items, and the HUD for inventory and ammo.
3. **Mini characters**: hero renderer, 8 heroes, animations, hero select in the lobby.
4. **Match flow**: one long round, bot fill up to 10, zone retune, pre-match draft, in-match shard drafts, spectating, results.
5. **Powers pass**: adapt every power and ultimate to guns and walls, then retune.
6. **Bots**: pathfinding, looting, cover, zone rotation.
7. **Polish**: a distinct sound per weapon, hit feedback, how-to-play update, e2e screenshots and a full bot match test. Then push the branch.

### 12.9 Implementation notes (phases 1, 2 and the core of 4)
- **Maps** are generated from (map id, seed) on both server and clients (integer, RNG-only prefabs in `shared/src/sim/map/`), so only the id and seed go over the network. Destructibles (crates, barrels, glass, fences) sync their hp/broken state; damaged ones are always sent.
- **Collision** uses a uniform grid; players are circles resolved against axis-aligned rects with sliding and sub-steps; bullets sweep as segments against rects expanded by their radius.
- **Line of sight**: walls, rocks and crystals block sight; cover, crates, cars and glass don't (bullets still stop). Smoke clouds block sight too. The server only sends players a viewer could see (with a small corner margin), and the client draws matching shadows.
- **Prism Lance** is a hitscan beam traced on release (pierces players, bounces once off a wall, damage scales with charge), shown with short-lived beam effects. No projectile to predict, and it can't tunnel.
- **Hands logic** (trigger, reload, swap, heal channel, throws) is a pure per-input-frame function shared by the server and client prediction, so predicted shots, ammo and timers match the server. Predicted bullet spread is a hash of the shot id, so the client draws the same pellets the server fires.
- **Match**: one round; bots fill to 10; the zone has six stages that finish closing about 3:15 in; supply drops at 45, 95 and 145 seconds; a short victory beat, then results. Standings, between-round drafts and the final-blow replay are gone.

### 12.10 Playtest round two (2026-10-19)
- **Rooms of 10**: up to 10 humans per room and 10 fighters per match (bots fill the empty seats). All ten player colors are pickable; the five new ones (Orange #FF8A2B, Mint #2BFFC0, Pink #FFA6EC, Red #FF3B3B, Pearl #FFFFE0) each have their own colorblind marker (star, hex, ring, x, bowtie) and stay at a CIEDE2000 distance of 20+ from every other player and rarity color. The lobby shows ten compact seats in two columns.
- **Leaving after you die**: an eliminated player can go back to the room's lobby while the match carries on (the server keeps their stats and placement and stops sending them snapshots); the lobby shows the match's alive count and clock, and afterwards your own placement and kills. The host can't start a new match until the current one ends. Practice leaves to the main menu. People who join mid-match wait in the lobby.
- **Exit to the title screen**: a MENU button in the match HUD and Esc open a menu (Resume, Settings, How to play, Exit to main menu, and Back to room lobby when you're out). Leaving while alive asks first, and counts as a forfeit: you're eliminated where you stand, the last attacker gets the kill, your loot drops and your seat is freed. Nothing ever navigates the page away (the game runs inside a portal iframe).
- **Less loot clutter**: about 23% fewer floor items (spot fill 0.85 to 0.66), crates drop 1.7 items on average (was 2), and ammo, heals, shield cells and same-type grenades dropped near a matching pile stack into it with a count.
- **150 HP**: no single normal hit kills from full health. Heals scale with it (bandage 22, medkit 90), bot health thresholds scale with it, and ultimate charge per damage dropped 30% so ultimates come about as often as before.
