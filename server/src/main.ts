// Prism Clash server: one HTTP server that serves the built client, a /healthz endpoint,
// and the WebSocket game protocol. Rooms are in memory.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { C2S, decode, encode, NET, S2C, type ClientMsg, type ServerMsg } from "@prism/shared";
import { log } from "./log";
import { RoomRegistry } from "./rooms/registry";
import type { Member } from "./rooms/member";
import type { Room } from "./rooms/room";
import { isInt, isRoomCode, rateCheck, sanitizeName, type RateState } from "./validate";

const PORT = Number(process.env.PORT ?? 8787);
const here = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = resolve(process.env.CLIENT_DIR ?? join(here, "../../client/dist"));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

const rooms = new RoomRegistry();
const startedAt = Date.now();

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
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
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  createReadStream(file).pipe(res);
}

const http = createServer(serveStatic);
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: NET.maxMessageBytes });

interface Conn {
  ws: WebSocket;
  ip: string;
  playerId: number;
  token: string;
  name: string;
  room: Room | null;
  member: Member | null;
  rate: RateState;
  hello: boolean;
}

let nextPlayerId = 1;
const roomCreations = new Map<string, number[]>();

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === 1) ws.send(encode(msg));
}

function err(ws: WebSocket, code: string, message: string) {
  send(ws, { type: S2C.error, code, message });
}

wss.on("connection", (ws, req) => {
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.socket.remoteAddress ?? "?").trim();
  const conn: Conn = { ws, ip, playerId: 0, token: "", name: "", room: null, member: null, rate: { second: 0, inputs: 0, other: 0, strikes: 0 }, hello: false };

  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    const buf = data instanceof Buffer ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);
    if (buf.length > NET.maxMessageBytes) return;
    let msg: ClientMsg;
    try {
      msg = decode<ClientMsg>(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "number") return;
    const verdict = rateCheck(conn.rate, msg.type === C2S.input ? "input" : "other", Date.now());
    if (verdict === "kick") {
      log.warn(`kicking ${ip} for flooding`);
      ws.close(1008, "rate limit");
      return;
    }
    if (verdict === "drop") return;
    try {
      handle(conn, msg);
    } catch (e) {
      log.error(`handler error: ${(e as Error).stack ?? String(e)}`);
    }
  });

  ws.on("close", () => {
    if (conn.room && conn.member && conn.member.ws === ws) conn.room.disconnect(conn.member);
  });
  ws.on("error", () => ws.close());
});

function handle(c: Conn, msg: ClientMsg) {
  if (msg.type === C2S.ping) {
    if (c.member && typeof msg.rtt === "number" && Number.isFinite(msg.rtt)) c.room?.setRtt(c.member, msg.rtt);
    send(c.ws, { type: S2C.pong, t: typeof msg.t === "number" ? msg.t : 0, serverTime: Date.now(), tick: c.room?.world?.tick ?? 0 });
    return;
  }
  if (msg.type === C2S.hello) {
    const name = sanitizeName(msg.name);
    if (!name) return err(c.ws, "bad_name", "Pick a name (1 to 16 characters).");
    c.name = name;
    c.hello = true;
    // Rejoin within the window with the same session token.
    if (typeof msg.token === "string" && msg.token.length === 32) {
      const found = rooms.findByToken(msg.token);
      if (found && !found.member.connected) {
        c.playerId = found.member.id;
        c.token = msg.token;
        c.room = found.room;
        c.member = found.member;
        send(c.ws, { type: S2C.welcome, playerId: c.playerId, token: c.token, serverTime: Date.now(), tickRate: NET.tickRate });
        found.room.rejoin(found.member, c.ws);
        return;
      }
    }
    c.playerId = nextPlayerId++;
    c.token = randomBytes(16).toString("hex");
    send(c.ws, { type: S2C.welcome, playerId: c.playerId, token: c.token, serverTime: Date.now(), tickRate: NET.tickRate });
    return;
  }
  if (!c.hello) return;

  if (msg.type === C2S.createRoom) {
    if (c.room) leave(c);
    const now = Date.now();
    const recent = (roomCreations.get(c.ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= NET.rateLimit.roomsPerMinutePerIp) return err(c.ws, "slow_down", "Too many rooms created. Try again in a minute.");
    if (rooms.count() >= Number(process.env.MAX_ROOMS ?? NET.maxRooms)) return err(c.ws, "server_full", "The server is full right now. Try again soon.");
    recent.push(now);
    roomCreations.set(c.ip, recent);
    const room = rooms.create(msg.testRoom === true);
    joinRoom(c, room);
    return;
  }
  if (msg.type === C2S.joinRoom) {
    const code = typeof msg.code === "string" ? msg.code.toUpperCase().trim() : "";
    if (!isRoomCode(code)) return err(c.ws, "bad_code", "Room codes are 5 letters.");
    const room = rooms.get(code);
    if (!room) return err(c.ws, "no_room", `No room called ${code}. Check the code with your friend.`);
    if (c.room === room) return;
    if (room.isFull()) return err(c.ws, "room_full", "That room is full (5 players).");
    if (c.room) leave(c);
    joinRoom(c, room);
    return;
  }
  if (msg.type === C2S.leave) {
    leave(c);
    return;
  }
  if (c.room && c.member) {
    if (msg.type === C2S.kick && !isInt(msg.playerId, 0, 2 ** 31)) return;
    c.room.handle(c.member, msg);
  }
}

function joinRoom(c: Conn, room: Room) {
  const m = room.addHuman(c.playerId, c.name, c.token, c.ws, c.ip);
  if (!m) return err(c.ws, "room_full", "That room is full (5 players).");
  c.room = room;
  c.member = m;
  room.sendPhase(m);
  log.info(`${c.name} joined room ${room.code} (${room.members.size} players)`);
}

function leave(c: Conn) {
  if (c.room && c.member) {
    c.room.removeMember(c.member.id);
    log.info(`${c.name} left room ${c.room.code}`);
  }
  c.room = null;
  c.member = null;
}

http.listen(PORT, () => log.info(`Prism Clash server on :${PORT} (client: ${existsSync(CLIENT_DIR) ? CLIENT_DIR : "dev mode"})`));

const shutdown = () => {
  log.info("shutting down");
  wss.close();
  http.close();
  rooms.closeAll();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
