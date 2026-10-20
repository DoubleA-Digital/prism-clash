// Lobby: room code + invite link, each player as their chibi hero portrait, the hero picker,
// color picker, ready toggle, and grouped host controls (fill with bots, difficulty, map,
// kick, start).

import { HEROES, HUMAN_COLORS, mapName, MATCH, NET, PLAY_MAPS, PLAYER_COLORS, type Difficulty, type MapId, type RoomState } from "@prism/shared";
import { audio } from "../audio/audio";
import { session } from "../net/session";
import { coreCanvas } from "./coreView";
import { h } from "./dom";
import { rem } from "./fx";
import { mountHeroPicker } from "./heroPicker";
import { portraitCanvas } from "./heroPortrait";
import type { Built } from "./types";

const hex = (c: number) => PLAYER_COLORS[c]?.hex ?? "#ffffff";

export function lobbyScreen(toast: (t: string) => void): Built {
  let settled = false;
  let prevReady = new Set<number>();
  const lobby = h("div.lobby");
  const screen = h("div.screen.lobby-screen", null, lobby);
  // One picker for the lobby's lifetime: re-renders move the same node, so its portraits and
  // focus survive every room update.
  const picker = mountHeroPicker(document.createElement("div"), { selected: session.hero, onSelect: (id) => session.setHero(id) });
  picker.el.classList.add("compact");

  const render = (room: RoomState) => {
    const me = room.players.find((p) => p.id === session.myId);
    const host = room.hostId === session.myId;
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    const copy = async (text: string, msg: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(msg);
      } catch {
        toast(text);
      }
    };

    const nowReady = new Set(room.players.filter((p) => p.ready || p.host).map((p) => p.id));
    // Ten compact seats in two columns: portrait, name, hero + tags, a ready light, and (for the
    // host) a small kick button.
    const seats = room.players.filter((p) => !p.bot);
    const slots: HTMLElement[] = seats.map((p, i) => {
      const ready = p.ready || p.host;
      return h(
        `div.slot${p.id === session.myId ? ".me" : ""}${ready ? ".ready" : ""}`,
        { style: { "--c": hex(p.color), "--i": String(i) }, title: p.name },
        h("div.slot-hero", null, portraitCanvas(p.hero, hex(p.color), Math.round(rem(2.8)))),
        h(
          "div.who",
          null,
          h("div.name", null, p.name),
          h(
            "div.meta",
            null,
            p.host ? h("span.tag.host", null, "HOST") : null,
            !p.connected ? h("span.tag", null, "AWAY") : null,
            h("span.hero-of", null, HEROES[p.hero].name),
          ),
        ),
        h(`span.rdy${ready ? ".on" : ""}${ready && !prevReady.has(p.id) ? ".fresh" : ""}`, { title: ready ? "Ready" : "Not ready", "aria-label": ready ? "Ready" : "Not ready" }, ready ? "✓" : ""),
        host && p.id !== session.myId ? h("button.kick", { onclick: () => session.kick(p.id), "aria-label": `Kick ${p.name}`, title: `Kick ${p.name}` }, "×") : null,
      );
    });
    prevReady = nowReady;
    const fill = room.settings.fillBots;
    for (let i = seats.length; i < NET.maxPlayers; i++) {
      const next = PLAYER_COLORS.find((c) => !room.players.some((p) => p.color === c.id))?.id ?? i % HUMAN_COLORS;
      slots.push(
        h(
          `div.slot.empty${fill ? ".bot" : ""}`,
          { style: { "--i": String(i) } },
          coreCanvas(next, rem(2), { ghost: true }),
          h("div.who", null, h("div.open", null, h("span.pulse-dot"), "Open seat"), h("div.meta", null, fill ? "a bot fills in" : "share the code")),
        ),
      );
    }

    const taken = new Set(room.players.filter((p) => p.id !== session.myId).map((p) => p.color));
    const swatches = h(
      "div.swatches",
      null,
      PLAYER_COLORS.map((c) =>
        h(
          `button.swatch${me?.color === c.id ? ".on" : ""}${taken.has(c.id) ? ".taken" : ""}`,
          { style: { "--c": c.hex }, title: c.name, "aria-label": `${c.name}${taken.has(c.id) ? " (taken)" : ""}`, "data-nav": "1", onclick: () => session.lobbySet({ color: c.id }) },
          coreCanvas(c.id, rem(1.75), { ghost: false }),
        ),
      ),
    );

    const seg = <T extends string>(options: readonly T[], labels: (o: T) => string, value: T, onPick: (v: T) => void) =>
      h("div.seg", null, options.map((o) => h(`button${o === value ? ".on" : ""}`, { onclick: () => onPick(o), disabled: !host, "data-nav": host ? "1" : null }, labels(o))));

    const fillSwitch = h(`button.switch${fill ? ".on" : ""}`, { onclick: () => session.lobbySet({ fillBots: !fill }), disabled: !host, "aria-label": "Fill empty slots with bots", "data-nav": host ? "1" : null });
    const humans = room.players.filter((p) => !p.bot);
    const waiting = humans.filter((p) => p.id !== room.hostId && !p.ready);
    const enoughPlayers = fill || room.players.length >= 2;
    const canStart = host && waiting.length === 0 && enoughPlayers;
    const botsToAdd = fill ? Math.max(0, MATCH.fighters - humans.length) : 0;

    let why: (HTMLElement | string)[];
    if (!host) why = ["Waiting for the host to start the match"];
    else if (!enoughPlayers) why = ["Need 2+ players: invite a friend or turn on ", h("b", null, "bots")];
    else if (waiting.length) why = ["Waiting for ", h("b", null, waiting.map((p) => p.name).join(", ")), " to ready up"];
    else why = [botsToAdd ? `Everyone is ready. ${botsToAdd} bot${botsToAdd > 1 ? "s" : ""} will fill the ${MATCH.fighters} fighter drop.` : "Everyone is ready"];

    const ready = !!me?.ready || host;
    const code = room.code.split("");
    const left = h(
      "div.lobby-main",
      null,
      h(
        "div.panel.code-panel",
        null,
        h("div.panel-title", null, "Room code"),
        h("div.code-tiles", { title: "Click to copy the code", onclick: () => void copy(room.code, "Room code copied") }, code.map((ch, i) => h("div.code-tile", { style: { "--i": String(i) } }, ch))),
        h(
          "div.share-row",
          null,
          h("input.field", { value: url, readonly: true, "aria-label": "Invite link", onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
          h("button.btn.small", { onclick: () => void copy(url, "Invite link copied"), "data-nav": "1" }, "Copy invite link"),
        ),
        h("div.share-hint", null, "Friends open this link to jump straight into your room."),
      ),
      h("div.panel.roster", null, h("div.panel-title", null, "Players", h("span.count", null, `${humans.length}/${NET.maxPlayers}`)), h("div.slots", null, slots)),
    );

    const hero = h(
      "div.lobby-hero",
      null,
      h(
        "div.panel.me-panel",
        null,
        h("div.panel-title", null, "Your hero", me ? h("span.hero-pick-name", null, HEROES[me.hero].name, h("small", null, HEROES[me.hero].tagline)) : null),
        picker.el,
        h("div.sec.color-sec", null, h("span.label", null, "Neon color"), swatches),
        host
          ? null
          : h(
            `button.btn.ready-btn${ready ? ".is-ready" : ".primary"}`,
            { onclick: () => session.lobbySet({ ready: !me?.ready }), "data-nav": "1" },
            ready ? [h("span.check", null, "✓"), "Ready", h("span.sub", null, "(click to undo)")] : "I'm ready",
          ),
        host ? h("div.hint", { style: { textAlign: "left" } }, "You are the host: players ready up, you start the match.") : null,
      ),
    );

    const right = h(
      "div.lobby-side",
      null,
      h(
        `div.panel.settings-panel${host ? "" : ".locked"}`,
        null,
        h("div.panel-title", null, "Match settings", host ? null : h("span.lock", null, "HOST ONLY")),
        h("div.toggle", null, h("span", null, "Fill empty slots with bots"), fillSwitch),
        h("div.sec", null, h("span.label", null, "Bot difficulty"), seg<Difficulty>(["easy", "normal", "hard"], (o) => o, room.settings.botDifficulty, (v) => session.lobbySet({ botDifficulty: v }))),
        h("div.sec", null, h("span.label", null, "Map"), seg<MapId | "auto">(["auto", ...PLAY_MAPS], (o) => (o === "auto" ? "Alternate" : mapName(o)), room.settings.map, (v) => session.lobbySet({ map: v }))),
      ),
      h(
        "div.start-area",
        null,
        host
          ? h("button.btn.gold.start" + (canStart ? ".go" : ""), { onclick: () => { audio.unlock(); session.start(); }, disabled: !canStart, "data-nav": "1" }, "Start match")
          : null,
        h("div.why", null, why),
        h("button.btn.small.ghost", { onclick: () => session.leave(), "data-nav": "1" }, "Leave room"),
      ),
    );
    if (me) {
      picker.setColor(hex(me.color));
      picker.setSelected(me.hero);
    }
    lobby.classList.toggle("settled", settled);
    lobby.replaceChildren(left, hero, right);
    settled = true;
  };

  const refresh = () => {
    const active = document.activeElement;
    const navs = [...screen.querySelectorAll("[data-nav]")];
    const idx = active ? navs.indexOf(active) : -1;
    if (session.room) render(session.room);
    if (idx >= 0) (screen.querySelectorAll<HTMLElement>("[data-nav]")[idx])?.focus({ preventScroll: true });
  };
  if (session.room) render(session.room);
  return { el: screen, update: refresh };
}
