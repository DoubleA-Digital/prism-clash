# PROJECT: PRISM CLASH — ONLINE BATTLE ROYALE

A fast, beautiful, competitive top-down arena battle royale for 2–5 players online. Each player joins from their own browser using a room code. Players draft wild powers between rounds and fight in a shrinking neon arena until one is left standing. Points are awarded by placement each round; first to 15 points wins the match.

## HOW TO WORK

1. Before writing code, read this entire spec and produce PLAN.md: folder structure, networking model, message protocol, core systems, and the build phases below with acceptance criteria for each. Wait for my approval.
2. Build one phase at a time. At the end of each phase: run the build and type-check for client, server, and shared code; fix all errors; then give me a short summary of what to playtest and exactly how to run it.
3. Never leave placeholder art, stubs, or TODOs in a finished phase. All visuals are generated in code; all audio is synthesized.
4. Keep every tunable number (damage, cooldowns, speeds, radii, tick rates, zone timings, points) in shared/config.ts.
5. If something in this spec is ambiguous or technically problematic, make a sensible decision, document it in PLAN.md, and keep going.

## TECH STACK & ARCHITECTURE

- Monorepo with three packages: /client, /server, /shared. TypeScript strict mode everywhere, no "any".
- Client: Vite + TypeScript + HTML5 Canvas 2D. No game engine. Zero external image or audio assets.
- Server: Node.js + TypeScript + the "ws" WebSocket library. Authoritative server: the server owns the true game state and decides all hits, damage, deaths, and pickups. Clients only send inputs.
- /shared contains the game simulation (movement, physics, collisions, powers, projectiles), entity definitions, config, and the network message types, so client and server run identical logic.
- Server simulation runs at a fixed 30 ticks/sec. Clients render at the display's refresh rate.
- Entity/component style architecture. Powers are plug-in modules implementing a shared interface (id, name, description, icon draw function, cooldown, onCast, onUpdate, onHit, onExpire, serialize/deserialize for network state). Adding a new power requires only one new file plus a registry entry.
- Object pooling for projectiles and particles. Client must hold 60fps with 5 players, heavy effects, and 2,000+ particles on a mid-range laptop.
- Seeded RNG on the server for all gameplay randomness.

## NETCODE (must feel smooth at 100ms ping)

- Clients send input packets every frame (movement vector, aim angle, buttons pressed, input sequence number).
- Client-side prediction for the local player's movement and dash, with server reconciliation: when a server snapshot arrives, rewind the local player to the server's state and replay unacknowledged inputs. Corrections must be smoothed, never snapping visibly unless the error is large.
- Remote players and server-owned entities are rendered with snapshot interpolation about 100ms in the past for smooth motion.
- The local player's own projectiles appear instantly on the client (predicted), then are reconciled with the server's authoritative versions.
- Lag compensation for hit detection: the server rewinds other players' positions by the shooter's latency (capped at 200ms) when checking hits.
- Snapshots only include changed data (delta compression) and use a compact binary or msgpack encoding. Keep bandwidth reasonable for 5 players.
- Server validates every input: clamp movement, enforce cooldowns server-side, rate-limit messages, and ignore impossible actions.
- Handle disconnects gracefully: a disconnected player's core goes idle and dims; they can rejoin with the same session within 30 seconds. If the host leaves, the room continues.
- Debug network panel (toggle F2): ping, server tick, snapshot rate, bandwidth, prediction corrections, plus a network simulator that adds artificial latency, jitter, and packet loss so I can test bad connections locally.
- Hit-stop, screen shake, and slow-motion are client-side visual effects only. They never pause or alter the server simulation.

## LOBBY & ROOMS

