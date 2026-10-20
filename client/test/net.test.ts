// Game server selection (?server= > VITE_GAME_SERVER > same-origin), invite links, and the
// two transports (WebSocket and the practice worker) driven through fakes.
import { describe, expect, test } from "vitest";
import { C2S, decode, encode, S2C, type ClientMsg, type ServerMsg } from "@prism/shared";
import { chooseServer, inviteUrl, normalizeServerUrl, type ServerInputs } from "../src/net/serverUrl";
import { Connection } from "../src/net/socket";
import { ownBuffer, WorkerTransport, WsTransport, type TransportHandlers, type WebSocketLike, type WorkerLike, type WorkerWire } from "../src/net/transport";

const base: ServerInputs = { search: "", stored: null, env: undefined, protocol: "https:", host: "prism.vercel.app" };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("server URL selection", () => {
  test("same-origin /ws is the fallback, matching the page protocol", () => {
    expect(chooseServer(base)).toEqual({ url: "wss://prism.vercel.app/ws", source: "sameOrigin", param: null });
    expect(chooseServer({ ...base, protocol: "http:", host: "localhost:5173" }).url).toBe("ws://localhost:5173/ws");
  });

  test("VITE_GAME_SERVER beats same-origin, and the old VITE_WS_URL still works", () => {
    expect(chooseServer({ ...base, env: "wss://prism.onrender.com/ws" })).toEqual({ url: "wss://prism.onrender.com/ws", source: "env", param: null });
    expect(chooseServer({ ...base, legacyEnv: "wss://old.example.com/ws" }).url).toBe("wss://old.example.com/ws");
    expect(chooseServer({ ...base, env: "wss://new.example.com", legacyEnv: "wss://old.example.com/ws" }).url).toBe("wss://new.example.com/ws");
  });

  test("?server= beats everything, and a remembered one is used when the URL has none", () => {
    const env = "wss://prism.onrender.com/ws";
    expect(chooseServer({ ...base, env, search: "?server=wss://mine.onrender.com/ws&room=ABCDE" })).toEqual({ url: "wss://mine.onrender.com/ws", source: "param", param: "wss://mine.onrender.com/ws" });
    expect(chooseServer({ ...base, env, stored: "wss://mine.onrender.com/ws" }).source).toBe("param");
    // A fresh ?server= replaces the remembered one.
    expect(chooseServer({ ...base, stored: "wss://a.example.com/ws", search: "?server=wss://b.example.com/ws" }).url).toBe("wss://b.example.com/ws");
  });

  test("junk server params are ignored instead of breaking the page", () => {
    for (const bad of ["javascript:alert(1)", "notaurl", "ftp://x.com", "wss://user:pw@x.com/ws", ""]) {
      expect(chooseServer({ ...base, search: `?server=${encodeURIComponent(bad)}` }).source).toBe("sameOrigin");
    }
    expect(chooseServer({ ...base, stored: "garbage", env: "also garbage" }).source).toBe("sameOrigin");
  });

  test("normalizing: bare hosts get /ws, http(s) become ws(s), paths and ports are kept", () => {
    expect(normalizeServerUrl("wss://prism.onrender.com")).toBe("wss://prism.onrender.com/ws");
    expect(normalizeServerUrl("https://prism.onrender.com/")).toBe("wss://prism.onrender.com/ws");
    expect(normalizeServerUrl("ws://localhost:8787/ws")).toBe("ws://localhost:8787/ws");
    expect(normalizeServerUrl("http://localhost:8787/game")).toBe("ws://localhost:8787/game");
    expect(normalizeServerUrl("  wss://x.com/ws#frag ")).toBe("wss://x.com/ws");
  });

  test("invite links carry the server param only when one is in use", () => {
    expect(inviteUrl("https://prism.vercel.app/", "ABCDE", null)).toBe("https://prism.vercel.app/?room=ABCDE");
    const link = inviteUrl("https://prism.vercel.app/", "ABCDE", "wss://mine.onrender.com/ws");
    const q = new URL(link).searchParams;
    expect(q.get("room")).toBe("ABCDE");
    expect(q.get("server")).toBe("wss://mine.onrender.com/ws");
    // Opening the invite resolves to the same server.
    expect(chooseServer({ ...base, search: new URL(link).search }).url).toBe("wss://mine.onrender.com/ws");
  });
});

class FakeWs implements WebSocketLike {
  binaryType: BinaryType = "blob";
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  sent: Uint8Array[] = [];
  constructor(readonly url: string) {}
  send(d: Uint8Array) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ reason: "" } as CloseEvent);
  }
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  serverSend(msg: ServerMsg) {
    this.onmessage?.({ data: ownBuffer(encode(msg)) } as MessageEvent);
  }
  serverRefuse() {
    this.readyState = 3;
    this.onclose?.({ reason: "" } as CloseEvent);
  }
}

const recorder = () => {
  const log: string[] = [];
  const msgs: Uint8Array[] = [];
  const h: TransportHandlers = {
    open: () => log.push("open"),
    message: (b) => msgs.push(b),
    close: (reason, opened) => log.push(`close:${opened}:${reason}`),
  };
  return { log, msgs, h };
};

