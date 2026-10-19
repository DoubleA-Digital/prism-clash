// Ultimate select (1 of 3 at match start), the power draft (big animated cards, 15 s timer,
// hidden picks), and the simultaneous loadout reveal with a flip animation.

import { PLAYER_COLORS, type PowerId, type UltId } from "@prism/shared";
import { audio } from "../audio/audio";
import { session } from "../net/session";
import { h } from "./dom";
import { iconDataUrl, powerInfo } from "./icons";

function card(id: PowerId | UltId, i: number, picked: boolean, dimmed: boolean, onPick: () => void, extra: string | null) {
  const info = powerInfo(id);
  return h(
    `button.card${picked ? ".picked" : ""}${dimmed ? ".dim" : ""}`,
    {
      style: { "--c": info.color, animationDelay: `${i * 0.09}s` }, "data-nav": "1", "aria-label": `${info.name}: ${info.description}`,
      onclick: () => {
        audio.unlock();
        audio.sfx("uiConfirm", 0, 0, { positional: false });
        onPick();
      },
      onmouseenter: () => audio.sfx("ui", 0, 0, { positional: false, gain: 0.4 }),
    },
    extra ? h("div.comeback", null, extra) : null,
    h("img", { src: iconDataUrl(id, 120), alt: "" }),
    h("h3", null, info.name.toUpperCase()),
    h("p", null, info.description),
    h("div.cd", null, info.cooldown ? `COOLDOWN ${info.cooldown}s` : "ULTIMATE"),
  );
}

function timerBar(): HTMLElement {
  const inner = h("div", { style: { width: "100%" } });
  const total = Math.max(0.1, session.phaseRemaining());
  inner.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: total * 1000, easing: "linear", fill: "forwards" });
  return h("div.timer-bar", null, inner);
}

function lockedRow(): HTMLElement {
  const players = session.room?.players ?? [];
  return h(
    "div.locked-row",
    null,
    players.map((p) =>
      h(`div.pip${session.draftLocked.has(p.id) || (p.id === session.myId && session.myPick !== null) ? ".done" : ""}`, { style: { color: PLAYER_COLORS[p.color]?.hex ?? "#fff" } },
        p.name, session.draftLocked.has(p.id) || (p.id === session.myId && session.myPick !== null) ? " ✓" : " …"),
    ),
  );
}

export function ultScreen(): HTMLElement {
  const opts = session.ultOptions;
  return h(
    "div.screen",
    null,
    h("h2.phase-title", null, "CHOOSE YOUR ULTIMATE"),
    h("div.hint", null, "Charges by dealing and taking damage. Press R (or Y) when the ring is full. You keep it all match."),
    timerBar(),
    h("div.cards", null, opts.map((u, i) => card(u, i, session.myPick === i, session.myPick !== null && session.myPick !== i, () => session.pickUlt(i), null))),
  );
}

export function draftScreen(): HTMLElement {
  const opts = session.draftOptions;
  const round = session.round + (session.phase === "draft" ? 1 : 0);
  const sub = session.draftPicks > 1 ? `Pick ${session.draftPickNumber} of ${session.draftPicks}: you start with two powers` : "Your new pick replaces your older power";
  const comeback = opts.length > 3;
  return h(
    "div.screen",
    null,
    h("h2.phase-title", null, `ROUND ${round} · DRAFT A POWER`),
    h("div.hint", null, sub, comeback ? " · Comeback bonus: you get a 4th option" : ""),
    timerBar(),
    h("div.cards", null, opts.map((p, i) => card(p, i, session.myPick === i, session.myPick !== null && session.myPick !== i, () => session.pickPower(i), comeback && i === 3 ? "COMEBACK" : null))),
    lockedRow(),
  );
}

export function revealScreen(): HTMLElement {
  return h(
    "div.screen.passthrough",
    { style: { justifyContent: "flex-start", paddingTop: "13vh" } },
    h("h2.phase-title", null, "LOADOUTS"),
    h(
      "div.reveal",
      { style: { marginTop: "14px" } },
      session.loadouts.map((l, i) => {
        const col = PLAYER_COLORS[session.playerColor(l.playerId)]?.hex ?? "#fff";
        return h(
          "div.who",
          { style: { "--c": col, animationDelay: `${0.15 + i * 0.12}s` } },
          h("div.n", null, session.playerName(l.playerId)),
          h("div.ic", null, l.slots.filter((s): s is PowerId => !!s).map((s) => h("img", { src: iconDataUrl(s, 54), alt: powerInfo(s).name, title: powerInfo(s).name })),
            l.ult ? h("img", { src: iconDataUrl(l.ult, 54), alt: powerInfo(l.ult).name, title: powerInfo(l.ult).name, style: { filter: "drop-shadow(0 0 8px #ffc83d)" } }) : null),
        );
      }),
    ),
  );
}