- Main menu: enter a display name (sanitized, max 16 characters), then Create Room or Join Room.
- Creating a room generates a 5-letter room code. Joining requires the code. Max 5 players per room.
- Lobby screen shows each player as their glowing core in their chosen color, with a ready toggle. The host can start when 2+ players are ready, kick players, and toggle "Fill with bots."
- Players choose from 5 distinct colors (cyan #00F0FF, magenta #FF2E88, lime #9DFF3A, gold #FFC83D, violet #A970FF); no duplicates in a room.
- Shareable invite link: visiting the URL with ?room=CODE jumps straight to joining.

## AI BOTS

- Server-side bots that can fill empty slots. They move, dodge projectiles, use cover, pick powers in the draft, use powers and ultimates sensibly, and stay inside the safe zone.
- Three difficulty levels in lobby settings. Bots must be fun to play against, not perfect aimers: add reaction delay and aim error.
- Bots are essential for testing; I should be able to play a full 5-player match alone against 4 bots.

## ART DIRECTION: "NEON VOID"

- Dark, deep-space background with a slowly drifting 3-layer parallax starfield and a faint animated hex grid on the arena floor that ripples outward from explosions.
- Everything gameplay-related glows. Use additive blending and pre-rendered glow sprites cached to offscreen canvases for performance.
- Players are sleek geometric "cores": a glowing inner orb inside a rotating angular shell, with a motion trail, in their player color. The shell cracks visibly as health drops. Each player's name floats above their core.
- Each power has its own signature color and visual language.
- The arena scales with player count. It has glowing edges and destructible crystal pillars that shatter into particles (pillar destruction is server-authoritative and synced).
- Typography: a bold geometric display font from Google Fonts for titles, a clean mono font for numbers, with fallbacks.

## GAME FEEL ("JUICE") — CRITICAL

- Brief client-side hit-stop on big hits you deal or receive.
- Trauma-based screen shake (shake = trauma²), only for events near you, with a settings slider.
- Chromatic-aberration flash and zoom punch on ultimate casts and your own kills.
- Damage numbers that pop and arc; crits are bigger and gold.
- Projectile trails; impacts spawn sparks, shockwave rings, and floor ripples.
- When the final opponent of a round dies, the round ends and all clients play a cinematic slow-motion replay of the killing blow (from recorded snapshots) with a zoom on the winner.
- Camera follows the local player smoothly with slight lead toward the mouse. A minimap in the corner shows the zone and player positions (only players within a certain range, or briefly revealed when they fire).
- Every action has a synthesized sound with positional panning and distance falloff based on where it happened relative to you. Includes a looping procedural synthwave track (bass + arpeggio + kick) that intensifies as the zone shrinks and as fewer players remain.

## CONTROLS (each player on their own device)

- Keyboard + mouse: WASD move, mouse aim, Left Click shoot, Space dash, Q power 1, E power 2, R ultimate, Tab scoreboard.
- Gamepad (Gamepad API): left stick move, right stick aim, RT shoot, A dash, LB/RB powers, Y ultimate.
- Rebindable controls in settings.

## CORE COMBAT

- 100 HP, a basic projectile attack with a short fire-rate cooldown, a dash with brief invulnerability frames on a short cooldown.
- Ultimate meter fills by dealing and taking damage. When full, it pulses and the player's shell glows brighter.
- Kill credit goes to whoever dealt the last damage within 5 seconds, including through hazards and lava. A kill feed in the corner shows "Killer ⟶ Victim" with the power icon used.

## POWERS (draft pool — every power must feel spectacular and readable for all players)

Each needs a unique visual, sound, and icon. All numbers go in config.

1. CHRONO REWIND — Snap back to where you were 2.5s ago, restoring HP lost in that window. A ghostly afterimage trail shows your rewind path to everyone. CD 14s.
2. SINGULARITY — Throw a slow orb that collapses into a black hole after 0.8s, pulling all players and projectiles inward for 2.5s and bending bullet paths, then detonating for 25 damage. CD 16s.
3. MIRROR SELF — Spawn a clone that moves opposite to your movement and fires real shots at 40% damage toward your aim point. Enemies can't tell which is real (both show your name). Recast to swap places with the clone. Lasts 6s. CD 18s.
4. PORTAL PAIR — First cast places an orange portal at your position, second cast places a blue one. Every player and projectile can use them, keeping momentum. Portals last 10s. CD 15s.
5. STORM TETHER — Fire a lightning bolt; on hit, you're chained to that enemy. If they move too far away, the tether snaps for 30 damage. Both take light chip damage while tethered. CD 13s.
6. TIME BUBBLE — A zone where everything except you moves at 25% speed, including enemy projectiles. Your shots leaving the bubble accelerate. Lasts 4s. CD 17s.
7. RICOCHET PRISM — For 6s your shots bounce off walls and pillars up to 4 times, gaining damage and shifting color each bounce (rainbow on the last). CD 14s.
8. PHANTOM MARK — Dash through an enemy, leaving a sigil that detonates after 1.5s for 20 damage, doubled if you shoot them before it pops. CD 11s.
9. HEX SWAP — Swap positions with the nearest enemy in your aim direction. Projectiles headed at you retarget to them. CD 20s.
10. MAGNETAR — Capture incoming projectiles into an orbit around you; recast to fire them all outward as your own. Lasts up to 5s. CD 15s.
11. VOID CLOAK — Nearly invisible (faint shimmer) for 3s and hidden from the minimap. Your first shot out of cloak is a guaranteed crit. Taking damage breaks it. CD 16s.
12. MOLTEN PATH — For 4s you leave a lava trail that burns enemies and lingers for 3s. CD 13s.
13. BOOMERANG GLAIVE — A spinning blade that curves out and returns, hitting on both passes. Catch it to reset the cooldown instantly. CD 8s.
14. GRAVITY FLIP — Fire a swirling orb; any enemy it hits has inverted movement for 2.5s. CD 19s.
15. BOUNTY BEACON — Mark the player with the most points this match: they glow gold for everyone for 6s, and anyone who damages them gains ultimate charge. CD 22s.
16. DECOY SWARM — Release 5 small holographic copies of yourself that scatter, absorb one hit each, and pop into blinding sparks. CD 15s.
17. SHOCKWAVE SLAM — Leap briefly into the air (immune to ground hazards), then slam down, knocking back everyone nearby into walls (wall impacts deal bonus damage). CD 12s.
18. THIRD-PARTY — For 5s, you deal double damage to any enemy who is currently being damaged by someone else. Built for battle royale vultures. CD 18s.

## ULTIMATES (each player picks 1 of 3 offered at match start)

- METEOR RAIN — 12 meteors crash across a wide marked area over 3s with warning circles.
- OVERDRIVE — 6s of double fire rate, all power cooldowns reset, white-hot lightning aura.
- RIFT COLLAPSE — Tear a glowing rift across the arena that pulls everyone toward it for 3s, then slams shut for massive damage to anyone near it.
- ECHO STORM — Every power you cast in the next 8s is cast twice.
- FINAL STAND — Invulnerable 3s while charging, then a huge shockwave whose damage scales with damage absorbed.
- HUNTER'S EYE — For 8s, see every enemy on the minimap and through Void Cloak, and your shots gently home toward the nearest enemy.

## POWER COMBOS (implement explicitly; show a floating "COMBO!" label with the name and a special sound)

- Ricochet shots that pass through a Portal keep their bounce count.
- Singularity pulls Boomerang Glaive into orbit, hitting repeatedly.
- Magnetar can capture projectiles slowed by Time Bubble.
- Hex Swap into your own Molten Path traps the enemy on lava.
- Shockwave Slam knocking an enemy into a Singularity doubles its detonation damage.
- Storm Tether still connects through Portals.

Combos can be triggered with other players' effects too (e.g., using someone else's portal), which should be credited as "STOLEN COMBO!"

