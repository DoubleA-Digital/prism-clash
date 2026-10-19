// In-match overlays that are DOM rather than canvas: the ghost spectator pill and the
// cinematic letterbox bars for the slow-motion replay.

import { PLAYER_COLORS } from "@prism/shared";
import { session } from "../net/session";
import { h } from "./dom";

const colorOf = (id: number) => PLAYER_COLORS[session.playerColor(id)]?.hex ?? "#fff";

export function spectateBar(): { el: HTMLElement; set: (who: string, haunt: number, lavaKey: string, slowKey: string) => void } {
  const name = h("span.nm");
  const keys = h("div.keys");
  const el = h("div.spectate-bar", null, h("div.who", null, h("small", null, "SPECTATING"), name), keys);
  let lastKeys = "";
  return {
    el,
    set: (who, haunt, lavaKey, slowKey) => {
      if (name.textContent !== who) name.textContent = who;
      const sig = `${Math.ceil(haunt)}|${lavaKey}|${slowKey}`;
      if (sig === lastKeys) return;
      lastKeys = sig;
      const tail: (string | HTMLElement)[] =
        haunt > 0
          ? ["haunt ready in ", h("b", null, `${Math.ceil(haunt)}s`)]
          : [h("span.kbd.dark", null, lavaKey), " lava · ", h("span.kbd.dark", null, slowKey), " slow field ", h("b", null, "(at your cursor)")];
      keys.replaceChildren(h("span.kbd.dark", null, "←"), h("span.kbd.dark", null, "→"), " or click to switch · ", ...tail);
    },
  };
}

export function replayBars(): HTMLElement {
  const re = session.roundEnd;
  const kv = re
    ? h(
      "div.kv",
      null,
      h("span", { style: { color: colorOf(re.killerId) } }, session.playerName(re.killerId)),
      h("i", null, "⟶"),
      h("span", { style: { color: colorOf(re.victimId) } }, session.playerName(re.victimId)),
    )
    : null;
  return h("div.replay-bars", null, h("div.replay-rec", null, "REPLAY"), h("div.replay-title", null, h("div.tt", null, "THE FINAL BLOW"), kv));
}
