// The platform-neutral server core (GameHub + rooms + bots), as the browser's practice worker
// runs it: no Node APIs in its import graph, and a whole bot match over the binary protocol
// with only the injected socket, logger and random source.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { C2S, decode, encode, MATCH, NET, S2C, type ClientMsg, type ServerMsg } from "@prism/shared";
import { GameHub, randomFromBytes, type Logger, type PeerSocket } from "../src/core";
import { originAllowed } from "../src/validate";

const here = dirname(fileURLToPath(import.meta.url));

/** Every module reachable from `entry` through relative imports, plus the bare specifiers it uses. */
function importGraph(entry: string) {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? "";
      if (spec === "@prism/shared") visit(resolve(here, "../../shared/src/index.ts"));
      else if (spec.startsWith(".")) {
        const p = resolve(dirname(file), spec);
        const hit = [`${p}.ts`, join(p, "index.ts")].find((c) => existsSync(c));
        if (!hit) throw new Error(`unresolved ${spec} in ${file}`);
        visit(hit);
      } else bare.add(spec);
    }
  };
  visit(entry);
  return { files, bare };
}

/** A deterministic random source (xorshift), standing in for crypto.getRandomValues. */
function testRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return randomFromBytes((b) => {
    for (let i = 0; i < b.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      b[i] = s & 0xff;
    }
  });
}

class FakeSocket implements PeerSocket {
  readyState = 1;
  inbox: ServerMsg[] = [];
  closed: string | null = null;
  send(data: Uint8Array) {
    this.inbox.push(decode<ServerMsg>(data));
  }
  close(_code?: number, reason?: string) {
    this.readyState = 3;
    this.closed = reason ?? "";
  }
  last<T extends ServerMsg["type"]>(type: T): Extract<ServerMsg, { type: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = this.inbox[i];
      if (m && m.type === type) return m as Extract<ServerMsg, { type: T }>;
    }
    return undefined;
  }
}

