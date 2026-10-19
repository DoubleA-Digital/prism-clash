// Client prediction must agree with the authoritative server. Runs the real client NetView
// (prediction + reconciliation) against a real World + snapshot pipeline with no latency.
import { describe, expect, test } from "vitest";
import { BTN, inputFromWire, inputToWire, World, type InputFrame } from "@prism/shared";
import { NetView } from "../../client/src/net/netview";
import { newMember } from "../src/rooms/member";
import { buildSnapshot } from "../src/rooms/snapshots";

describe("prediction vs server", () => {
  test("no corrections while moving and dashing", () => {
    const w = new World("shatteredGrid", 2, 7);
    w.addPlayer(1, "A", 0, false);
    w.addPlayer(2, "B", 1, false);
    w.placeSpawns();
    const m = newMember(1, "A", "t", false, "x", 0);
    const view = new NetView("shatteredGrid", 2, 7, 1);
    let now = 1000;
    // First snapshot so the client knows where it is.
    view.receive(buildSnapshot(w, m, [], 0), now);
    let pendingToServer: InputFrame[] = [];
    let worst = 0;
    for (let f = 0; f < 60 * 20; f++) {
      const t = f / 60;
      const mx = Math.cos(t * 1.3);
      const my = Math.sin(t * 0.9);
      const pressed = f % 50 === 7 ? BTN.dash : 0;
      const dt = 1 / 60 + ((f * 7919) % 5) / 1000; // uneven frame times
      const frame = view.predict(mx, my, t, pressed ? BTN.dash : 0, pressed, dt)!;
      // Over the wire and back (quantized exactly like the real protocol).
      pendingToServer.push(inputFromWire(inputToWire(frame))!);
      now += dt * 1000;
      if (f % 2 === 1) {
        w.step(new Map([[1, pendingToServer], [2, []]]));
        pendingToServer = [];
        m.ackTick = view.lastTick;
        const before = view.debug.corrections;
        view.receive(buildSnapshot(w, m, w.events, 0), now);
        if (view.debug.corrections > before) worst = Math.max(worst, view.debug.lastCorrection);
      }
    }
    expect(worst).toBeLessThan(2);
    expect(view.debug.corrections).toBe(0);
  });
});
