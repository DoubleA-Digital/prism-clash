// Title screen + main menu: name, Create room, Join (code), Practice vs bots, Settings and
// How to Play. Keyboard (arrows/Enter) and gamepad (D-pad/A) navigable, mouse parallax on the logo.

import { session } from "../net/session";
import { h, raw } from "./dom";
import { keyLabel, type Input } from "../input/input";
import type { Built } from "./types";

export interface MenuActions {
  openSettings(): void;
  openHowTo(): void;
  practice(): void;
}

function sanitize(n: string) {
  return n.replace(/[\u0000-\u001f]/g, "").slice(0, 16);
}

const PRISM_SVG = `<svg viewBox="0 0 1200 400" aria-hidden="true">
  <defs>
    <linearGradient id="pf" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="rb" x1="0" x2="1"><stop offset="0" stop-color="#ff2e88" stop-opacity=".0"/><stop offset=".25" stop-color="#ff2e88" stop-opacity=".22"/><stop offset=".5" stop-color="#ffc83d" stop-opacity=".16"/><stop offset=".75" stop-color="#9dff3a" stop-opacity=".16"/><stop offset="1" stop-color="#00f0ff" stop-opacity=".0"/></linearGradient>
  </defs>
  <g class="fanfill"><path d="M 600 200 L 1200 40 L 1200 360 Z" fill="url(#rb)"/></g>
  <path class="beam-in" d="M 0 232 L 560 205" stroke="#fff" stroke-width="3" stroke-opacity=".7" fill="none"/>
  <g fill="none" stroke-width="3" stroke-opacity=".85">
    <path class="ray" d="M 612 196 L 1200 70" stroke="#ff2e88"/><path class="ray" d="M 614 198 L 1200 140" stroke="#ffc83d"/>
    <path class="ray" d="M 614 200 L 1200 205" stroke="#9dff3a"/><path class="ray" d="M 612 202 L 1200 270" stroke="#00f0ff"/>
    <path class="ray" d="M 610 204 L 1200 335" stroke="#a970ff"/>
  </g>
  <path class="tri" d="M 600 150 L 650 238 L 550 238 Z" fill="rgba(255,255,255,0.06)" stroke="#fff" stroke-width="2" stroke-opacity=".8"/>
</svg>`;

function word(text: string, extra = ""): HTMLElement {
  return h(
    `span.word${extra}`,
    { "aria-hidden": "true" },
    h("span.ghost.c", null, text),
    h("span.ghost.m", null, text),
    h("span.face", null, text),
    h("span.scan", null, text),
    h("span.shimmer", null, text),
  );
}

export function menuScreen(actions: MenuActions, input: Input): Built {
  const params = new URLSearchParams(location.search);
  const inviteCode = (params.get("room") ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  const name = h("input.field", { placeholder: "YOUR NAME", maxlength: "16", value: session.name, autocomplete: "off", spellcheck: "false", "aria-label": "Your name" }) as HTMLInputElement;
  const code = h("input.field.code", { placeholder: "CODE", maxlength: "5", value: inviteCode, autocomplete: "off", spellcheck: "false", "aria-label": "Room code" }) as HTMLInputElement;
  const error = h("div.error.m-item", { style: { "--i": "8" }, role: "alert" }, session.lastError ?? "");

  const needName = () => {
    const n = sanitize(name.value.trim());
    if (!n) {
      error.textContent = "Pick a name first.";
      name.focus();
      name.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 220, iterations: 2 });
      return null;
    }
    session.setName(n);
    return n;
  };
  const create = () => {
    if (needName()) session.createRoom();
  };
  const join = () => {
    if (!needName()) return;
    const c = code.value.toUpperCase().replace(/[^A-Z]/g, "");
    if (c.length !== 5) {
      error.textContent = "Room codes are 5 letters.";
      code.focus();
      return;
    }
    session.joinRoom(c);
  };
  const practice = () => {
    if (needName()) actions.practice();
  };

  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (inviteCode ? join : create)();
  });
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
  code.addEventListener("input", () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  const item = (i: number, el: HTMLElement) => {
    el.classList.add("m-item");
    el.style.setProperty("--i", String(i));
    return el;
  };
  const card = h(
    "div.menu-card.panel",
    null,
    item(0, h("div.row", null, h("div.label", { style: { whiteSpace: "nowrap" } }, "Pilot"), name)),
    item(1, inviteCode ? h("button.btn.primary", { onclick: join, "data-nav": "1" }, `Join room ${inviteCode}`) : h("button.btn.primary", { onclick: create, "data-nav": "1" }, "Create room")),
    item(2, h("div.code-row", null, code, h("button.btn", { onclick: join, "data-nav": "1" }, "Join"))),
    item(3, h("div.divider", null, "OR")),
    item(4, h("button.btn.gold", { onclick: practice, "data-nav": "1" }, "Practice vs bots")),
    item(5, h("div.duo", null, h("button.btn.small", { onclick: actions.openSettings, "data-nav": "1" }, "Settings"), h("button.btn.small", { onclick: actions.openHowTo, "data-nav": "1" }, "How to play"))),
    error,
  );

  const b = input.binds;
  const hint = (code: string, text: string) => h("span", null, h("span.kbd.dark", null, keyLabel(code)), text);
  const screen = h(
    "div.screen.title",
    null,
    h(
      "div.title-stage",
      null,
      h(
        "div.logo-wrap",
        null,
        raw("div", "prism-fan", PRISM_SVG),
        h("h1.logo", { "aria-label": "Prism Clash" }, word("PRISM"), word("CLASH", ".sub")),
      ),
      h("div.tagline", null, "Neon looter-shooter", h("i"), "12 fighters", h("i"), "Last one standing"),
      card,
    ),
    h("div.keyhints", null, hint(`${b.up}`, ""), hint(b.left, ""), hint(b.down, ""), hint(b.right, " move"), hint(b.shoot, " shoot"), hint(b.reload, " reload"), hint(b.interact, " pick up"), hint(b.heal, " heal"), hint(b.throw, " grenade"), hint(b.dash, " dash"), hint(b.p1, ""), hint(b.p2, " powers"), hint(b.ult, " ultimate"), h("span", null, "Gamepad supported")),
  );

  // Mouse parallax: logo, light fan and menu card drift at different depths.
  const onMove = (e: MouseEvent) => {
    if (!screen.isConnected) {
      window.removeEventListener("mousemove", onMove);
      return;
    }
    screen.style.setProperty("--px", ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
    screen.style.setProperty("--py", ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
  };
  window.addEventListener("mousemove", onMove);

  queueMicrotask(() => (session.name ? (inviteCode ? code : name) : name).focus());
  return {
    el: screen,
    update: () => {
      if (error.textContent !== (session.lastError ?? "")) error.textContent = session.lastError ?? "";
    },
  };
}