## DRAFT SYSTEM

- Before each round, every player is shown 3 random powers as large animated cards (icon, name, description, cooldown). Duplicates across players are allowed, but no player sees a duplicate within their own offer.
- Players pick simultaneously within a 15-second timer (auto-pick if time runs out). Picks are hidden until everyone locks in, then all loadouts are revealed together with a flip animation.
- Each round, the new pick replaces the older of a player's two slots.
- Comeback mechanic: the player(s) in last place on points get 4 options instead of 3.

## BATTLE ROYALE STRUCTURE

- Placement points per round: 1st = 5, 2nd = 3, 3rd = 2, 4th = 1, 5th = 0. Plus 1 point per kill. First to 15 points wins; show standings between rounds.
- Players spawn evenly spaced around the arena edge.
- Shrinking safe zone: starts closing at 30s, shrinks in stages toward a randomly chosen final position, rendered as a crackling energy wall. Damage outside the zone increases each stage. A warning timer shows when the next shrink begins.
- Neutral pickups spawn every 12s: health shard (+20), cooldown reset, ultimate charge, and a rare "Prism Core" that grants a random third power for the rest of the round.
- 3 arena layouts sized for player count: "Shattered Grid" (scattered pillars), "Twin Cores" (two massive central pillars), "Open Void" (almost no cover).