const quiet = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return { lines, debug: (m) => lines.push(m), info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(`ERROR ${m}`) };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server core without Node", () => {
  test("core.ts imports nothing Node-only (it is bundled into the practice worker)", () => {
    const { files, bare } = importGraph(resolve(here, "../src/core.ts"));
    expect([...bare].sort()).toEqual(["msgpackr"]);
    expect([...files].some((f) => f.endsWith("main.ts") || f.endsWith("log.ts"))).toBe(false);
    for (const f of files) {
      const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\bprocess\.|\bBuffer\b|\bNodeJS\b|\brequire\(/);
    }
    // Rooms and bots are in it.
    expect([...files].some((f) => f.includes("rooms") && f.endsWith("room.ts"))).toBe(true);
    expect([...files].some((f) => f.includes("bots") && f.endsWith("brain.ts"))).toBe(true);
  });

  test("a full bot match through GameHub over the binary protocol", () => {
    const log = quiet();
    const hub = new GameHub({ log, random: testRandom(42), maxRooms: 2, limitRoomCreation: false, roomLoop: false });
    const sock = new FakeSocket();
    const conn = hub.connect(sock, "local");
    const send = (m: ClientMsg) => conn.receive(encode(m));

    send({ type: C2S.hello, name: "Tester", token: null, version: NET.version });
    const welcome = sock.last(S2C.welcome);
    expect(welcome?.token).toMatch(/^[0-9a-f]{32}$/);
    send({ type: C2S.createRoom, testRoom: false });
    const room = sock.last(S2C.roomState)?.room;
    expect(room?.code).toMatch(/^[A-Z]{5}$/);
    expect(room?.hostId).toBe(welcome?.playerId);
    send({ type: C2S.lobbySet, fillBots: true, map: "crystalWilds" });
    send({ type: C2S.start });
    expect(sock.last(S2C.roomState)?.room.players.length).toBe(MATCH.fighters);

    // Virtual wall clock: one 30 Hz tick of real time per room step (rate limits see real pacing).
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const limit = (MATCH.ultSelectSeconds + MATCH.draftSeconds + MATCH.countdownSeconds + MATCH.maxSeconds + 10) * NET.tickRate;
    const phases: string[] = [];
    let phase = "lobby";
    let ackTick = -1;
    let ended = false;
    let read = 0;
    for (let t = 0; t < limit && !ended; t++) {
      if (phase === "round") send({ type: C2S.input, frames: [], ackTick });
      if (t % 30 === 0) send({ type: C2S.ping, t, rtt: 0 });
      hub.stepRooms();
      now += 1000 / NET.tickRate;
      for (; read < sock.inbox.length; read++) {
        const m = sock.inbox[read]!;
        if (m.type === S2C.phase && m.phase !== phase) {
          phase = m.phase;
          phases.push(phase);
        }
        if (m.type === S2C.ultOffer) send({ type: C2S.pickUlt, index: 0 });
        if (m.type === S2C.draftOffer) send({ type: C2S.pickPower, index: 0 });
        if (m.type === S2C.snapshot) ackTick = m.snap.t;
        if (m.type === S2C.matchEnd) ended = true;
      }
    }
    expect(phases).toEqual(["ultSelect", "draft", "countdown", "round", "matchEnd"]);
    const end = sock.last(S2C.matchEnd);
    expect(end?.stats.length).toBe(MATCH.fighters);
    expect(end?.stats.find((s) => s.place === 1)?.playerId).toBe(end?.winnerId);
    expect(log.lines.filter((l) => l.startsWith("ERROR"))).toEqual([]);
    expect(sock.closed).toBeNull();
    conn.close();
    hub.shutdown();
  });

  test("the hub still enforces protocol rules: hello first, room limits, flood kicks", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const hub = new GameHub({ log: quiet(), random: testRandom(7), maxRooms: 1, roomLoop: false });
    const a = new FakeSocket();
    const ca = hub.connect(a, "1.2.3.4");
    ca.receive(encode({ type: C2S.createRoom, testRoom: false }));
    expect(a.inbox).toEqual([]);
    ca.receive(new Uint8Array([0xc1, 0xff, 0x00])); // garbage never throws
    ca.receive(encode({ type: C2S.hello, name: "A", token: null, version: NET.version }));
    ca.receive(encode({ type: C2S.createRoom, testRoom: false }));
    expect(hub.rooms.count()).toBe(1);
    const b = new FakeSocket();
    const cb = hub.connect(b, "5.6.7.8");
    cb.receive(encode({ type: C2S.hello, name: "B", token: null, version: NET.version }));
    cb.receive(encode({ type: C2S.createRoom, testRoom: false }));
    expect(b.last(S2C.error)?.code).toBe("server_full");
    // Over the per-second limit for several seconds in a row: kicked.
    for (let i = 0; i < 500 && b.readyState === 1; i++) {
      cb.receive(encode({ type: C2S.lobbySet, ready: true }));
      if (i % 40 === 39) now += 1000;
    }
    expect(b.closed).toBe("rate limit");
    hub.shutdown();
  });
});

describe("websocket origin policy", () => {
  test("any https origin, localhost over http, the server's own host, and no Origin", () => {
    expect(originAllowed("https://prism-clash.vercel.app", "prism.onrender.com")).toBe(true);
    expect(originAllowed("https://coolmattgames.vercel.app", "prism.onrender.com")).toBe(true);
    expect(originAllowed("http://localhost:4321", "localhost:8787")).toBe(true);
    expect(originAllowed("http://127.0.0.1:5173", "x")).toBe(true);
    expect(originAllowed("http://192.168.1.5:8787", "192.168.1.5:8787")).toBe(true);
    expect(originAllowed(undefined, "x")).toBe(true);
    expect(originAllowed("http://evil.example.com", "prism.onrender.com")).toBe(false);
    expect(originAllowed("null", "x")).toBe(false);
    expect(originAllowed("file://", "x")).toBe(false);
  });
});
