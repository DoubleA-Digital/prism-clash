// Modal dialogs: Settings (tabs: general + controls with rebinding) and How to Play
// (controls diagram, round flow, scoring, survival tips, power and ultimate cards).

import { allPowers, allUlts, POINTS } from "@prism/shared";
import { audio } from "../audio/audio";
import { ACTION_LABELS, DEFAULT_BINDS, keyLabel, saveBinds, type Action, type Input } from "../input/input";
import { session } from "../net/session";
import { saveSettings, settings } from "../settings";
import { coreCanvas } from "./coreView";
import { h } from "./dom";
import { rem } from "./fx";
import { iconDataUrl } from "./icons";

interface Tab {
  id: string;
  label: string;
  render: () => HTMLElement;
}

/** Shared modal chrome: header with tabs and a close button, scrolling body, optional footer. */
function modal(title: string, tabs: Tab[], close: () => void, footer: HTMLElement | null): HTMLElement {
  const body = h("div.modal-body");
  const tabBar = h("div.tabs", { role: "tablist" });
  const buttons = tabs.map((t) =>
    h("button.tab", { role: "tab", "data-nav": "1", onclick: () => select(t.id) }, t.label),
  );
  const select = (id: string) => {
    tabs.forEach((t, i) => buttons[i]?.classList.toggle("on", t.id === id));
    const tab = tabs.find((t) => t.id === id);
    if (tab) body.replaceChildren(tab.render());
    body.scrollTop = 0;
  };
  tabBar.append(...buttons);
  select(tabs[0]?.id ?? "");
  return h(
    "div.overlay",
    { onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
    h(
      "div.modal.panel",
      { role: "dialog", "aria-label": title },
      h("div.modal-head", null, h("h2", null, title), tabBar, h("button.x-btn", { onclick: close, "aria-label": "Close", "data-nav": "1" }, "✕")),
      body,
      footer,
    ),
  );
}

function slider(label: string, value: number, onInput: (v: number) => void, min = 0, max = 1, step = 0.05) {
  const out = h("span.val", null, `${Math.round(value * 100)}%`);
  const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), "aria-label": label, "data-nav": "1" }) as HTMLInputElement;
  const paint = () => input.style.setProperty("--p", `${((Number(input.value) - min) / (max - min)) * 100}%`);
  paint();
  let last = 0;
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = `${Math.round(v * 100)}%`;
    paint();
    onInput(v);
    if (performance.now() - last > 90) {
      last = performance.now();
      audio.sfx("uiClick", 0, 0, { positional: false, gain: 0.35, pitch: 0.8 + v * 0.5 });
    }
  });
  return h("div.slider", null, h("div.top", null, h("span", null, label), out), input);
}

function toggle(label: string, on: boolean, onChange: (v: boolean) => void) {
  const sw = h(`button.switch${on ? ".on" : ""}`, { role: "switch", "aria-checked": String(on), "aria-label": label, "data-nav": "1" }) as HTMLButtonElement;
  sw.addEventListener("click", () => {
    const v = !sw.classList.contains("on");
    sw.classList.toggle("on", v);
    sw.setAttribute("aria-checked", String(v));
    onChange(v);
  });
  return h("div.toggle", null, h("span", null, label), sw);
}

