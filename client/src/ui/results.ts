// Between rounds: animated standings. At the end: the winner's color floods the screen,
// a podium for the top 3, full stats and the Most Chaotic Moment, then Rematch / Main Menu.

import { PLAYER_COLORS, POINTS } from "@prism/shared";
import { audio } from "../audio/audio";
import { session } from "../net/session";
import { h } from "./dom";

const colorOf = (id: number) => PLAYER_COLORS[session.playerColor(id)]?.hex ?? "#fff";

export function standingsScreen(): HTMLElement {
  const re = session.roundEnd;
  const players = [...(session.room?.players ?? [])].sort((a, b) => b.points - a.points);
  const gained = new Map(re?.placements.map((p) => [p.playerId, p.points] as const) ?? []);
  const place = new Map(re?.placements.map((p) => [p.playerId, p.place] as const) ?? []);
  const rows = players.map((p, i) => {
    const bar = h("div", { style: { width: `${Math.min(100, ((p.points - (gained.get(p.id) ?? 0)) / POINTS.toWin) * 100)}%` } });
    requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = `${Math.min(100, (p.points / POINTS.toWin) * 100)}%`)));
    return h(
      "div.stand-row",
      { style: { "--c": colorOf(p.id), animationDelay: `${i * 0.08}s` } },
      h("div.place", null, `#${place.get(p.id) ?? "-"}`),
      h("div", null, h("div", { style: { fontFamily: "var(--display)", fontWeight: "700", color: colorOf(p.id) } }, p.name), h("div.bar", null, bar)),
      h("div.gain", null, gained.get(p.id) ? `+${gained.get(p.id)}` : ""),
      h("div.pts", null, String(p.points)),
    );
  });
  const winner = re ? session.playerName(re.winnerId) : "";
  return h(
    "div.screen",
    null,
    h("h2.phase-title", null, `ROUND ${session.round} COMPLETE`),
    h("div.hint", { style: { marginBottom: "18px" } }, winner ? `${winner} took the round · first to ${POINTS.toWin} points wins` : `First to ${POINTS.toWin} points wins`),
    h("div.panel.standings", null, rows),
  );
}

export function matchEndScreen(): HTMLElement {
  const m = session.matchEnd;
  if (!m) return h("div.screen", null, h("div.hint", null, "Tallying results…"));
  const players = [...(session.room?.players ?? [])].sort((a, b) => b.points - a.points);
  const winCol = colorOf(m.winnerId);
  const podiumOrder = [players[1], players[0], players[2]].filter((p) => !!p);
  const heights = new Map([[players[0]?.id ?? -1, 150], [players[1]?.id ?? -2, 105], [players[2]?.id ?? -3, 75]]);
  const statsFor = (id: number) => m.stats.find((s) => s.playerId === id);
  const chaos = m.chaosMoment;
  queueMicrotask(() => audio.sfx("combo", 0, 0, { positional: false, pitch: 0.75 }));
  return h(
    "div.screen",
    { style: { "--c": winCol } },
    h("div.winner-flood", { style: { "--c": winCol } }),
    h("h2.phase-title", { style: { color: winCol, textShadow: `0 0 40px ${winCol}` } }, `${session.playerName(m.winnerId).toUpperCase()} WINS`),
    h(
      "div.podium",
      null,
      podiumOrder.map((p, i) =>
        h(
          "div.step",
          { style: { "--c": colorOf(p.id), animationDelay: `${0.3 + i * 0.15}s` } },
          h("div.orb", { style: { "--c": colorOf(p.id), margin: "0 auto" } }),
          h("div.who", null, p.name),
          h("div.block", { style: { height: `${heights.get(p.id) ?? 60}px` } }, players[0]?.id === p.id ? "1" : players[1]?.id === p.id ? "2" : "3"),
        ),
      ),
    ),
    h(
      "table.stats",
      null,
      h("tr", null, ["Player", "Points", "Kills", "Damage", "Accuracy", "Powers", "Combos", "Rounds won"].map((t) => h("th", null, t))),
      players.map((p) => {
        const s = statsFor(p.id);
        const acc = s && s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
        return h(
          "tr",
          null,
          h("td.n", { style: { color: colorOf(p.id) } }, p.name),
          h("td", null, String(p.points)),
          h("td", null, String(s?.kills ?? 0)),
          h("td", null, String(s?.damage ?? 0)),
          h("td", null, `${acc}%`),
          h("td", null, String(s?.powersUsed ?? 0)),
          h("td", null, String(s?.combos ?? 0)),
          h("td", null, String(s?.roundWins ?? 0)),
        );
      }),
    ),
    chaos ? h("div.chaos", null, "Most Chaotic Moment: ", h("b", { style: { color: colorOf(chaos.playerId) } }, session.playerName(chaos.playerId)), ` dealt ${chaos.damage} damage in 3 seconds (round ${chaos.round})`) : null,
    h(
      "div.row",
      { style: { marginTop: "10px" } },
      h("button.btn.primary", { onclick: () => session.rematch(), "data-nav": "1" }, "Rematch"),
      h("button.btn", { onclick: () => session.leave(), "data-nav": "1" }, "Main menu"),
    ),
  );
}

export function scoreboard(): HTMLElement {
  const players = [...(session.room?.players ?? [])].sort((a, b) => b.points - a.points);
  const view = session.view;
  return h(
    "div.scoreboard.panel",
    null,
    h("h2.phase-title", { style: { fontSize: "20px" } }, `ROUND ${session.round} · FIRST TO ${POINTS.toWin}`),
    h(
      "table.stats",
      { style: { width: "100%" } },
      h("tr", null, ["Player", "Points", "Status"].map((t) => h("th", null, t))),
      players.map((p) => {
        const alive = view?.latest?.ents.get(p.id);
        const isAlive = alive ? ((alive[7] ?? 0) & 1) === 1 : false;
        return h("tr", null, h("td.n", { style: { color: colorOf(p.id) } }, p.name, p.bot ? " · bot" : ""), h("td", null, String(p.points)), h("td", null, isAlive ? "alive" : "ghost"));
      }),
    ),
  );
}
