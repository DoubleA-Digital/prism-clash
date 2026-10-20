// The game protocol for every connected client, independent of how bytes arrive: decoding,
// rate limiting, hello/rejoin, create/join/leave and routing into rooms. The Node server feeds
// it WebSocket frames; the browser's practice worker feeds it postMessage frames. Both speak
// the exact same msgpack protocol (shared/src/net/codec.ts).

import { C2S, decode, encode, NET, S2C, type ClientMsg, type ServerMsg } from "@prism/shared";
import type { Logger, PeerSocket, RandomSource } from "./platform";
import { RoomRegistry } from "./rooms/registry";
import type { Member } from "./rooms/member";
import type { Room } from "./rooms/room";
import { isInt, isRoomCode, rateCheck, sanitizeName, type RateState } from "./validate";

export interface HubOptions {
  log: Logger;
  random: RandomSource;
  /** Refuses new rooms past this many. */
  maxRooms: number;
  /** Per-IP room creation limit (NET.rateLimit.roomsPerMinutePerIp). Off for the local practice worker. */
  limitRoomCreation?: boolean;
  /** false: rooms don't run their own 30 Hz timer; call stepRooms() (tests). */
  roomLoop?: boolean;
}

/** One client's end of the hub: feed it every binary frame, and call close() when it disconnects. */
export interface HubConnection {
  receive(bytes: Uint8Array): void;
  close(): void;
}

interface Conn {
  ws: PeerSocket;
  ip: string;
  playerId: number;
  token: string;
  name: string;
  room: Room | null;
  member: Member | null;
  rate: RateState;
  hello: boolean;
}

export class GameHub {
  readonly rooms: RoomRegistry;
  private nextPlayerId = 1;
  private roomCreations = new Map<string, number[]>();
  private log: Logger;

  constructor(private opts: HubOptions) {
    this.log = opts.log;
    this.rooms = new RoomRegistry({ log: opts.log, random: opts.random, loop: opts.roomLoop });
  }

  connect(ws: PeerSocket, ip: string): HubConnection {
    const conn: Conn = { ws, ip, playerId: 0, token: "", name: "", room: null, member: null, rate: { second: 0, inputs: 0, other: 0, strikes: 0 }, hello: false };
    return {
      receive: (bytes) => this.receive(conn, bytes),
      close: () => {
        if (conn.room && conn.member && conn.member.ws === ws) conn.room.disconnect(conn.member);
      },
    };
  }

  /** Steps every room once (only for hubs created with roomLoop: false). */
  stepRooms() {
    for (const r of [...this.rooms.all()]) r.step();
  }

  shutdown() {
    this.rooms.closeAll();
  }

  private receive(conn: Conn, bytes: Uint8Array) {
    if (bytes.length > NET.maxMessageBytes) return;
    let msg: ClientMsg;
    try {
      msg = decode<ClientMsg>(bytes);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "number") return;
    const verdict = rateCheck(conn.rate, msg.type === C2S.input ? "input" : "other", Date.now());
    if (verdict === "kick") {
      this.log.warn(`kicking ${conn.ip} for flooding`);
      conn.ws.close(1008, "rate limit");
      return;
    }
    if (verdict === "drop") return;
    try {
      this.handle(conn, msg);
    } catch (e) {
      this.log.error(`handler error: ${(e as Error).stack ?? String(e)}`);
    }
  }

  private send(ws: PeerSocket, msg: ServerMsg) {
    if (ws.readyState === 1) ws.send(encode(msg));
  }

  private err(ws: PeerSocket, code: string, message: string) {
    this.send(ws, { type: S2C.error, code, message });
  }

  private handle(c: Conn, msg: ClientMsg) {
    if (msg.type === C2S.ping) {
      if (c.member && typeof msg.rtt === "number" && Number.isFinite(msg.rtt)) c.room?.setRtt(c.member, msg.rtt);
      this.send(c.ws, { type: S2C.pong, t: typeof msg.t === "number" ? msg.t : 0, serverTime: Date.now(), tick: c.room?.world?.tick ?? 0 });
      return;
    }
    if (msg.type === C2S.hello) {
      const name = sanitizeName(msg.name);
      if (!name) return this.err(c.ws, "bad_name", "Pick a name (1 to 16 characters).");
      c.name = name;
      c.hello = true;
      // Rejoin within the window with the same session token.
      if (typeof msg.token === "string" && msg.token.length === 32) {
        const found = this.rooms.findByToken(msg.token);
        if (found && !found.member.connected) {
          c.playerId = found.member.id;
          c.token = msg.token;
          c.room = found.room;
          c.member = found.member;
          this.send(c.ws, { type: S2C.welcome, playerId: c.playerId, token: c.token, serverTime: Date.now(), tickRate: NET.tickRate });
          found.room.rejoin(found.member, c.ws);
          return;
        }
      }
      c.playerId = this.nextPlayerId++;
      c.token = this.opts.random.token();
      this.send(c.ws, { type: S2C.welcome, playerId: c.playerId, token: c.token, serverTime: Date.now(), tickRate: NET.tickRate });
      return;
    }
    if (!c.hello) return;

    if (msg.type === C2S.createRoom) {
      if (c.room) this.leave(c);
      const now = Date.now();
      const limited = this.opts.limitRoomCreation !== false;
      const recent = (this.roomCreations.get(c.ip) ?? []).filter((t) => now - t < 60_000);
      if (limited && recent.length >= NET.rateLimit.roomsPerMinutePerIp) return this.err(c.ws, "slow_down", "Too many rooms created. Try again in a minute.");
      if (this.rooms.count() >= this.opts.maxRooms) return this.err(c.ws, "server_full", "The server is full right now. Try again soon.");
      if (limited) {
        recent.push(now);
        this.roomCreations.set(c.ip, recent);
      }
      const room = this.rooms.create(msg.testRoom === true);
      this.joinRoom(c, room);
      return;
    }
    if (msg.type === C2S.joinRoom) {
      const code = typeof msg.code === "string" ? msg.code.toUpperCase().trim() : "";
      if (!isRoomCode(code)) return this.err(c.ws, "bad_code", "Room codes are 5 letters.");
      const room = this.rooms.get(code);
      if (!room) return this.err(c.ws, "no_room", `No room called ${code}. Check the code with your friend.`);
      if (c.room === room) return;
      if (room.isFull()) return this.err(c.ws, "room_full", "That room is full (5 players).");
      if (c.room) this.leave(c);
      this.joinRoom(c, room);
      return;
    }
    if (msg.type === C2S.leave) {
      this.leave(c);
      return;
    }
    if (c.room && c.member) {
      if (msg.type === C2S.kick && !isInt(msg.playerId, 0, 2 ** 31)) return;
      c.room.handle(c.member, msg);
    }
  }

  private joinRoom(c: Conn, room: Room) {
    const m = room.addHuman(c.playerId, c.name, c.token, c.ws, c.ip);
    if (!m) return this.err(c.ws, "room_full", "That room is full (5 players).");
    c.room = room;
    c.member = m;
    room.sendPhase(m);
    this.log.info(`${c.name} joined room ${room.code} (${room.members.size} players)`);
  }

  private leave(c: Conn) {
    if (c.room && c.member) {
      c.room.removeMember(c.member.id);
      this.log.info(`${c.name} left room ${c.room.code}`);
    }
    c.room = null;
    c.member = null;
  }
}
