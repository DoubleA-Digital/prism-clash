# Deploying Prism Clash

One Node process serves everything: the built game (static files), the WebSocket game server at `/ws`, and a health check at `/healthz`. The client connects to the same host it was loaded from, so there's no URL to configure.

You can also host the client as a static site (Vercel) and run only the game server on Render. See [Vercel (static client) + Render (game server)](#vercel-static-client--render-game-server). Practice vs Bots needs no server at all: it runs in the browser.

## Option A: Render (free, recommended)

1. Push this repo to GitHub (it can be private).
2. Go to <https://dashboard.render.com> → **New +** → **Blueprint** → pick the repo. Render reads `render.yaml` and creates a web service named `prism-clash`.
3. Wait for the first build (about 2 minutes). Your game is live at `https://prism-clash.onrender.com` (or the name Render shows).
4. Share `https://<your-app>.onrender.com/?room=ABCDE` invite links from the lobby's **Copy invite link** button.

The **free** plan sleeps after about 15 minutes with no visitors. The first visit after that takes about 30–50 seconds to wake up, then it's fast. For an always-on server, switch the service to the **Starter** plan ($7/month) in Render's settings.

If you'd rather click through it manually than use the blueprint: **New + → Web Service** → your repo, then:
- **Runtime:** Node
- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm build`
- **Start command:** `node server/dist/main.js`
- **Health check path:** `/healthz`
- **Environment:** `NODE_VERSION=22.12.0`

## Option B: Fly.io (always on, about $2–5/month)

```bash
fly launch --no-deploy     # pick a name and region; it detects the Dockerfile
fly deploy
fly open
```
Fly's free allowance no longer covers always-on machines for new accounts, but a shared-cpu-1x 256 MB machine is enough for several rooms.

## Option C: Railway

**New Project → Deploy from GitHub repo**. Railway detects the `Dockerfile`. Add a public domain under **Settings → Networking**. WebSockets work out of the box.

## Option D: any server with Docker

```bash
docker build -t prism-clash .
docker run -p 8080:8080 prism-clash
# open http://localhost:8080
```

## Vercel (static client) + Render (game server)

The static client on Vercel loads fast from a CDN, and Practice vs Bots works there with no server at all (the whole game server runs in a Web Worker in the browser). Online rooms (Create Room, Join, invite links) connect to the game server on Render.

1. **Game server:** deploy to Render as in Option A. It's live at `https://prism-clash.onrender.com` (check `https://prism-clash.onrender.com/healthz`). It accepts WebSocket connections from any https page, so the Vercel domain needs no setup on the Render side.
2. **Client:** on <https://vercel.com/new>, import the repo and leave the root directory as the repo root. `vercel.json` already sets everything:
   - install: `pnpm install --frozen-lockfile`
   - build: `pnpm -C client build`, with `VITE_GAME_SERVER` defaulting to `wss://prism-clash.onrender.com/ws`
   - output: `client/dist`, with an SPA fallback to `index.html` and one-year immutable caching for the hashed files in `/assets/`
   Or from a terminal: `npx vercel` (preview) and `npx vercel --prod`.
3. **Pointing at a different game server:** in Vercel, open **Project → Settings → Environment Variables**, add `VITE_GAME_SERVER` = `wss://your-server.onrender.com/ws` (Production, and Preview if you like), then redeploy. It's read at build time, so a change needs a new deployment. A bare host also works (`wss://your-server.onrender.com`; the client adds `/ws`).
4. **Testing another server without rebuilding:** add `?server=` to the page URL, e.g. `https://prism-clash.vercel.app/?server=wss://my-test.onrender.com/ws` (the same pattern as other games on the portal). The tab remembers it, and the lobby's invite links carry it, so friends land on the same server.

If the game server is asleep, the first Create Room shows "Connecting to the game server…" while Render wakes it (up to about a minute on the free plan). If it can't be reached at all, players see "Online rooms need the game server — Practice vs Bots works right now".

**Node and pnpm:** Vercel's default Node 24 works, and so do Node 20.19+ and 22 (`engines` in `package.json` allows `^20.19.0 || ^22.12.0 || ^24.0.0`). Vercel picks the pnpm version from the lockfile; to use exactly the pinned `pnpm@10.34.7` from `packageManager`, add the environment variable `ENABLE_EXPERIMENTAL_COREPACK=1`.

**CoolMattGames:** use the Vercel URL as the entry's `url`.

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` (dev), `8080` (Docker) | HTTP + WebSocket port. Render and Railway set it for you. |
| `NODE_ENV` | — | Set to `production` in deploys. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `MAX_ROOMS` | `200` | Refuses new rooms past this (protects a small server). |
| `CLIENT_DIR` | `client/dist` | Where the built client lives (only change this for custom setups). |
| `VITE_GAME_SERVER` | same host | **Build-time, client:** the game server for online rooms when the client is hosted somewhere else, e.g. `wss://prism-clash.onrender.com/ws`. A `?server=` URL param overrides it. (`VITE_WS_URL`, the old name, still works.) |

## Health check

`GET /healthz` returns `{"ok":true,"rooms":N,"players":N,"uptime":seconds}` with HTTP 200.

## Local production test

```bash
pnpm install
pnpm build
PORT=8080 node server/dist/main.js   # open http://localhost:8080
```

## Adding it to CoolMattGames

Add this entry to `projects/coolmattgames/public/games.js` (swap in your deployed URL):

```js
{
  id: 'prism-clash',
  name: 'PRISM CLASH',
  description: 'Neon battle royale for 2–5 players: draft wild powers, outlast the shrinking arena, first to 15 wins. Bots fill empty slots.',
  url: 'https://prism-clash.onrender.com',
  creator: 'AARUSH',
  tags: ['MULTIPLAYER', 'BATTLE ROYALE', 'ACTION'],
  color: '#a970ff',
  featured: true
}
```