## ELIMINATED PLAYERS (keep them engaged)

- Dead players become ghosts that can spectate any surviving player (cycle with click/arrows).
- Ghost Haunt: every 10s a ghost can drop one small neutral hazard (a brief lava puddle or a slowing field) anywhere visible. Hazards are clearly labeled with the ghost's color so everyone knows who dropped them. Ghosts cannot directly damage players.

## UI & FLOW

- Animated title screen: logo with glow pulse, starfield, menu (Play, Settings, How to Play). Keyboard, mouse, and gamepad navigable.
- Settings: name, master/music/SFX volume, screen shake intensity, rebind controls, colorblind-friendly mode (shape markers per player), show/hide ping.
- Flow: Lobby → Ultimate select → Draft → 3-2-1-FIGHT → Round → Slow-mo replay → Standings → Draft → ... → Match end.
- In-match HUD: your health bar (with delayed white "damage taken" bar), two power icons with radial cooldown sweeps, ultimate meter, players remaining, zone timer, kill feed, minimap, ping. Small health bars above other players. HUD stays at the screen edges and never covers the action.
- Tab scoreboard: points, kills, damage, placements per round.
- Match end: winner's color floods the screen, podium for top 3, full stats (damage, kills, powers used, combos, accuracy, "Most Chaotic Moment" based on most damage in 3 seconds). Buttons: Rematch (returns everyone to the lobby) and Main Menu.
- Responsive scaling to any window size with graceful letterboxing.

## BUILD PHASES

- **Phase 1 — Foundation & Networking:** monorepo setup, shared simulation, authoritative server, room creation/joining with codes, lobby, players moving and shooting online with client-side prediction, reconciliation, and interpolation. Two browser tabs on my machine must be able to play together smoothly. Include the network debug panel and latency simulator.
- **Phase 2 — Bots:** server-side AI so I can test full 5-player matches alone.
- **Phase 3 — Juice:** rendering, glow, particles, screen shake, hit-stop, trails, damage numbers, camera, starfield, floor ripples, positional synthesized SFX.
- **Phase 4 — Powers:** power interface and registry, all 18 powers networked and synced correctly, cooldown HUD. Verify each one works with 100ms simulated latency.
- **Phase 5 — Ultimates, combos, draft system, points, standings.**
- **Phase 6 — Battle royale systems:** shrinking zone, pickups, arenas, ghosts and haunting, kill feed, minimap, slow-mo replay, match end screen, music, settings.
- **Phase 7 — Hardening & polish:** disconnect/reconnect handling, input validation and rate limiting, bandwidth profiling, performance profiling, visual consistency pass. Add a debug mode (F1) showing hitboxes and FPS that lets me grant any power to any player in a local test room.
- **Phase 8 — Deployment:** make the server also serve the built client, add a production config, and give me step-by-step instructions to deploy it for free or cheaply (e.g., Render, Railway, or Fly.io) so friends can join via a public URL. Include environment variables, the WebSocket URL configuration, and a health-check endpoint.

## QUALITY BAR

- No console errors or warnings on client or server. Strict TypeScript, no "any".
- Movement feels instant for the local player even at 150ms simulated ping.
- 60fps client rendering in a 5-player fight with ultimates firing.
- Every power is readable: all players can see what's happening and react.
- It should look and feel like a polished indie game on Steam, not a prototype.

## EXTRA NOTES FROM THE USER

- "George's website is a great example of the graphics you can do. I want this to be really enjoyable, so do your best and take your time."
- When it's deployed, add it to CoolMattGames (`projects/coolmattgames/public/games.js`).
