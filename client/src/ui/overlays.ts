// In-match overlays that are DOM rather than canvas: the ghost spectator pill (with the way
// out: back to the lobby, or the menu in practice) and the Esc menu.

import type { HeroId } from "@prism/shared";
import { h } from "./dom";
import { rem } from "./fx";
import { portraitCanvas } from "./heroPortrait";

export interface SpectateTarget {
  name: string;
  hero: HeroId;
  color: string;
}

/** Where leaving the match takes you, and the button that does it. */
export interface LeaveAction {
  label: string;
  run: () => void;
}

export function spectateBar(leave: LeaveAction): { el: HTMLElement; set: (who: SpectateTarget | null, haunt: number, lavaKey: string, slowKey: string) => void } {
  const name = h("span.nm");
  const face = h("div.face");
  const keys = h("div.keys");
  const out = h(
    "div.leave-row",
    null,
    h("button.btn.small.primary.leave-btn", { onclick: () => leave.run(), "data-nav": "1" }, leave.label),
    h("span.or", null, "or keep watching"),
  );
  const el = h("div.spectate-bar", null, h("div.head", null, face, h("div.who", null, h("small", null, "SPECTATING"), name)), keys, out);
  let lastKeys = "";
  let lastWho = "";
  return {
    el,
    set: (who, haunt, lavaKey, slowKey) => {
      const sigWho = who ? `${who.name}|${who.hero}|${who.color}` : "";
      if (sigWho !== lastWho) {
        lastWho = sigWho;
        name.textContent = who?.name ?? "";
        el.style.setProperty("--c", who?.color ?? "#ffffff");
        face.replaceChildren(...(who ? [portraitCanvas(who.hero, who.color, rem(3.2))] : []));
      }
      const sig = `${Math.ceil(haunt)}|${lavaKey}|${slowKey}`;
      if (sig === lastKeys) return;
      lastKeys = sig;
      const tail: (string | HTMLElement)[] =
        haunt > 0
          ? ["haunt ready in ", h("b", null, `${Math.ceil(haunt)}s`)]
          : [h("span.kbd.dark", null, lavaKey), " lava · ", h("span.kbd.dark", null, slowKey), " slow field ", h("b", null, "(at your cursor)")];
      keys.replaceChildren(h("span.kbd.dark", null, "←"), h("span.kbd.dark", null, "→"), " or click to watch someone else · ", ...tail);
    },
  };
}

export interface EscMenuOptions {
  leave: LeaveAction;
  /** One line under the leave button: what leaving does. */
  leaveHint: string;
  resume: () => void;
  settings: () => void;
  howTo: () => void;
}

/** The in-match Esc menu. Online the match keeps running behind it. */
export function escMenu(o: EscMenuOptions): HTMLElement {
  return h(
    "div.overlay.esc-overlay",
    { onclick: (e: Event) => { if (e.target === e.currentTarget) o.resume(); } },
    h(
      "div.modal.panel.esc-menu",
      { role: "dialog", "aria-label": "Menu" },
      h("div.modal-head", null, h("h2", null, "Menu"), h("div.tabs"), h("button.x-btn", { onclick: o.resume, "aria-label": "Close menu" }, "✕")),
      h(
        "div.esc-body",
        null,
        h("button.btn.primary", { onclick: o.resume, "data-nav": "1" }, "Resume"),
        h("button.btn", { onclick: o.settings, "data-nav": "1" }, "Settings"),
        h("button.btn", { onclick: o.howTo, "data-nav": "1" }, "How to play"),
        h("div.esc-sep"),
        h("button.btn.ghost.esc-leave", { onclick: () => o.leave.run(), "data-nav": "1" }, o.leave.label),
        h("div.hint", null, o.leaveHint),
      ),
    ),
  );
}
