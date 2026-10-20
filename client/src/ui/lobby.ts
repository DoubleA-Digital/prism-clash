// Lobby: room code + invite link, each player as their chibi hero portrait, the hero picker,
// color picker, ready toggle, and grouped host controls (fill with bots, difficulty, map,
// kick, start). While a match runs (you left after being eliminated, or joined mid-match) it
// shows how the match is going, and after one, your own result.

import { HEROES, HUMAN_COLORS, mapName, MATCH, NET, PLAY_MAPS, PLAYER_COLORS, type Difficulty, type MapId, type RoomState } from "@prism/shared";
import type { MyResult } from "../net/session";
import { audio } from "../audio/audio";
import { currentServer, inviteUrl } from "../net/serverUrl";
import { session } from "../net/session";
import { coreCanvas } from "./coreView";
import { h } from "./dom";
import { ordinal, rem } from "./fx";
import { mountHeroPicker } from "./heroPicker";
import { portraitCanvas } from "./heroPortrait";
import type { Built } from "./types";

const hex = (c: number) => PLAYER_COLORS[c]?.hex ?? "#ffffff";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The running match, as seen from the lobby: what stage it's at, who's left, the clock. */
function matchPanel(room: RoomState, clock: HTMLElement): HTMLElement {
  if (room.phase === "matchEnd") {
    return h("div.match-live.over", null, h("div.ml-k", null, "MATCH OVER"), h("div.ml-v", null, "Results are up for the players who stayed to watch"));
  }
  const m = room.match;
  const stage = room.phase === "round" ? "MATCH IN PROGRESS" : room.phase === "countdown" ? "DROPPING IN" : "PICKING LOADOUTS";
  return h(
    "div.match-live",
    null,
    h("div.ml-k", null, h("span.live-dot"), stage, room.phase === "round" ? clock : null),
    h("div.ml-v", null, h("b", null, String(m?.alive ?? 0)), h("span", null, ` / ${m?.fighters ?? MATCH.fighters} alive`)),
  );
}

/** Your line from the last match (also for anyone who left before the end). */
function resultCard(r: MyResult): HTMLElement {
  const won = r.place === 1;
  return h(
    `div.panel.last-result${won ? ".won" : ""}`,
    null,
    h("div.panel-title", null, "Your last match"),
    h(
      "div.lr-row",
      null,
      h("div.lr-place", null, ordinal(r.place), h("small", null, `of ${r.fighters}`)),
      h("div.lr-kills", null, h("b", null, String(r.kills)), r.kills === 1 ? " kill" : " kills"),
      h("div.lr-win", null, won ? "Victory royale!" : ["Won by ", h("b", null, session.playerName(r.winnerId))]),
    ),
  );
}

