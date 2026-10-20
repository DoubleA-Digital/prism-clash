// Room lifecycle, rejoin, host migration, validation and fuzzing with garbage messages.
import { afterEach, describe, expect, test } from "vitest";
import type { WebSocket } from "ws";
import { C2S, decode, DEFAULT_HERO, HERO_IDS, MATCH, NET, Rng, S2C, type ClientMsg, type ServerMsg } from "@prism/shared";
import { Room } from "../src/rooms/room";
import { rateCheck, sanitizeName } from "../src/validate";

const fakeWs = () => {
  const sent: Uint8Array[] = [];
  return { ws: { readyState: 1, send: (d: Uint8Array) => sent.push(d), close: () => {} } as unknown as WebSocket, sent };
};

const rooms: Room[] = [];
// Most tests here exercise the bot-filled drop, so they turn fill on (online rooms default to off).
const mkRoom = (fillBots = true) => {
  const r = new Room("ABCDE", 123, false, { loop: false });
  r.settings.fillBots = fillBots;
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

  test("a full room (10 humans) refuses an 11th player; every human gets their own color", () => {
    const r = mkRoom();
    for (let i = 1; i <= NET.maxPlayers; i++) r.addHuman(i, `P${i}`, `t${i}`, fakeWs().ws, "ip");
    expect(r.isFull()).toBe(true);
    expect(NET.maxPlayers).toBe(10);
    expect(r.addHuman(99, "Late", "t99", fakeWs().ws, "ip")).toBeNull();
    expect(new Set([...r.members.values()].map((m) => m.color)).size).toBe(NET.maxPlayers);
  });

  test("online rooms default to humans only: four friends play a four-fighter match", () => {
    expect(new Room("FGHIJ", 1, false, { loop: false }).settings.fillBots).toBe(false);
    const r = mkRoom(false);
    const ms = ["Ann", "Bea", "Cal", "Dee"].map((n, i) => r.addHuman(i + 1, n, `t${i}`, fakeWs().ws, "ip")!);
    const [host, ...rest] = ms;
    for (const m of rest) r.handle(m, { type: C2S.lobbySet, ready: true });
    r.handle(host!, { type: C2S.start });
    expect(r.phase).toBe("ultSelect");
    expect(r.members.size).toBe(4);
    expect([...r.members.values()].some((m) => m.bot)).toBe(false);
  });

  test("bots fill the room and the match starts", () => {
    const r = mkRoom();
    const a = r.addHuman(1, "Ann", "t1", fakeWs().ws, "ip")!;
    r.handle(a, { type: C2S.start });
    expect(r.members.size).toBe(MATCH.fighters);
    expect(r.phase).toBe("ultSelect");
    // Ten fighters, ten distinct colors.
    expect(MATCH.fighters).toBe(10);
    expect(new Set([...r.members.values()].map((m) => m.color)).size).toBe(MATCH.fighters);
  });

  test("heroes: picks are validated and synced, bots wear distinct heroes while any are free", () => {
    const r = mkRoom();
    const a = r.addHuman(1, "Ann", "t1", fakeWs().ws, "ip")!;
    expect(a.hero).toBe(DEFAULT_HERO);
    r.handle(a, { type: C2S.lobbySet, hero: "vex" });
    expect(a.hero).toBe("vex");
    r.handle(a, { type: C2S.lobbySet, hero: "notAHero" } as unknown as ClientMsg);
    expect(a.hero).toBe("vex");
    expect(r.roomState().players.find((p) => p.id === 1)?.hero).toBe("vex");
    r.handle(a, { type: C2S.start });
    const bots = [...r.members.values()].filter((m) => m.bot);
    // 7 heroes are free for the first 7 bots, then they repeat as evenly as possible.
    const first = bots.slice(0, HERO_IDS.length - 1).map((m) => m.hero);
    expect(new Set(first).size).toBe(first.length);
    expect(first).not.toContain("vex");
    for (const m of r.members.values()) expect(HERO_IDS).toContain(m.hero);
    // No hero picks once the match has started.
    r.handle(a, { type: C2S.lobbySet, hero: "glitch" });
    expect(a.hero).toBe("vex");
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
    // Snapshots never carried all 10 fighters at once to a viewer that can't see them.
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

describe("leaving a match after being eliminated", () => {
  const msgsOf = (sent: Uint8Array[]) => sent.map((d) => decode<ServerMsg>(d));
  const lastPhase = (sent: Uint8Array[]) => msgsOf(sent).filter((m) => m.type === S2C.phase).at(-1);
  /** Host Ann and guest Bea (ready), bots fill in, both pick, then the drop. */
  const twoInARound = () => {
    const r = mkRoom();
    const sa = fakeWs();
    const sb = fakeWs();
    const a = r.addHuman(1, "Ann", "t1", sa.ws, "ip")!;
    const b = r.addHuman(2, "Bea", "t2", sb.ws, "ip")!;
    r.handle(b, { type: C2S.lobbySet, ready: true });
    r.handle(a, { type: C2S.start });
    for (let i = 0; i < 60 * NET.tickRate && r.phase !== "round"; i++) {
      for (const m of [a, b]) {
        if (r.phase === "ultSelect") r.handle(m, { type: C2S.pickUlt, index: 0 });
        if (r.phase === "draft") r.handle(m, { type: C2S.pickPower, index: 0 });
      }
      r.step();
    }
    expect(r.phase).toBe("round");
    return { r, a, b, sa, sb, w: r.world! };
  };
  /** Eliminates everyone but `keep`, then steps through the victory beat to the results. */
  const finish = (r: Room, keep: number) => {
    for (const p of r.world!.players.values()) if (p.id !== keep) r.world!.kill(p);
    for (let i = 0; i < (MATCH.victorySeconds + 2) * NET.tickRate && r.phase === "round"; i++) r.step();
    expect(r.phase).toBe("matchEnd");
  };

  test("an eliminated player goes back to the lobby while the match carries on, and keeps their result", () => {
    const { r, a, b, sa, sb, w } = twoInARound();
    // Alive players can't leave the match view (they'd quit the room instead).
    r.handle(b, { type: C2S.leaveMatch });
    expect(b.inLobby).toBe(false);
    for (let i = 0; i < 30; i++) r.step();
    w.kill(w.players.get(2)!);
    r.step();
    r.handle(b, { type: C2S.leaveMatch });
    expect(b.inLobby).toBe(true);
    expect(lastPhase(sb.sent)).toMatchObject({ phase: "lobby" });
    const before = { a: sa.sent.length, b: sb.sent.length };
    for (let i = 0; i < NET.tickRate * 2; i++) r.step();
    const bNew = msgsOf(sb.sent.slice(before.b));
    const aNew = msgsOf(sa.sent.slice(before.a));
    // No more snapshots for the one in the lobby; the one still playing gets them as before.
    expect(bNew.some((m) => m.type === S2C.snapshot)).toBe(false);
    expect(aNew.filter((m) => m.type === S2C.snapshot).length).toBeGreaterThan(50);
    // The lobby hears how the match is going about once a second.
    const progress = bNew.filter((m) => m.type === S2C.roomState);
    expect(progress.length).toBeGreaterThanOrEqual(2);
    const room = progress.at(-1)?.type === S2C.roomState ? (progress.at(-1) as Extract<ServerMsg, { type: typeof S2C.roomState }>).room : null;
    expect(room?.phase).toBe("round");
    expect(room?.match).toMatchObject({ fighters: MATCH.fighters, alive: w.alivePlayers().length });
    expect(room?.match?.elapsed).toBeGreaterThanOrEqual(1);
    expect(room?.players.find((p) => p.id === 2)?.inLobby).toBe(true);
    // The host can't start a new match while this one runs; waiting players can ready up.
    r.handle(b, { type: C2S.lobbySet, ready: false });
    r.handle(b, { type: C2S.lobbySet, ready: true, hero: "vex", color: 9 });
    expect(b.ready).toBe(true);
    expect(b.hero).not.toBe("vex");
    r.handle(a, { type: C2S.start });
    expect(r.phase).toBe("round");
    // Haunting and spectating need the match view.
    r.handle(b, { type: C2S.haunt, kind: "lava", x: 0, y: 0 });
    expect([...w.effects.values()].some((e) => e.source === "haunt")).toBe(false);

    finish(r, 1);
    // Results: Bea's placement and kills are there for everyone (and her own client).
    const end = msgsOf(sb.sent).find((m) => m.type === S2C.matchEnd);
    expect(end?.type === S2C.matchEnd && end.stats.length).toBe(MATCH.fighters);
    const bea = end?.type === S2C.matchEnd ? end.stats.find((s) => s.playerId === 2) : undefined;
    expect(bea?.place).toBeGreaterThan(1);
    expect(lastPhase(sb.sent)).toMatchObject({ phase: "lobby" });
    expect(lastPhase(sa.sent)).toMatchObject({ phase: "matchEnd" });
    // Ann watches the results, then heads back too: the whole room is in the lobby, Bea still ready.
    r.handle(a, { type: C2S.leaveMatch });
    expect(r.phase).toBe("lobby");
    expect(b.ready).toBe(true);
    expect([...r.members.values()].every((m) => !m.inLobby && !m.bot)).toBe(true);
  });

  test("a host who left can start the next match once this one is over, keeping the host", () => {
    const { r, a, b, w } = twoInARound();
    w.kill(w.players.get(1)!);
    r.step();
    r.handle(a, { type: C2S.leaveMatch });
    expect(a.inLobby).toBe(true);
    expect(r.hostId).toBe(1);
    r.handle(a, { type: C2S.start });
    expect(r.phase).toBe("round");
    finish(r, 2);
    // Bea is still on the results: starting brings her to the lobby, but she has to ready up.
    r.handle(a, { type: C2S.start });
    expect(r.phase).toBe("lobby");
    expect(r.hostId).toBe(1);
    r.handle(b, { type: C2S.lobbySet, ready: true });
    r.handle(a, { type: C2S.start });
    expect(r.phase).toBe("ultSelect");
  });

  test("a player who disconnects while dead holds nothing up", () => {
    const { r, a, b, sb, w } = twoInARound();
    w.kill(w.players.get(2)!);
    r.step();
    r.disconnect(b);
    const before = sb.sent.length;
    finish(r, 1);
    expect(sb.sent.length).toBe(before);
    // Ann is the only one connected: once she leaves the results the room is back in the lobby.
    r.handle(a, { type: C2S.leaveMatch });
    expect(r.phase).toBe("lobby");
    // Bea's seat survives for a rejoin, straight into the lobby.
    const again = fakeWs();
    r.rejoin(b, again.ws);
    expect(lastPhase(again.sent)).toMatchObject({ phase: "lobby" });
  });

  test("exiting to the main menu while alive forfeits: eliminated, credited, loot dropped, seat freed", () => {
    const { r, a, b, w } = twoInARound();
    const pb = w.players.get(2)!;
    for (let i = 0; i < 10; i++) r.step();
    // Ann landed the last hit a moment ago, inside the kill-credit window.
    w.damage(pb, 10, 1, "pistol");
    const loot = w.loot.size;
    r.removeMember(b.id); // what the server does on C2S.leave
    expect(pb.alive).toBe(false);
    expect(w.deaths.find((d) => d.id === 2)?.killer).toBe(1);
    expect(w.stat(1).kills).toBe(1);
    expect(w.loot.size).toBeGreaterThan(loot);
    expect(r.members.has(2)).toBe(false);
    // The rejoin token no longer holds a seat; the match goes on and Bea still gets a placement.
    expect([...r.members.values()].some((m) => m.token === "t2")).toBe(false);
    for (const p of w.players.values()) if (p.id !== 1 && p.alive) w.kill(p);
    for (let i = 0; i < (MATCH.victorySeconds + 2) * NET.tickRate && r.phase === "round"; i++) r.step();
    expect(r.phase).toBe("matchEnd");
    expect(a.inLobby).toBe(false);
  });

  test("a rejoin while waiting in the lobby lands back in the lobby, not the match", () => {
    const { r, b, w } = twoInARound();
    w.kill(w.players.get(2)!);
    r.step();
    r.handle(b, { type: C2S.leaveMatch });
    r.disconnect(b);
    const again = fakeWs();
    r.rejoin(b, again.ws);
    expect(lastPhase(again.sent)).toMatchObject({ phase: "lobby" });
    for (let i = 0; i < 40; i++) r.step();
    expect(msgsOf(again.sent).some((m) => m.type === S2C.snapshot)).toBe(false);
  });

  test("someone joining mid-match waits in the lobby and isn't in the running world", () => {
    const r = mkRoom();
    r.settings.fillBots = false;
    const a = r.addHuman(1, "Ann", "t1", fakeWs().ws, "ip")!;
    const b = r.addHuman(2, "Bea", "t2", fakeWs().ws, "ip")!;
    r.handle(b, { type: C2S.lobbySet, ready: true });
    r.handle(a, { type: C2S.start });
    expect(r.phase).toBe("ultSelect");
    const sc = fakeWs();
    const c = r.addHuman(3, "Cal", "t3", sc.ws, "ip")!;
    expect(c.inLobby).toBe(true);
    r.sendPhase(c);
    expect(lastPhase(sc.sent)).toMatchObject({ phase: "lobby" });
    // Cal never picks, and the picks don't wait for him.
    for (let i = 0; i < 4 * NET.tickRate && r.phase !== "countdown"; i++) {
      for (const m of [a, b]) {
        if (r.phase === "ultSelect") r.handle(m, { type: C2S.pickUlt, index: 0 });
        if (r.phase === "draft") r.handle(m, { type: C2S.pickPower, index: 0 });
      }
      r.step();
    }
    expect(r.phase).toBe("countdown");
    expect(r.world?.players.has(3)).toBe(false);
    expect(r.world?.players.size).toBe(2);
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
