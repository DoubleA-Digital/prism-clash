// Title screen + main menu: name, Play (create room), Join (code), Practice vs bots,
// Settings and How to Play. Keyboard (arrows/Enter) and gamepad (D-pad/A) navigable.

import { audio } from "../audio/audio";
import { session } from "../net/session";
import { h } from "./dom";

export interface MenuActions {
  openSettings(): void;
  openHowTo(): void;
  practice(): void;
}

function sanitize(n: string) {
  return n.replace(/[\u0000-\u001f]/g, "").slice(0, 16);
}

export function menuScreen(actions: MenuActions): HTMLElement {
  const params = new URLSearchParams(location.search);
  const inviteCode = (params.get("room") ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  const name = h("input.field.grow", { placeholder: "YOUR NAME", maxlength: "16", value: session.name, autocomplete: "off", spellcheck: "false", "aria-label": "Your name" }) as HTMLInputElement;
  const code = h("input.field.code", { placeholder: "CODE", maxlength: "5", value: inviteCode, autocomplete: "off", spellcheck: "false", style: { width: "150px" }, "aria-label": "Room code" }) as HTMLInputElement;
  const error = h("div.error", null, session.lastError ?? "");

  const needName = () => {
    const n = sanitize(name.value.trim());
    if (!n) {
      error.textContent = "Pick a name first.";
      name.focus();
      return null;
    }
    session.setName(n);
    audio.unlock();
    audio.sfx("uiConfirm", 0, 0, { positional: false });
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

  const screen = h(
    "div.screen",
    null,
    h("h1.logo", null, "PRISM", h("span", null, "CLASH")),
    h("div.tagline", null, "Neon battle royale · 2–5 players · first to 15"),
    h(
      "div.menu.panel",
      null,
      h("div.label", null, "Name"),
      h("div.row", null, name),
      inviteCode
        ? h("button.btn.primary", { onclick: join, "data-nav": "1" }, `Join room ${inviteCode}`)
        : h("button.btn.primary", { onclick: create, "data-nav": "1" }, "Create room"),
      h("div.row", null, code, h("button.btn.grow", { onclick: join, "data-nav": "1" }, "Join")),
      h("button.btn", { onclick: practice, "data-nav": "1" }, "Practice vs bots"),
      h("div.row", null, h("button.btn.small.grow", { onclick: actions.openSettings, "data-nav": "1" }, "Settings"), h("button.btn.small.grow", { onclick: actions.openHowTo, "data-nav": "1" }, "How to play")),
      error,
    ),
    h("div.corner-links", null, "WASD move · Mouse aim · Click shoot · Space dash · Q / E powers · R ultimate · gamepad supported"),
  );
  queueMicrotask(() => (session.name ? (inviteCode ? code : name) : name).focus());
  return screen;
}
