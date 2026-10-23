// Prism Clash server: one HTTP server that serves the built client, a /healthz endpoint,
// and the WebSocket game protocol (handled by the platform-neutral GameHub in hub.ts).
// Rooms are in memory.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomFillSync } from "node:crypto";
import { WebSocketServer } from "ws";
import { NET } from "@prism/shared";
import { GameHub, randomFromBytes } from "./core";
import { log } from "./log";
import { originAllowed } from "./validate";

const PORT = Number(process.env.PORT ?? 8787);
const here = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = resolve(process.env.CLIENT_DIR ?? join(here, "../../client/dist"));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

const hub = new GameHub({ log, random: randomFromBytes((b) => randomFillSync(b)), maxRooms: Number(process.env.MAX_ROOMS ?? NET.maxRooms) });
const rooms = hub.rooms;
const startedAt = Date.now();

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/healthz") {
    // CORS: a client hosted elsewhere (Vercel, the games portal) may check that the server is awake.
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.count(), players: rooms.playerCount(), uptime: Math.round((Date.now() - startedAt) / 1000) }));
    return;
  }
  if (!existsSync(CLIENT_DIR)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Prism Clash server is running. In development, open the Vite client (npm run dev).");
    return;
  }
  // Path traversal guard: resolve inside CLIENT_DIR only.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  let file = resolve(CLIENT_DIR, rel);
  if (!file.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIR, "index.html");
  const ext = extname(file);
  const immutable = file.includes(`${join("assets", "")}`);
  const stream = createReadStream(file);
  stream.on("open", () => {
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
    stream.pipe(res);
  });
  // A file that vanished (redeploy mid-request) must never take the server down.
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  });
}

const http = createServer(serveStatic);
const wss = new WebSocketServer({
  server: http,
  path: "/ws",
  maxPayload: NET.maxMessageBytes,
  // Browsers on other origins (the Vercel client, the games portal) may connect; see originAllowed.
  verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => {
    const ok = originAllowed(origin || undefined, req.headers.host);
    if (!ok) log.warn(`refused ws from origin ${origin}`);
    return ok;
  },
});

wss.on("connection", (ws, req) => {
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.socket.remoteAddress ?? "?").trim();
  const conn = hub.connect(ws, ip);
  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    const buf = data instanceof Buffer ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);
    conn.receive(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  });
  ws.on("close", () => conn.close());
  ws.on("error", () => ws.close());
});

http.listen(PORT, () => log.info(`Prism Clash server on :${PORT} (client: ${existsSync(CLIENT_DIR) ? CLIENT_DIR : "dev mode"})`));

// Render's free tier sleeps after ~15 minutes without inbound traffic, and sleeping wipes every
// room. GitHub's scheduled pings only arrive every few hours, so the server pings its own public
// URL (set by Render as RENDER_EXTERNAL_URL); the request goes through Render's edge and counts.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
const keepAwake = SELF_URL
  ? setInterval(() => {
      fetch(new URL("/healthz", SELF_URL), { signal: AbortSignal.timeout(30_000) }).catch((e: unknown) => log.warn(`keep-awake ping failed: ${String(e)}`));
    }, 10 * 60_000)
  : undefined;

const shutdown = () => {
  log.info("shutting down");
  clearInterval(keepAwake);
  wss.close();
  http.close();
  hub.shutdown();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
