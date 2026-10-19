// Lobby: room code + invite link, each player as a live glowing core, color picker, ready
// toggle, and grouped host controls (fill with bots, difficulty, arena, kick, start).

import { LAYOUT_NAMES, LAYOUTS, NET, PLAYER_COLORS, type Difficulty, type LayoutId, type RoomState } from "@prism/shared";
import { audio } from "../audio/audio";
import { session } from "../net/session";
import { coreCanvas } from "./coreView";
import { h } from "./dom";
import { rem } from "./fx";
import type { Built } from "./types";

const hex = (c: number) => PLAYER_COLORS[c]?.hex ?? "#ffffff";

export function lobbyScreen(toast: (t: string) => void): Built {
  let settled = false;
  let prevReady = new Set<number>();
  const lobby = h("div.lobby");
  const screen = h("div.screen.lobby-screen", null, lobby);

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
    const slots: HTMLElement[] = room.players.map((p, i) => {
      const ready = p.ready || p.host || p.bot;
      return h(
        `div.slot${p.id === session.myId ? ".me" : ""}${ready ? ".ready" : ""}`,
        { style: { "--c": hex(p.color), "--i": String(i) } },
        coreCanvas(p.color, rem(2.7), { ultReady: ready && !p.bot && !p.host }),
        h("div.name", null, p.name),
        h(
          "div.tags",
          null,
          p.host ? h("span.tag.host", null, "HOST") : null,
          p.bot ? h("span.tag.bot", null, "BOT") : null,
          !p.connected ? h("span.tag", null, "AWAY") : null,
          ready ? h(`span.tag.ready${prevReady.has(p.id) ? "" : ".fresh"}`, null, "READY") : h("span.tag", null, "NOT READY"),
          host && p.id !== session.myId ? h("button.btn.small.danger", { onclick: () => session.kick(p.id), "aria-label": `Kick ${p.name}` }, "Kick") : null,
        ),
      );
    });
    prevReady = nowReady;
    const fill = room.settings.fillBots;
    for (let i = room.players.length; i < NET.maxPlayers; i++) {
      const next = PLAYER_COLORS.find((c) => !room.players.some((p) => p.color === c.id))?.id ?? i;
      slots.push(
        h(
          `div.slot.empty${fill ? ".bot" : ""}`,
          { style: { "--i": String(i) } },
          coreCanvas(next, rem(2.7), { ghost: true }),
          fill ? "A bot fills this slot at start" : [h("span.pulse-dot"), "Open slot: share the code"],
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
          coreCanvas(c.id, rem(2.1), { ghost: false }),
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
    const botsToAdd = fill ? NET.maxPlayers - room.players.length : 0;

    let why: (HTMLElement | string)[];
    if (!host) why = ["Waiting for the host to start the match"];
    else if (!enoughPlayers) why = ["Need 2+ players: invite a friend or turn on ", h("b", null, "bots")];
    else if (waiting.length) why = ["Waiting for ", h("b", null, waiting.map((p) => p.name).join(", ")), " to ready up"];
    else why = [botsToAdd ? `Everyone is ready. ${botsToAdd} bot${botsToAdd > 1 ? "s" : ""} will join.` : "Everyone is ready"];

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
      h("div.panel.roster", null, h("div.panel-title", null, "Players", h("span.count", null, `${room.players.length}/${NET.maxPlayers}`)), h("div.slots", null, slots)),
    );

    const right = h(
      "div.lobby-side",
      null,
      h(
        "div.panel.me-panel",
        null,
        h("div.panel-title", null, "Your core"),
        swatches,
        host
          ? null
          : h(
            `button.btn.ready-btn${ready ? ".is-ready" : ".primary"}`,
            { onclick: () => session.lobbySet({ ready: !me?.ready }), "data-nav": "1" },
            ready ? [h("span.check", null, "✓"), "Ready", h("span.sub", null, "(click to undo)")] : "I'm ready",
          ),
        host ? h("div.hint", { style: { textAlign: "left" } }, "You are the host: players ready up, you start the match.") : null,
      ),
      h(
        `div.panel.settings-panel${host ? "" : ".locked"}`,
        null,
        h("div.panel-title", null, "Match settings", host ? null : h("span.lock", null, "HOST ONLY")),
        h("div.toggle", null, h("span", null, "Fill empty slots with bots"), fillSwitch),
        h("div.sec", null, h("span.label", null, "Bot difficulty"), seg<Difficulty>(["easy", "normal", "hard"], (o) => o, room.settings.botDifficulty, (v) => session.lobbySet({ botDifficulty: v }))),
        h("div.sec", null, h("span.label", null, "Arena"), seg<LayoutId | "auto">(["auto", ...LAYOUTS], (o) => (o === "auto" ? "Rotate" : LAYOUT_NAMES[o].split(" ")[0] ?? o), room.settings.layout, (v) => session.lobbySet({ layout: v }))),
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
    lobby.classList.toggle("settled", settled);
    lobby.replaceChildren(left, right);
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