export function settingsModal(input: Input, close: () => void): HTMLElement {
  const nameField = h("input.field", { value: session.name, maxlength: "16", style: { width: "100%" }, "aria-label": "Your name", "data-nav": "1" }) as HTMLInputElement;
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
      ...(Object.keys(ACTION_LABELS) as Action[]).map((a) => {
        const btn = h("button.bind-btn", { "data-nav": "1" }, keyLabel(input.binds[a])) as HTMLButtonElement;
        btn.addEventListener("click", () => {
          btn.classList.add("wait");
          btn.textContent = "Press a key…";
          input.capture = (code) => {
            if (code !== "Escape") input.binds[a] = code;
            saveBinds(input.binds);
            renderBinds();
          };
        });
        return h("div.bind-row", null, h("span", null, ACTION_LABELS[a]), btn);
      }),
    );
  };
  renderBinds();
  const pad = (k: string, t: string) => h("div", null, h("span.kbd.dark", null, k), t);

  const general: Tab = {
    id: "general",
    label: "General",
    render: () =>
      h(
        "div",
        null,
        h("div.group", null, h("div.panel-title", null, "Profile"), nameField),
        h("div.group", null, h("div.panel-title", null, "Audio"), slider("Master volume", settings.master, (v) => saveSettings({ master: v })), slider("Music", settings.music, (v) => saveSettings({ music: v })), slider("Sound effects", settings.sfx, (v) => saveSettings({ sfx: v }))),
        h(
          "div.group",
          null,
          h("div.panel-title", null, "Display & gameplay"),
          slider("Screen shake", settings.shake, (v) => saveSettings({ shake: v }), 0, 1.5),
          toggle("Colorblind mode (shape markers per player)", settings.colorblind, (v) => saveSettings({ colorblind: v })),
          toggle("Show ping", settings.showPing, (v) => saveSettings({ showPing: v })),
          toggle("Show FPS", settings.showFps, (v) => saveSettings({ showFps: v })),
        ),
      ),
  };
  const controls: Tab = {
    id: "controls",
    label: "Controls",
    render: () =>
      h(
        "div",
        null,
        h("div.group", null, h("div.panel-title", null, "Keyboard and mouse (click to rebind)"), binds),
        h("div.group", null, h("div.panel-title", null, "Gamepad"), h("div.pad-map", null, pad("L stick", "Move"), pad("R stick", "Aim"), pad("RT", "Shoot"), pad("A", "Dash"), pad("LB / RB", "Powers"), pad("X", "Prism power"), pad("Y", "Ultimate"), pad("D-pad", "Menus"))),
      ),
  };
  const done = () => {
    input.capture = null;
    close();
  };
  const foot = h(
    "div.modal-foot",
    null,
    h("button.btn.small.ghost", { onclick: () => { input.binds = { ...DEFAULT_BINDS }; saveBinds(input.binds); renderBinds(); }, "data-nav": "1" }, "Reset controls"),
    h("div.hint", null, "Changes save automatically."),
    h("button.btn.primary.small", { onclick: done, "data-nav": "1" }, "Done"),
  );
  return modal("SETTINGS", [general, controls], done, foot);
}

const cap = (label: string, desc: string, cls = "", d = 0) => h("div.cap", null, h(`div.k${cls}`, { style: { "--d": String(d) } }, label), h("div.d", null, desc));

