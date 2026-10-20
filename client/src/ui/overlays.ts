// In-match overlays that are DOM rather than canvas: the ghost spectator pill.

import { h } from "./dom";

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
      keys.replaceChildren(h("span.kbd.dark", null, "←"), h("span.kbd.dark", null, "→"), " or click to watch someone else · ", ...tail);
    },
  };
}
