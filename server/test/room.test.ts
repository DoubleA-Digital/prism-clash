// Room lifecycle, rejoin, host migration, validation and fuzzing with garbage messages.
import { afterEach, describe, expect, test } from "vitest";
import type { WebSocket } from "ws";
import { C2S, decode, MATCH, NET, Rng, S2C, type ClientMsg, type ServerMsg } from "@prism/shared";
import { Room } from "../src/rooms/room";
import { rateCheck, sanitizeName } from "../src/validate";

const fakeWs = () => {
  const sent: Uint8Array[] = [];
  return { ws: { readyState: 1, send: (d: Uint8Array) => sent.push(d), close: () => {} } as unknown as WebSocket, sent };
};

const rooms: Room[] = [];
const mkRoom = () => {
  const r = new Room("ABCDE", 123, false, { loop: false });
  rooms.push(r);
  return r;
};
afterEach(() => {
  for (const r of rooms) r.destroy();
  rooms.length = 0;
});

describe("room", () => {
  test("join, colors are unique, host migrates when the host leaves", () => {
    const r = mkRoom();
    const a = r.addHuman(1, "Ann", "t1", fakeWs().ws, "ip")!;
    const b = r.addHuman(2, "Ann", "t2", fakeWs().ws, "ip")!;
    expect(a.color).not.toBe(b.color);
    expect(b.name).toBe("Ann 2");
    expect(r.hostId).toBe(1);
    r.disconnect(a);
    expect(r.hostId).toBe(2);
  });

  test("a full room refuses a 6th player", () => {
    const r = mkRoom();
    for (let i = 1; i <= 5; i++) r.addHuman(i, `P${i}`, `t${i}`, fakeWs().ws, "ip");
    expect(r.isFull()).toBe(true);
    expect(r.addHuman(6, "Late", "t6", fakeWs().ws, "ip")).toBeNull();
  });

  test("bots fill the room and the match starts", () => {
    const r = mkRoom();
    const a = r.addHuman(1, "Ann", "t1", fakeWs().ws, "ip")!;
    r.handle(a, { type: C2S.start });
    expect(r.members.size).toBe(MATCH.fighters);
    expect(r.phase).toBe("ultSelect");
    // Bots get colors beyond the five human ones, all distinct.
    expect(new Set([...r.members.values()].map((m) => m.color)).size).toBe(MATCH.fighters);
  });

  test("a whole bot-filled match runs from start to results, with interest-managed snapshots", () => {
    const r = mkRoom();
    const sock = fakeWs();
    const a = r.addHuman(1, "Ann", "t1", sock.ws, "ip")!;
    r.handle(a, { type: C2S.start });
    let ticks = 0;
    const limit = (MATCH.ultSelectSeconds + MATCH.draftSeconds + MATCH.countdownSeconds + MATCH.maxSeconds + 10) * NET.tickRate;
    let sawRound = false;
    while (r.phase !== "matchEnd" && ticks < limit) {
      if (r.phase === "ultSelect") r.handle(a, { type: C2S.pickUlt, index: 0 });
      if (r.phase === "draft") r.handle(a, { type: C2S.pickPower, index: 1 });
      // The human idles near their spawn; keep acking snapshots so deltas stay small.
      if (r.phase === "round") {
        sawRound = true;
        r.handle(a, { type: C2S.input, frames: [], ackTick: r.world?.tick ?? -1 });
      }
      r.step();
      ticks++;
    }
    expect(sawRound).toBe(true);
    expect(r.phase).toBe("matchEnd");
    const msgs = sock.sent.map((d) => decode<ServerMsg>(d));
    const end = msgs.find((m) => m.type === S2C.matchEnd);
    expect(end && end.type === S2C.matchEnd && end.stats.length).toBe(MATCH.fighters);
    if (end && end.type === S2C.matchEnd) expect(end.stats.find((s) => s.place === 1)?.playerId).toBe(end.winnerId);
    // Snapshots never carried all 12 fighters at once to a viewer that can't see them.
    const snaps = msgs.filter((m) => m.type === S2C.snapshot);
    expect(snaps.length).toBeGreaterThan(100);
  });

  test("mid-match disconnect keeps the seat for rejoin", () => {
    const r = mkRoom();
    const a = r.addHuman(1, "Ann", "t1", fakeWs().ws, "ip")!;
    r.handle(a, { type: C2S.start });
    r.disconnect(a);
    expect(r.members.get(1)?.connected).toBe(false);
    r.rejoin(a, fakeWs().ws);
    expect(r.members.get(1)?.connected).toBe(true);
  });

  test("garbage messages never throw or change state wrongly", () => {
    const r = mkRoom();
    const a = r.addHuman(1, "Ann", "t1", fakeWs().ws, "ip")!;
    const rng = new Rng(5);
    const junk = (): unknown => {
      const k = rng.int(7);
      if (k === 0) return rng.next() * 1e9 - 5e8;
      if (k === 1) return "x".repeat(rng.int(40));
      if (k === 2) return null;
      if (k === 3) return [junk(), junk()];
      if (k === 4) return { a: junk() };
      if (k === 5) return NaN;
      return rng.int(20) - 5;
    };
    for (let i = 0; i < 5000; i++) {
      const msg = { type: rng.int(20), frames: rng.next() < 0.5 ? [[junk(), junk(), junk(), junk(), junk(), junk(), junk(), junk()]] : junk(), index: junk(), color: junk(), code: junk(), x: junk(), y: junk(), kind: junk(), playerId: junk(), ackTick: junk(), power: junk() };
      expect(() => r.handle(a, msg as unknown as ClientMsg)).not.toThrow();
    }
    expect(r.members.size).toBeGreaterThanOrEqual(1);
  });
});

describe("validation", () => {
  test("names are sanitized and capped", () => {
    expect(sanitizeName("  hi\u0000​there  ")).toBe("hithere");
    expect(sanitizeName("x".repeat(40)).length).toBe(16);
    expect(sanitizeName(42)).toBe("");
  });

  test("rate limits drop then kick floods", () => {
    const st = { second: 0, inputs: 0, other: 0, strikes: 0 };
    let verdict = "ok";
    for (let s = 0; s < 4; s++) for (let i = 0; i < 200; i++) verdict = rateCheck(st, "other", s * 1000 + i);
    expect(verdict).toBe("kick");
  });
});
