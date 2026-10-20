// In-match overlays that are DOM rather than canvas: the ghost spectator pill.

import type { HeroId } from "@prism/shared";
import { h } from "./dom";
import { rem } from "./fx";
import { portraitCanvas } from "./heroPortrait";

export interface SpectateTarget {
  name: string;
  hero: HeroId;
  color: string;
}

export function spectateBar(): { el: HTMLElement; set: (who: SpectateTarget | null, haunt: number, lavaKey: string, slowKey: string) => void } {
  const name = h("span.nm");
  const face = h("div.face");
  const keys = h("div.keys");
  const el = h("div.spectate-bar", null, h("div.head", null, face, h("div.who", null, h("small", null, "SPECTATING"), name)), keys);
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
