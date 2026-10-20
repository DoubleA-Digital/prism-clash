# Prism Clash

A neon top-down looter-shooter battle royale in the browser. Twelve fighters (up to 5 humans, bots fill the rest) drop onto a big map with a pistol, loot weapons, shields, heals and grenades, draft wild powers, and fight until one is left standing. Bots fill empty seats, so you can play a full match alone.

## Play locally

```bash
pnpm install
pnpm dev          # game server on :8787 + client on :5173
```
Open <http://localhost:5173>, enter a name, then:
- **Practice vs bots**: an instant 12-fighter match against 11 bots (`?map=crystalWilds` or `?map=neonCity` pins the map).
- **Create room**: share the 5-letter code (or the **Copy invite link** button) with friends; each player joins from their own browser.

## Controls

| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move / aim | WASD / mouse | Left stick / right stick |
| Shoot (the Prism Lance charges while held) | Left click | RT |
| Scope (sniper) | Right click | LT |
| Reload | R | B |
| Pick up / swap weapon | F | X |
| Weapon 1 / 2 / switch | 1 / 2 / mouse wheel | D-pad right |
| Throw grenade | G | D-pad down |
| Heal (hold) | H | D-pad up |
| Dash (brief invincibility) | Space | A |
| Powers | Q / E | LB / RB |
| Ultimate (when the ring is full) | X | Y |
| Scoreboard | Tab | — |
| Ghost: switch spectate / drop lava / drop slow field | ← → or click / Q / E | — |

Every key can be rebound in **Settings**.

## How a match works

1. Everyone picks an **ultimate** (1 of 3) and drafts a first **power** (1 of 3).
2. One long round on **Neon City** (buildings with rooms and roofs, alleys, plaza, parking lots) or **Crystal Wilds** (a river with bridges, rocks, ruins, crystals, bushes). Each match uses a fresh seed, so layouts vary.
3. Loot: Pistol, SMG, Assault Rifle, Shotgun, Sniper, Rocket Launcher, Prism Lance and Energy Blade in four rarities (common, rare, epic, legendary), plus Shield Cells, bandages, medkits, frag and smoke grenades and shock mines. Crates break open, barrels explode, glass shatters. Kills drop the whole loadout.
4. Walls cast line-of-sight shadows and bushes hide you until you shoot. **Supply drops** fall a few times per match with epic and legendary gear, and rare **Prism Shards** open a mid-match power draft.
5. The zone closes in six stages (a match lasts about 6 to 8 minutes) and its center moves every stage. Last one standing wins; results show placement, kills, damage and more.
6. Dead players spectate their killer (or anyone alive) and can haunt as **ghosts**: every 10 s drop a small lava puddle or slow field.

**18 powers:** Chrono Rewind, Singularity, Mirror Self, Portal Pair, Storm Tether, Time Bubble, Ricochet Prism, Phantom Mark, Hex Swap, Magnetar, Void Cloak, Molten Path, Boomerang Glaive, Gravity Flip, Bounty Beacon, Decoy Swarm, Shockwave Slam, Third-Party.
**6 ultimates:** Meteor Rain, Overdrive, Rift Collapse, Echo Storm, Final Stand, Hunter's Eye.

## Debug tools

- **F2**: network panel (ping, server tick, snapshot rate, bandwidth, prediction corrections) and a **network simulator** (latency, jitter, packet loss) to try bad connections on one machine.
- **F1**: FPS/frame time, hitboxes. In a test room (open the game with `?test=1`, then create a room) it can grant any power or ultimate to any player, or a legendary weapon kit (**Loadout**).

## How it's built

```
shared/   game simulation (movement, combat, all powers/ultimates/combos), config.ts with every tunable number, network protocol
server/   Node + ws: authoritative 30 Hz rooms, lobby/draft/round state machine, bots, lag compensation, validation + rate limits
client/   Vite + TypeScript + Canvas 2D (no engine): prediction/interpolation, renderer, particles, synthesized audio, UI
```

- **Authoritative server:** clients only send inputs; the server decides every hit, death and pickup.
- **Netcode:** your movement, dash and shots are predicted instantly and reconciled smoothly with the server; everyone else is interpolated about 100 ms in the past; hits use lag compensation (the server rewinds targets by your latency, capped at 200 ms); snapshots are delta-compressed binary (msgpack), about 5 KB/s per player.
- **Everything is generated:** visuals are drawn in code, audio is synthesized with WebAudio, music is procedural synthwave that intensifies as the zone closes.
- **Adding a power:** one file in `shared/src/powers/` (logic, icon, bot hint) + its visual in `client/src/render/powers/` + one line in each registry.

## Scripts

```bash
pnpm dev          # play locally
pnpm check        # typecheck all three packages, lint, tests, production build
pnpm test         # unit + simulation tests (powers, combos, rules, netcode, fuzzing)
node e2e/practice.mjs           # browser playtest vs bots, screenshots in e2e/out
node e2e/two-tabs.mjs --latency 150   # two players at simulated 150 ms, reports corrections
```

## Deploy

See [DEPLOY.md](DEPLOY.md): Render (free), Fly.io, Railway or Docker. One process serves the game and the WebSocket server; `/healthz` is the health check.