export function lobbyScreen(toast: (t: string) => void): Built {
  let settled = false;
  let prevReady = new Set<number>();
  const lobby = h("div.lobby");
  const screen = h("div.screen.lobby-screen", null, lobby);
  // One picker for the lobby's lifetime: re-renders move the same node, so its portraits and
  // focus survive every room update.
  const picker = mountHeroPicker(document.createElement("div"), { selected: session.hero, onSelect: (id) => session.setHero(id) });
  picker.el.classList.add("compact");

  // The match clock ticks locally between the server's once-a-second updates.
  const clock = h("span.ml-t");
  let clockBase = 0;
  let clockAt = 0;
  let clockRunning = false;

  const render = (room: RoomState) => {
    const me = room.players.find((p) => p.id === session.myId);
    const host = room.hostId === session.myId;
    // A match is being played (or its results are up) while you wait here.
    const live = room.phase !== "lobby";
    const running = live && room.phase !== "matchEnd";
    clockRunning = room.phase === "round";
    if (clockRunning && room.match && Math.abs(room.match.elapsed - (clockBase + (performance.now() - clockAt) / 1000)) > 0.6) {
      clockBase = room.match.elapsed;
      clockAt = performance.now();
    }
    const url = inviteUrl(`${location.origin}${location.pathname}`, room.code, currentServer().param);
    const local = session.mode === "local";
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
      // Still in the match (playing, watching or on the results): no ready light until they're back.
      const away = live && !p.inLobby;
      const ready = !away && (p.ready || p.host);
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
            away ? h("span.tag.inmatch", null, room.phase === "matchEnd" ? "RESULTS" : "IN MATCH") : null,
            h("span.hero-of", null, HEROES[p.hero].name),
          ),
        ),
        away ? null : h(`span.rdy${ready ? ".on" : ""}${ready && !prevReady.has(p.id) ? ".fresh" : ""}`, { title: ready ? "Ready" : "Not ready", "aria-label": ready ? "Ready" : "Not ready" }, ready ? "✓" : ""),
        host && !live && p.id !== session.myId ? h("button.kick", { onclick: () => session.kick(p.id), "aria-label": `Kick ${p.name}`, title: `Kick ${p.name}` }, "×") : null,
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
          h("div.who", null, h("div.open", null, h("span.pulse-dot"), "Open seat"), h("div.meta", null, local || fill ? "a bot fills in" : "share the code")),
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
    const onResults = room.phase === "matchEnd" ? humans.filter((p) => !p.inLobby && p.connected) : [];
    const waiting = humans.filter((p) => p.id !== room.hostId && !p.ready && (!live || p.inLobby));
    const enoughPlayers = fill || humans.length >= 2;
    // The host can't start while a match runs. Once it's over, Start brings back whoever is
    // still on the results (and starts right away if everyone is ready).
    const canStart = host && !running && (onResults.length > 0 || (waiting.length === 0 && enoughPlayers));
    const botsToAdd = fill ? Math.max(0, MATCH.fighters - humans.length) : 0;

    let why: (HTMLElement | string)[];
    if (running) why = [host ? "You can start the next match when this one ends" : "The next match can start when this one ends"];
    else if (onResults.length) why = [h("b", null, onResults.map((p) => p.name).join(", ")), host ? " still on the results: start to bring everyone back" : " still on the results"];
    else if (!host) why = ["Waiting for the host to start the match"];
    else if (!enoughPlayers) why = ["Need 2+ players: invite a friend or turn on ", h("b", null, "bots")];
    else if (waiting.length) why = ["Waiting for ", h("b", null, waiting.map((p) => p.name).join(", ")), " to ready up"];
    else why = [botsToAdd ? `Everyone is ready. ${botsToAdd} bot${botsToAdd > 1 ? "s" : ""} will fill the ${MATCH.fighters} fighter drop.` : "Everyone is ready"];

    const ready = !!me?.ready || host;
    const startLabel = onResults.length && !(waiting.length === 0 && enoughPlayers) ? "Bring everyone back" : "Start match";
    const code = room.code.split("");
    const left = h(
      "div.lobby-main",
      null,
      local
        ? h(
          "div.panel.code-panel",
          null,
          h("div.panel-title", null, "Practice"),
          h("div.share-hint", null, "This match runs right here in your browser against bots, no server needed. To play with friends, go back and create an online room."),
        )
        : h(
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
        `div.panel.me-panel${live ? ".live-lock" : ""}`,
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
        live
          ? h("div.hint", { style: { textAlign: "left" } }, "Hero and color unlock when the room is back in the lobby.")
          : host
            ? h("div.hint", { style: { textAlign: "left" } }, "You are the host: players ready up, you start the match.")
            : null,
      ),
    );

    const right = h(
      "div.lobby-side",
      null,
      live ? matchPanel(room, clock) : null,
      session.lastResult && !running ? resultCard(session.lastResult) : null,
      h(
        `div.panel.settings-panel${host && !live ? "" : ".locked"}`,
        null,
        h("div.panel-title", null, "Match settings", host ? (live ? h("span.lock", null, "AFTER THIS MATCH") : null) : h("span.lock", null, "HOST ONLY")),
        h("div.toggle", null, h("span", null, "Fill empty slots with bots"), fillSwitch),
        h("div.sec", null, h("span.label", null, "Bot difficulty"), seg<Difficulty>(["easy", "normal", "hard"], (o) => o, room.settings.botDifficulty, (v) => session.lobbySet({ botDifficulty: v }))),
        h("div.sec", null, h("span.label", null, "Map"), seg<MapId | "auto">(["auto", ...PLAY_MAPS], (o) => (o === "auto" ? "Alternate" : mapName(o)), room.settings.map, (v) => session.lobbySet({ map: v }))),
      ),
      h(
        "div.start-area",
        null,
        host
          ? h("button.btn.gold.start" + (canStart ? ".go" : ""), { onclick: () => { audio.unlock(); session.start(); }, disabled: !canStart, "data-nav": "1" }, startLabel)
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
  const tick = () => {
    if (clockRunning) clock.textContent = mmss(clockBase + (performance.now() - clockAt) / 1000);
  };
  if (session.room) render(session.room);
  return { el: screen, update: refresh, tick };
}
