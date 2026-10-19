// Lobby: room code + invite link, each player as a glowing core in their color, color
// picker, ready toggle, and host controls (fill with bots, difficulty, arena, kick, start).

import { LAYOUT_NAMES, LAYOUTS, NET, PLAYER_COLORS, type Difficulty, type LayoutId, type RoomState } from "@prism/shared";
import { audio } from "../audio/audio";
import { session } from "../net/session";
import { h } from "./dom";

const click = () => audio.sfx("ui", 0, 0, { positional: false });

export function lobbyScreen(room: RoomState, toast: (t: string) => void): HTMLElement {
  const me = room.players.find((p) => p.id === session.myId);
  const host = room.hostId === session.myId;
  const url = `${location.origin}${location.pathname}?room=${room.code}`;
  const copy = async () => {
    click();
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied");
    } catch {
      toast(url);
    }
  };

  const slots: HTMLElement[] = room.players.map((p) =>
    h(
      `div.slot${p.id === session.myId ? ".me" : ""}`,
      { style: { animationDelay: "0s" } },
      h("div.orb", { style: { "--c": PLAYER_COLORS[p.color]?.hex ?? "#fff" } }),
      h("div.name", { style: { color: PLAYER_COLORS[p.color]?.hex ?? "#fff" } }, p.name),
      p.host ? h("span.tag.host", null, "HOST") : null,
      p.bot ? h("span.tag", null, "BOT") : null,
      !p.connected ? h("span.tag", null, "AWAY") : null,
      p.ready || p.host ? h("span.tag.ready", null, "READY") : h("span.tag", null, "NOT READY"),
      host && p.id !== session.myId ? h("button.btn.small.danger", { onclick: () => { click(); session.kick(p.id); } }, "Kick") : null,
    ),
  );
  for (let i = room.players.length; i < NET.maxPlayers; i++) {
    slots.push(h("div.slot.empty", null, room.settings.fillBots ? "BOT WILL FILL THIS SLOT" : "WAITING FOR PLAYER…"));
  }

  const taken = new Set(room.players.filter((p) => p.id !== session.myId).map((p) => p.color));
  const swatches = h(
    "div.swatches",
    null,
    PLAYER_COLORS.map((c) =>
      h(`button.swatch${me?.color === c.id ? ".on" : ""}${taken.has(c.id) ? ".taken" : ""}`, {
        style: { "--c": c.hex }, title: c.name, "aria-label": `${c.name}${taken.has(c.id) ? " (taken)" : ""}`, "data-nav": "1",
        onclick: () => { click(); session.lobbySet({ color: c.id }); },
      }),
    ),
  );

  const seg = <T extends string>(options: readonly T[], labels: (o: T) => string, value: T, onPick: (v: T) => void) =>
    h("div.seg", null, options.map((o) => h(`button${o === value ? ".on" : ""}`, { onclick: () => { click(); onPick(o); }, disabled: !host }, labels(o))));

  const fillSwitch = h(`button.switch${room.settings.fillBots ? ".on" : ""}`, { onclick: () => { click(); session.lobbySet({ fillBots: !room.settings.fillBots }); }, disabled: !host, "aria-label": "Fill with bots" });
  const ready = me?.ready || host;
  const humans = room.players.filter((p) => !p.bot);
  const others = humans.filter((p) => p.id !== room.hostId);
  const canStart = host && others.every((p) => p.ready) && (room.settings.fillBots || room.players.length >= 2);

  return h(
    "div.screen",
    null,
    h(
      "div.lobby",
      null,
      h(
        "div.panel",
        null,
        h("div.label", null, "Room code"),
        h("div.row", null, h("div.room-code.grow", null, room.code), h("button.btn.small", { onclick: copy, "data-nav": "1" }, "Copy invite link")),
        h("div.slots", null, slots),
      ),
      h(
        "div.panel",
        null,
        h("div.label", null, "Your color"),
        swatches,
        host ? null : h("button.btn" + (ready ? "" : ".primary"), { onclick: () => { click(); session.lobbySet({ ready: !me?.ready }); }, style: { width: "100%" }, "data-nav": "1" }, ready ? "Ready ✓ (click to unready)" : "I'm ready"),
        h("div.label", { style: { marginTop: "18px" } }, "Match settings", host ? "" : " (host only)"),
        h("div.toggle", null, h("span", null, "Fill empty slots with bots"), fillSwitch),
        h("div.label", { style: { margin: "6px 0" } }, "Bot difficulty"),
        seg<Difficulty>(["easy", "normal", "hard"], (o) => o, room.settings.botDifficulty, (v) => session.lobbySet({ botDifficulty: v })),
        h("div.label", { style: { margin: "14px 0 6px" } }, "Arena"),
        seg<LayoutId | "auto">(["auto", ...LAYOUTS], (o) => (o === "auto" ? "Rotate" : LAYOUT_NAMES[o].split(" ")[0] ?? o), room.settings.layout, (v) => session.lobbySet({ layout: v })),
        h("div", { style: { height: "18px" } }),
        host
          ? h("button.btn.primary", { onclick: () => { audio.unlock(); session.start(); }, disabled: !canStart, style: { width: "100%" }, "data-nav": "1" }, canStart ? "Start match" : "Waiting for everyone to be ready")
          : h("div.hint", null, "Waiting for the host to start…"),
        h("button.btn.small", { onclick: () => { click(); session.leave(); }, style: { width: "100%", marginTop: "10px" }, "data-nav": "1" }, "Leave room"),
      ),
    ),
  );
}