describe("WebSocket transport", () => {
  test("opens, sends and receives binary frames", () => {
    const made: FakeWs[] = [];
    const t = new WsTransport("wss://x.com/ws", (u) => {
      const ws = new FakeWs(u);
      made.push(ws);
      return ws;
    });
    const r = recorder();
    t.start(r.h);
    const ws = made[0]!;
    expect(ws.binaryType).toBe("arraybuffer");
    expect(t.open).toBe(false);
    t.send(new Uint8Array([1])); // dropped while connecting
    ws.serverOpen();
    expect(t.open).toBe(true);
    t.send(new Uint8Array([2, 3]));
    expect(ws.sent).toEqual([new Uint8Array([2, 3])]);
    ws.serverSend({ type: S2C.error, code: "x", message: "hi" });
    expect(decode<ServerMsg>(r.msgs[0]!)).toMatchObject({ type: S2C.error, message: "hi" });
    t.close();
    expect(r.log).toEqual(["open", "close:true:Connection closed"]);
  });

  test("a server that never answers reports close with opened=false", () => {
    const made: FakeWs[] = [];
    const t = new WsTransport("wss://down.example.com/ws", (u) => {
      const ws = new FakeWs(u);
      made.push(ws);
      return ws;
    });
    const r = recorder();
    t.start(r.h);
    made[0]!.serverRefuse();
    expect(r.log).toEqual(["close:false:Connection closed"]);
  });

  test("a malformed URL fails like a refused connection, asynchronously", async () => {
    const t = new WsTransport("not a url", () => {
      throw new SyntaxError("bad url");
    });
    const r = recorder();
    t.start(r.h);
    expect(r.log).toEqual([]);
    await tick();
    expect(r.log).toEqual(["close:false:Could not connect"]);
  });
});

/** A fake worker that answers like the practice worker does: binary frames and close control messages. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  received: ArrayBuffer[] = [];
  terminated = false;
  postMessage(msg: unknown, transfer: Transferable[]) {
    expect(msg).toBeInstanceOf(ArrayBuffer);
    expect(transfer).toEqual([msg]);
    this.received.push(msg as ArrayBuffer);
  }
  terminate() {
    this.terminated = true;
  }
  emit(d: WorkerWire) {
    this.onmessage?.({ data: d } as MessageEvent);
  }
}

describe("worker transport", () => {
  test("opens asynchronously, transfers own copies of frames, and terminates on close", async () => {
    const w = new FakeWorker();
    const t = new WorkerTransport(() => w);
    const r = recorder();
    t.start(r.h);
    expect(r.log).toEqual([]);
    await tick();
    expect(r.log).toEqual(["open"]);
    // A view into a bigger (pooled) buffer: only its own bytes travel.
    const pool = new Uint8Array([9, 9, 4, 5, 9]);
    t.send(pool.subarray(2, 4));
    expect(new Uint8Array(w.received[0]!)).toEqual(new Uint8Array([4, 5]));
    expect(pool).toEqual(new Uint8Array([9, 9, 4, 5, 9]));
    w.emit(ownBuffer(encode({ type: S2C.pong, t: 1, serverTime: 2, tick: 3 })));
    expect(decode<ServerMsg>(r.msgs[0]!)).toMatchObject({ type: S2C.pong, tick: 3 });
    t.close();
    expect(w.terminated).toBe(true);
    expect(r.log).toEqual(["open", "close:true:Practice ended"]);
    t.send(new Uint8Array([1]));
    expect(w.received.length).toBe(1);
  });

  test("the worker closing or crashing ends the transport once", async () => {
    const w = new FakeWorker();
    const t = new WorkerTransport(() => w);
    const r = recorder();
    t.start(r.h);
    await tick();
    w.emit({ t: "close", reason: "rate limit" });
    w.onerror?.({ message: "boom" } as ErrorEvent);
    expect(r.log).toEqual(["open", "close:true:rate limit"]);
    expect(t.open).toBe(false);
  });

  test("Connection speaks the codec over either transport", async () => {
    const w = new FakeWorker();
    const c = new Connection();
    const got: ServerMsg[] = [];
    c.on((m) => got.push(m));
    let opened = false;
    c.onOpen(() => (opened = true));
    c.connect(new WorkerTransport(() => w));
    expect(c.kind).toBe("worker");
    await tick();
    expect(opened).toBe(true);
    c.send({ type: C2S.hello, name: "Ann", token: null, version: 1 });
    expect(decode<ClientMsg>(new Uint8Array(w.received[0]!))).toMatchObject({ type: C2S.hello, name: "Ann" });
    w.emit(ownBuffer(encode({ type: S2C.welcome, playerId: 7, token: "t".repeat(32), serverTime: 0, tickRate: 30 })));
    expect(got[0]).toMatchObject({ type: S2C.welcome, playerId: 7 });
    expect(c.stats.bytesIn).toBeGreaterThan(0);
  });
});
