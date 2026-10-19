# Prism Clash

A neon top-down battle royale for 2–5 players in the browser. Draft wild powers between rounds, fight in a shrinking arena, and be the last one standing. Placement and kills earn points; first to 15 wins the match. Bots fill empty seats, so you can play a full match alone.

## Play locally

```bash
pnpm install
pnpm dev          # game server on :8787 + client on :5173
```
Open <http://localhost:5173>, enter a name, then:
- **Practice vs bots**: an instant 5-player match against 4 bots.
- **Create room**: share the 5-letter code (or the **Copy invite link** button) with friends; each player joins from their own browser.

Open two browser tabs to play against yourself.

## Controls

| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Aim | Mouse | Right stick |
| Shoot (5-shot clip, reloads one at a time) | Left click | RT |
| Dash (brief invincibility) | Space | A |
| Powers | Q / E | LB / RB |
| Prism Core 3rd power | F | X |
| Ultimate (when the ring is full) | R | Y |
| Scoreboard | Tab | — |
| Ghost: switch spectate / drop lava / drop slow field | ← → or click / Q / E | — |

Every key can be rebound in **Settings**.

## How a match works

1. Each player picks an **ultimate** (1 of 3) that they keep all match.
2. Before each round, everyone **drafts a power** from 3 cards at the same time (4 cards if you're in last place). You hold two; a new pick replaces your older one. Round 1 drafts twice.
3. The round: the safe zone starts closing after 30 s in 5 stages. Pickups spawn every 12 s: health, cooldown reset, ult charge, and the rare **Prism Core** (a 3rd power for the round). Purple **nebula clouds** hide you from distant enemies until you shoot. Knock enemies into walls for bonus damage.
4. The last player alive wins the round. Points: 1st 5, 2nd 3, 3rd 2, 4th 1, 5th 0, plus 1 per kill. A slow-motion replay shows the final blow, then standings.
5. Dead players become **ghosts**: spectate, and every 10 s drop a small lava puddle or slow field (marked with your color).

**18 powers:** Chrono Rewind, Singularity, Mirror Self, Portal Pair, Storm Tether, Time Bubble, Ricochet Prism, Phantom Mark, Hex Swap, Magnetar, Void Cloak, Molten Path, Boomerang Glaive, Gravity Flip, Bounty Beacon, Decoy Swarm, Shockwave Slam, Third-Party.
**6 ultimates:** Meteor Rain, Overdrive, Rift Collapse, Echo Storm, Final Stand, Hunter's Eye.
**6 combos** (with STOLEN COMBO! when you use someone else's effect): Prism Portal, Event Horizon Blade, Frozen Harvest, Lava Lock, Gravity Slam, Storm Gate.

## Debug tools

- **F2**: network panel (ping, server tick, snapshot rate, bandwidth, prediction corrections) and a **network simulator** (latency, jitter, packet loss) to try bad connections on one machine.
- **F1**: FPS/frame time, hitboxes. In a test room (open the game with `?test=1`, then create a room) it can grant any power or ultimate to any player.

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
