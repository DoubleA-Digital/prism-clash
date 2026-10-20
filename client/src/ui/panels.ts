// Dev panels: the F2 network panel (with the latency simulator) and the F1 debug panel.

import { allPowers, allUlts, type DebugGrant } from "@prism/shared";
import { session } from "../net/session";
import { h } from "./dom";
import { iconDataUrl } from "./icons";

export function netPanel(): { el: HTMLElement; update: () => void } {
  const body = h("div");
  const conn = () => session.conn;
  const sim = h("div");
  const mk = (label: string, key: "latencyMs" | "jitterMs" | "loss", max: number, step: number, fmt: (v: number) => string) => {
    const out = h("b", null, fmt(conn().sim[key]));
    const input = h("input", { type: "range", min: "0", max: String(max), step: String(step), value: String(conn().sim[key]) }) as HTMLInputElement;
    input.addEventListener("input", () => {
      conn().sim[key] = Number(input.value);
      out.textContent = fmt(Number(input.value));
    });
    return h("div", null, h("div.kv", null, h("span", null, label), out), input);
  };
  const preset = (name: string, l: number, j: number, loss: number) =>
    h("button.btn.small", { onclick: () => { conn().sim = { latencyMs: l, jitterMs: j, loss }; rebuildSim(); } }, name);
  const rebuildSim = () => {
    sim.replaceChildren(
      mk("Latency (RTT)", "latencyMs", 500, 5, (v) => `${v} ms`),
      mk("Jitter", "jitterMs", 150, 5, (v) => `±${v} ms`),
      mk("Packet loss", "loss", 0.3, 0.01, (v) => `${Math.round(v * 100)}%`),
      h("div.row", { style: { gap: "6px", marginTop: "6px", flexWrap: "wrap" } }, preset("Off", 0, 0, 0), preset("100 ms", 100, 10, 0), preset("150 ms", 150, 30, 0), preset("Bad Wi-Fi", 220, 80, 0.06)),
    );
  };
  rebuildSim();
  const el = h("div.netpanel.panel", null, h("h4", null, "NETWORK (F2)"), body, h("h4", null, "SIMULATOR"), sim);
  const update = () => {
    const s = conn().stats;
    const d = session.view?.debug;
    const kv = (k: string, v: string) => h("div.kv", null, h("span", null, k), h("b", null, v));
    body.replaceChildren(
      kv("Ping (RTT)", `${Math.round(session.rtt)} ms`),
      kv("Server tick", d ? String(Math.round(d.estServerTick)) : "-"),
      kv("Render tick", d ? d.renderTick.toFixed(1) : "-"),
      kv("Interp delay", d ? `${(d.interpDelayTicks * 33.3).toFixed(0)} ms` : "-"),
      kv("Snapshots/s", s.snapsPerSec.toFixed(1)),
      kv("Down", `${(s.inPerSec / 1024).toFixed(2)} KB/s`),
      kv("Up", `${(s.outPerSec / 1024).toFixed(2)} KB/s`),
      kv("Corrections/min", d ? String(d.correctionsPerMin) : "-"),
      kv("Last correction", d ? `${d.lastCorrection.toFixed(1)} u` : "-"),
      kv("Late frames", d ? String(d.late) : "-"),
      kv("Dropped (sim)", String(s.dropped)),
    );
  };
  return { el, update };
}

export function debugPanel(getFps: () => { fps: number; frameMs: number; particles: number }): { el: HTMLElement; update: () => void } {
  const stats = h("div");
  const target = { id: session.myId };
  const players = h("div.seg", { style: { flexWrap: "wrap", marginBottom: "8px" } });
  const renderPlayers = () => {
    players.replaceChildren(...(session.room?.players ?? []).map((p) =>
      h(`button${target.id === p.id ? ".on" : ""}`, { onclick: () => { target.id = p.id; renderPlayers(); } }, p.name)));
  };
  renderPlayers();
  const grant = (id: DebugGrant) => () => session.debugGrant(target.id, id);
  const test = session.room?.settings.testRoom;
  const el = h(
    "div.debugpanel.panel",
    null,
    h("h4", { style: { fontFamily: "var(--display)", margin: "0 0 8px" } }, "DEBUG (F1)"),
    stats,
    test
      ? h("div", null,
        h("div.label", { style: { margin: "8px 0" } }, "Grant to player"),
        players,
        h("div.grid", null, allPowers().map((p) => h("button", { onclick: grant(p.id), title: p.name }, h("img", { src: iconDataUrl(p.id, 40), alt: p.name })))),
        h("div.label", { style: { margin: "8px 0" } }, "Ultimates (granted full)"),
        h("div.grid", null, allUlts().map((u) => h("button", { onclick: grant(u.id), title: u.name }, h("img", { src: iconDataUrl(u.id, 40), alt: u.name })))),
        h("div.row", { style: { marginTop: "8px" } }, h("button.btn.small", { onclick: grant("fullUlt") }, "Full ult"), h("button.btn.small", { onclick: grant("heal") }, "Heal"), h("button.btn.small", { onclick: grant("loadout") }, "Loadout")),
        h("div.row", { style: { marginTop: "8px" } }, h("button.btn.small", { onclick: grant("shard") }, "Prism Shard"), h("button.btn.small", { onclick: grant("toBuilding") }, "Into building"), h("button.btn.small", { onclick: grant("toFight") }, "To a fight")))
      : h("div.hint", null, "Granting powers works in test rooms: open the game with ?test=1 and create a room."),
  );
  const update = () => {
    const f = getFps();
    stats.replaceChildren(
      h("div.kv", null, h("span", null, "FPS"), h("b", null, f.fps.toFixed(0))),
      h("div.kv", null, h("span", null, "Frame"), h("b", null, `${f.frameMs.toFixed(1)} ms`)),
      h("div.kv", null, h("span", null, "Particles"), h("b", null, String(f.particles))),
      h("div.kv", null, h("span", null, "Hitboxes"), h("b", null, "shown")),
    );
  };
  return { el, update };
}