function basics(input: Input): HTMLElement {
  const b = input.binds;
  const kl = (a: Action) => keyLabel(b[a]);
  const flow = [
    { n: "1", t: "DRAFT", d: "Pick one of 3 powers in 15 seconds. Picks stay hidden until all lock in.", c: "var(--violet)" },
    { n: "2", t: "FIGHT", d: "3-2-1, then a shrinking zone forces everyone together.", c: "var(--magenta)" },
    { n: "3", t: "REPLAY", d: "The killing blow plays back in slow motion.", c: "var(--gold)" },
    { n: "4", t: "STANDINGS", d: "Points are added, then the next draft starts.", c: "var(--cyan)" },
  ];
  return h(
    "div",
    null,
    h("div.group", null, h("div.panel-title", null, "Controls"), h("div.keys-diagram", null,
      h("div.cluster", null, h("div.cap-row", null, cap(kl("up"), "Up", "", 0)), h("div.cap-row", null, cap(kl("left"), "Left", "", 1), cap(kl("down"), "Down", "", 2), cap(kl("right"), "Right", "", 3))),
      h("div.cluster", null, h("div.cap-row", null, cap(kl("p1"), "Power 1", ".hot", 1), cap(kl("p2"), "Power 2", ".hot", 2), cap(kl("ult"), "Ultimate", ".ult", 3)), h("div.cap-row", null, cap(kl("dash"), "Dash", ".wide", 0))),
      h("div.cap", null, h("div.mouse"), h("div.d", null, "Aim + shoot")),
    )),
    h("div.group", null, h("div.panel-title", null, "Round flow"), h("div.flow", null, flow.map((f) => h("div.step", { style: { "--c": f.c } }, h("div.no", null, f.n), h("b", null, f.t), h("span", null, f.d))))),
    h("div.group", null, h("div.panel-title", null, `Scoring: first to ${POINTS.toWin} wins`), h("div.scoring", null,
      POINTS.placement.map((p, i) => h(`div.score-chip${i === 0 ? ".gold" : ""}`, null, h("div.pl-n", null, ["1ST", "2ND", "3RD", "4TH", "5TH"][i] ?? ""), h("div.pts", null, `+${p}`))),
      h("div.score-chip", null, h("div.pl-n", null, "PER KILL"), h("div.pts", null, `+${POINTS.perKill}`)),
    )),
    h("div.group", null, h("div.panel-title", null, "Survive"), h("div.tips", null,
      h("div.tip", null, h("div.demo", null, h("div.pips", null, [0, 1, 2, 3, 4].map((n) => h("i", { style: { "--n": String(n) } })))), h("h4", null, "AMMO"), h("p", null, "Your blaster holds 5 shots that reload one at a time. Time your bursts, and dash for brief invincibility.")),
      h("div.tip", null, h("div.demo", null, h("div.nebula"), coreCanvas(0, rem(2.6), { ghost: false })), h("h4", null, "HIDE IN NEBULAS"), h("p", null, "Purple clouds hide you from enemies who are far away, until you shoot.")),
      h("div.tip", null, h("div.demo", null, coreCanvas(4, rem(2.6), { ghost: true }), h("div.lava")), h("h4", null, "GHOSTS HAUNT"), h("p", null, `Out of the round? Spectate with the arrows. Every 10s drop lava (${kl("p1")}) or a slow field (${kl("p2")}) at your cursor.`)),
      h("div.tip", null, h("div.demo", null, h("span", { style: { fontSize: "2rem" } }, "💥")), h("h4", null, "WALL SLAMS"), h("p", null, "Knock enemies into walls for bonus damage. Grab pickups: health, cooldown reset, ult charge, and the rare Prism Core.")),
    )),
  );
}

function powerCards(kind: "powers" | "ults"): HTMLElement {
  const list = kind === "powers" ? allPowers() : allUlts();
  return h(
    "div",
    null,
    h("div.hint", { style: { textAlign: "left", marginBottom: "0.8rem" } }, kind === "powers" ? "Draft one before every round. You hold two at a time (a new pick replaces your older power)." : "Pick one of three at match start. It charges as you deal and take damage."),
    h("div.pgrid", null, list.map((p) => {
      const cd = "cooldown" in p && typeof p.cooldown === "number" ? `${p.cooldown}s cooldown` : "ULTIMATE";
      return h("div.pcard", { style: { "--c": p.color } }, h("img", { src: iconDataUrl(p.id, rem(3.6)), alt: "" }), h("div", null, h("b", null, p.name.toUpperCase()), h("div.cdt", null, cd), h("span", null, p.description)));
    })),
  );
}

export function howToModal(close: () => void, input: Input): HTMLElement {
  const foot = h("div.modal-foot", null, h("div.hint", null, "Press Esc to close."), h("button.btn.primary.small", { onclick: close, "data-nav": "1" }, "Got it"));
  return modal(
    "HOW TO PLAY",
    [
      { id: "basics", label: "Basics", render: () => basics(input) },
      { id: "powers", label: `Powers · ${allPowers().length}`, render: () => powerCards("powers") },
      { id: "ults", label: `Ultimates · ${allUlts().length}`, render: () => powerCards("ults") },
    ],
    close,
    foot,
  );
}
