# Deploying Prism Clash

One Node process serves everything: the built game (static files), the WebSocket game server at `/ws`, and a health check at `/healthz`. The client connects to the same host it was loaded from, so there's no URL to configure.

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

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` (dev), `8080` (Docker) | HTTP + WebSocket port. Render and Railway set it for you. |
| `NODE_ENV` | — | Set to `production` in deploys. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `MAX_ROOMS` | `200` | Refuses new rooms past this (protects a small server). |
| `CLIENT_DIR` | `client/dist` | Where the built client lives (only change this for custom setups). |
| `VITE_WS_URL` | same host | **Build-time, client:** only set this if the client is hosted somewhere else (for example GitHub Pages) and must connect to a separate game server, e.g. `wss://prism-clash.onrender.com/ws`. |

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
