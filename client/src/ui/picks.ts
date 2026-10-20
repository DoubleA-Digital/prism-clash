// Ultimate select (1 of 3 at match start), the power draft (3D cards, 15 s timer, hidden picks)
// and the simultaneous loadout reveal where every player's cards flip over together.

import { MATCH, PLAYER_COLORS, type PowerId, type UltId } from "@prism/shared";
import { keyLabel, loadBinds, type Action } from "../input/input";
import { session } from "../net/session";
import { portraitCanvas } from "./heroPortrait";
import { h, raw } from "./dom";
import { reducedMotion, rem, tilt } from "./fx";
import { iconDataUrl, powerInfo } from "./icons";
import type { Built } from "./types";

const CLOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8.5" r="5.8"/><path d="M8 5.2v3.6l2.3 1.4"/></svg>`;
const BOLT = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.2 1 3 9h4l-1 6 7-9H9z"/></svg>`;

const colorOf = (id: number) => PLAYER_COLORS[session.playerColor(id)]?.hex ?? "#fff";
const keyName = (a: Action) => keyLabel(loadBinds()[a]);

function card(id: PowerId | UltId, i: number, ult: boolean, badge: string | null, onPick: () => void): HTMLElement {
  const info = powerInfo(id);
  const known = info.name !== id;
  const el = h(
    "button.card",
    { style: { "--c": info.color, "--i": String(i) }, "data-nav": "1", "aria-label": `${info.name}: ${info.description}`, onclick: onPick },
    h(
      "div.card-inner",
      null,
      h("span.kbd.dark.hotkey", null, String(i + 1)),
      badge ? h("div.comeback", null, badge) : null,
      h("div.card-icon", null, known ? h("img", { src: iconDataUrl(id, rem(8.6)), alt: "" }) : h("div.nogfx")),
      h("div.type", null, ult ? "ULTIMATE" : "POWER"),
      h("h3", null, (known ? info.name : "???").toUpperCase()),
      h("p", null, info.description),
      h("div.foot", null, ult ? raw("span", "chip", `${BOLT} CHARGES IN COMBAT`) : raw("span", "chip", `${CLOCK} ${info.cooldown ?? "?"}s COOLDOWN`)),
    ),
    h("div.lock-stamp", null, h("span", null, "LOCKED IN")),
  );
  const inner = el.querySelector<HTMLElement>(".card-inner");
  if (inner) tilt(inner);
  return el;
}

interface PickCfg {
  kicker: string;
  title: string;
  hint: (string | HTMLElement)[];
  ids: (PowerId | UltId)[];
  ult: boolean;
  badge: (i: number) => string | null;
  total: number;
  pick: (i: number) => void;
}

