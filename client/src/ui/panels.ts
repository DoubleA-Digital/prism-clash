// Modals and debug panels: Settings (volumes, shake, rebinding, colorblind, ping/fps),
// How to Play, the F2 network panel (with the latency simulator) and the F1 debug panel.

import { allPowers, allUlts, POINTS, type PowerId, type UltId } from "@prism/shared";
import { audio } from "../audio/audio";
import { ACTION_LABELS, DEFAULT_BINDS, keyLabel, saveBinds, type Action, type Input } from "../input/input";
import { session } from "../net/session";
import { saveSettings, settings } from "../settings";
import { h } from "./dom";
import { iconDataUrl } from "./icons";

function slider(label: string, value: number, onInput: (v: number) => void, min = 0, max = 1, step = 0.05) {
  const out = h("span", { style: { fontFamily: "var(--mono)", color: "var(--cyan)" } }, `${Math.round(value * 100)}%`);
  const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = `${Math.round(v * 100)}%`;
    onInput(v);
  });
  return h("div", { style: { margin: "8px 0" } }, h("div.row", null, h("div.label.grow", null, label), out), input);
}

function toggle(label: string, on: boolean, onChange: (v: boolean) => void) {
  const sw = h(`button.switch${on ? ".on" : ""}`, { "aria-label": label }) as HTMLButtonElement;
  sw.addEventListener("click", () => {
    const v = !sw.classList.contains("on");
    sw.classList.toggle("on", v);
    onChange(v);
    audio.sfx("ui", 0, 0, { positional: false });
  });
  return h("div.toggle", null, h("span", null, label), sw);
}

export function settingsModal(input: Input, close: () => void): HTMLElement {
  const nameField = h("input.field", { value: session.name, maxlength: "16", style: { width: "100%" } }) as HTMLInputElement;
  nameField.addEventListener("change", () => {
    const n = nameField.value.trim().slice(0, 16);
    if (n) {
      session.setName(n);
      session.lobbySet({ name: n });
    }
  });
  const binds = h("div.binds");
  const renderBinds = () => {
    binds.replaceChildren(
      ...(Object.keys(ACTION_LABELS) as Action[]).flatMap((a) => {
        const btn = h("button.bind-btn", null, keyLabel(input.binds[a])) as HTMLButtonElement;
        btn.addEventListener("click", () => {
          btn.classList.add("wait");
          btn.textContent = "Press a key…";
          input.capture = (code) => {
            if (code !== "Escape") input.binds[a] = code;
            saveBinds(input.binds);
            renderBinds();
          };
        });
        return [h("span", null, ACTION_LABELS[a]), btn];
      }),
    );
  };
  renderBinds();
  return h(
    "div.overlay",
    { onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
    h(
      "div.modal.panel",
      null,
      h("h2", null, "SETTINGS"),
      h("div.label", null, "Name"),
      nameField,
      h("div", { style: { height: "12px" } }),
      slider("Master volume", settings.master, (v) => saveSettings({ master: v })),
      slider("Music volume", settings.music, (v) => saveSettings({ music: v })),
      slider("Effects volume", settings.sfx, (v) => saveSettings({ sfx: v })),
      slider("Screen shake", settings.shake, (v) => saveSettings({ shake: v }), 0, 1.5),
      toggle("Colorblind mode (shape markers per player)", settings.colorblind, (v) => saveSettings({ colorblind: v })),
      toggle("Show ping", settings.showPing, (v) => saveSettings({ showPing: v })),
      toggle("Show FPS", settings.showFps, (v) => saveSettings({ showFps: v })),
      h("div.label", { style: { margin: "16px 0 8px" } }, "Controls (click to rebind)"),
      binds,
      h("div.row", { style: { marginTop: "16px" } },
        h("button.btn.small", { onclick: () => { input.binds = { ...DEFAULT_BINDS }; saveBinds(input.binds); renderBinds(); } }, "Reset controls"),
        h("div.grow"),
        h("button.btn.primary.small", { onclick: close }, "Done")),
      h("div.hint", { style: { marginTop: "12px" } }, "Gamepad: left stick move · right stick aim · RT shoot · A dash · LB / RB powers · X prism power · Y ultimate"),
    ),
  );
}

export function howToModal(close: () => void): HTMLElement {
  return h(
    "div.overlay",
    { onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
    h(
      "div.modal.panel",
      null,
      h("h2", null, "HOW TO PLAY"),
      h("p", null, `2 to 5 players fight in a shrinking neon arena. Last one standing wins the round. Placement gives points (5 / 3 / 2 / 1 / 0) plus 1 per kill. First to ${POINTS.toWin} wins the match.`),
      h("p", null, "Your blaster holds 5 shots that reload one at a time, so time your bursts. Dash (Space) makes you briefly invincible. Hide in purple nebula clouds: enemies farther away can't see you until you shoot."),
      h("p", null, "Before each round you draft a power. You hold two (Q and E), and a new pick replaces your older one. Your ultimate (R) charges as you deal and take damage. Grab pickups: health, cooldown reset, ult charge, and the rare Prism Core (a third power on F)."),
      h("p", null, "Knock enemies into walls for bonus damage. When you're out, you become a ghost: spectate with the arrow keys, and every 10 seconds drop lava (Q) or a slow field (E) at your cursor."),
      h("div.label", { style: { marginTop: "14px" } }, "Powers"),
      h("div.howto", null, [...allPowers(), ...allUlts()].map((p) =>
        h("div.pw", null, h("img", { src: iconDataUrl(p.id, 44), alt: "" }), h("div", null, h("b", { style: { color: p.color } }, p.name.toUpperCase()), h("span", null, p.description))))),
      h("div.row", { style: { marginTop: "16px", justifyContent: "flex-end" } }, h("button.btn.primary.small", { onclick: close }, "Got it")),
    ),
  );
}

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
  const grant = (id: PowerId | UltId | "fullUlt" | "heal") => () => session.debugGrant(target.id, id);
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
        h("div.row", { style: { marginTop: "8px" } }, h("button.btn.small", { onclick: grant("fullUlt") }, "Full ult"), h("button.btn.small", { onclick: grant("heal") }, "Heal")))
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
