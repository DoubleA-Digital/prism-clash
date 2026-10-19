// Ultimate select (1 of 3 at match start), the power draft (3D cards, 15 s timer, hidden picks)
// and the simultaneous loadout reveal where every player's cards flip over together.

import { MATCH, PLAYER_COLORS, type PowerId, type UltId } from "@prism/shared";
import { session } from "../net/session";
import { coreCanvas } from "./coreView";
import { h, raw } from "./dom";
import { reducedMotion, rem, tilt } from "./fx";
import { iconDataUrl, powerInfo } from "./icons";
import type { Built } from "./types";

const CLOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8.5" r="5.8"/><path d="M8 5.2v3.6l2.3 1.4"/></svg>`;
const BOLT = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.2 1 3 9h4l-1 6 7-9H9z"/></svg>`;
const EMBLEM = `<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"><path d="M32 8 56 52H8z" fill="rgba(255,255,255,0.08)"/><path d="M32 8 32 52M20 30h24" opacity=".55"/></svg>`;

const colorOf = (id: number) => PLAYER_COLORS[session.playerColor(id)]?.hex ?? "#fff";

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

  const pips = (session.room?.players ?? []).map((p) => {
    const st = h("span.st", null, "THINKING");
    const pip = h("div.pip", { style: { "--c": colorOf(p.id) } }, coreCanvas(p.color, rem(1.5)), h("span", null, p.name), st);
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
    hint: ["It charges as you deal and take damage. Press ", h("b", null, "R"), " (or Y) when the ring is full. You keep it all match."],
    ids: session.ultOptions,
    ult: true,
    badge: () => null,
    total: MATCH.ultSelectSeconds,
    pick: (i) => session.pickUlt(i),
  });
}

export function draftScreen(): Built {
  const round = session.round + (session.phase === "draft" ? 1 : 0);
  const comeback = session.draftOptions.length > 3;
  const hint: (string | HTMLElement)[] =
    session.draftPicks > 1 ? [`Pick ${session.draftPickNumber} of ${session.draftPicks}: you start with two powers`] : ["Your new pick replaces your older power"];
  if (comeback) hint.push(" · ", h("b", null, "Comeback bonus: you get a 4th option"));
  return pickScreen({
    kicker: `ROUND ${round}`,
    title: "DRAFT A POWER",
    hint,
    ids: session.draftOptions,
    ult: false,
    badge: (i) => (comeback && i === 3 ? "COMEBACK" : null),
    total: round <= 1 ? MATCH.firstDraftSeconds : MATCH.draftSeconds,
    pick: (i) => session.pickPower(i),
  });
}

export function revealScreen(): Built {
  const cards = session.loadouts.map((l, i) => {
    const col = colorOf(l.playerId);
    const powers = l.slots.filter((s): s is PowerId => !!s);
    return h(
      "div.rv",
      { style: { "--c": col, "--i": String(i) } },
      h(
        "div.rv-card",
        null,
        h("div.face.back", null, raw("div", "", EMBLEM)),
        h(
          "div.face.front",
          null,
          coreCanvas(session.playerColor(l.playerId), rem(3)),
          h("div.n", null, session.playerName(l.playerId), l.playerId === session.myId ? h("span.you", null, "YOU") : null),
          h("div.loadout", null, powers.map((s, j) => h("div.slot-ic", { style: { "--pc": powerInfo(s).color, "--j": String(j) } }, h("img", { src: iconDataUrl(s, rem(3.2)), alt: powerInfo(s).name }), h("span", null, powerInfo(s).name.toUpperCase())))),
          l.ult ? h("div.ult-row", null, h("img", { src: iconDataUrl(l.ult, rem(1.4)), alt: "" }), h("span", null, powerInfo(l.ult).name.toUpperCase())) : null,
        ),
      ),
    );
  });
  return { el: h("div.screen.passthrough.reveal-screen", null, h("div.reveal-wrap", null, h("h2.phase-title", null, "LOADOUTS LOCKED"), h("div.reveal", null, cards))) };
}