function pickScreen(cfg: PickCfg): Built {
  const cards = h("div.cards");
  const els = cfg.ids.map((id, i) => card(id, i, cfg.ult, cfg.badge(i), () => cfg.pick(i)));
  cards.append(...els);

  const fill = h("div.fill");
  const num = h("div.num", null, String(Math.ceil(cfg.total)));
  const timer = h("div.pick-timer", null, h("div.track", null, fill), num);
  const remaining0 = session.phaseRemaining();
  const total = Math.max(cfg.total, remaining0, 1);

  const pips = (session.room?.players ?? []).filter((p) => !p.bot).map((p) => {
    const st = h("span.st", null, "THINKING");
    const pip = h("div.pip", { style: { "--c": colorOf(p.id) } }, portraitCanvas(p.hero, colorOf(p.id), rem(1.9), "hero-mini sm"), h("span", null, p.name), st);
    return { id: p.id, pip, st };
  });
  const lockedRow = h("div.locked-row", null, pips.map((p) => p.pip));

  const screen = h(
    "div.screen.picks",
    null,
    h("div.pick-head", null, h("div.kicker", null, cfg.kicker), h("h2.phase-title", null, cfg.title), h("div.hint", null, cfg.hint)),
    timer,
    cards,
    lockedRow,
  );

  let lastSecond = -1;
  let pickedBefore: number | null = null;
  let latched: number | null = null;
  let pickedAt = 0;
  const sync = () => {
    // The server may send the next offer right after a pick (which clears session.myPick), so remember it.
    if (session.myPick !== null) latched = session.myPick;
    const mine = session.myPick ?? latched;
    els.forEach((el, i) => {
      el.classList.toggle("picked", mine === i);
      el.classList.toggle("dim", mine !== null && mine !== i);
    });
    if (mine !== null && pickedBefore === null && !reducedMotion()) {
      cards.classList.remove("shake");
      void cards.offsetWidth;
      cards.classList.add("shake");
    }
    if (mine !== null && pickedBefore === null) pickedAt = performance.now();
    pickedBefore = mine;
    for (const p of pips) {
      const done = session.draftLocked.has(p.id) || (p.id === session.myId && mine !== null);
      if (done !== p.pip.classList.contains("done")) {
        p.pip.classList.toggle("done", done);
        p.st.textContent = done ? "LOCKED" : "THINKING";
      }
    }
    timer.classList.toggle("done", mine !== null);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!screen.isConnected) {
      window.removeEventListener("keydown", onKey);
      return;
    }
    const t = e.target;
    if (t instanceof HTMLInputElement || document.querySelector(".overlay") || latched !== null) return;
    const n = Number(e.key);
    if (n >= 1 && n <= els.length) cfg.pick(n - 1);
  };
  window.addEventListener("keydown", onKey);

  const tick = () => {
    const rem0 = session.phaseRemaining();
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, rem0 / total))})`;
    const sec = Math.ceil(rem0);
    const urgent = rem0 <= 5 && latched === null;
    timer.classList.toggle("urgent", urgent);
    screen.classList.toggle("urgent", urgent);
    if (sec !== lastSecond) {
      lastSecond = sec;
      num.textContent = String(sec);
      num.classList.remove("beat");
      void num.offsetWidth;
      if (urgent) num.classList.add("beat");
    }
  };
  sync();
  tick();
  return {
    el: screen,
    update: sync,
    tick,
    hold: () => (pickedAt ? Math.max(0, 800 - (performance.now() - pickedAt)) : 0),
    dispose: () => window.removeEventListener("keydown", onKey),
  };
}

export function ultScreen(): Built {
  return pickScreen({
    kicker: "MATCH START",
    title: "CHOOSE YOUR ULTIMATE",
    hint: ["It charges as you deal and take damage. Press ", h("b", null, keyName("ult")), " (or Y) when the ring is full. You keep it all match."],
    ids: session.ultOptions,
    ult: true,
    badge: () => null,
    total: MATCH.ultSelectSeconds,
    pick: (i) => session.pickUlt(i),
  });
}

export function draftScreen(): Built {
  return pickScreen({
    kicker: "BEFORE THE DROP",
    title: "DRAFT A POWER",
    hint: ["Your first power. Find ", h("b", null, "Prism Shards"), " in crates and supply drops to draft a second one mid-match."],
    ids: session.draftOptions,
    ult: false,
    badge: () => null,
    total: MATCH.draftSeconds,
    pick: (i) => session.pickPower(i),
  });
}

/**
 * The in-match Prism Shard draft: the same cards as an overlay while you keep playing.
 * Pick with a click or the number keys (1-3 belong to the draft while it's open).
 */
export function shardOverlay(): { el: HTMLElement; tick: () => void; dispose: () => void } {
  const offer = session.shard;
  const ids = offer?.options ?? [];
  const replaces = offer?.replaces ?? null;
  const cards = h("div.cards");
  cards.append(...ids.map((id, i) => card(id, i, false, replaces ? null : "NEW SLOT", () => session.pickShard(i))));
  const fill = h("div.fill");
  const num = h("div.num", null, String(Math.ceil(offer?.total ?? 0)));
  const el = h(
    "div.shard-overlay",
    null,
    h("div.pick-head", null, h("div.kicker", null, "PRISM SHARD"), h("h2.phase-title", null, "PICK A POWER"), h("div.hint", null, replaces ? ["Replaces ", h("b", null, powerInfo(replaces).name), " · keys 1-3 or click"] : ["Fills your empty power slot · keys 1-3 or click"])),
    h("div.pick-timer", null, h("div.track", null, fill), num),
    cards,
  );
  const onKey = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (n >= 1 && n <= ids.length) session.pickShard(n - 1);
  };
  window.addEventListener("keydown", onKey);
  const tick = () => {
    const o = session.shard;
    if (!o) return;
    const rem0 = Math.max(0, (o.endsAt - performance.now()) / 1000);
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, rem0 / o.total))})`;
    const t = String(Math.ceil(rem0));
    if (num.textContent !== t) num.textContent = t;
  };
  tick();
  return { el, tick, dispose: () => window.removeEventListener("keydown", onKey) };
}
