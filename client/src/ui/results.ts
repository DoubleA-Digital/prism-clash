// Match end: the winner's color floods the screen, a podium for the top 3 placements, full
// stats (placement, kills, damage, accuracy, survival, loot, powers) and the Most Chaotic
// Moment. Also the Tab scoreboard during the match.

import { PLAYER_COLORS } from "@prism/shared";
import { session } from "../net/session";
import { h, raw } from "./dom";
import { confetti, ordinal, rem } from "./fx";
import { portraitCanvas } from "./heroPortrait";
import { history } from "./history";
import type { Built } from "./types";

const colorOf = (id: number) => PLAYER_COLORS[session.playerColor(id)]?.hex ?? "#fff";
const portrait = (id: number, size: number, cls?: string) => portraitCanvas(session.playerHero(id), colorOf(id), Math.round(size), cls);
const CROWN = `<svg viewBox="0 0 32 24"><path d="M2 20 0 5l8 7 8-11 8 11 8-7-2 15z" fill="#ffc83d" stroke="#fff3c4" stroke-width="1.6" stroke-linejoin="round"/><rect x="3" y="20" width="26" height="3" rx="1.4" fill="#ff9f1c"/></svg>`;
const crown = (extra = "") => raw("div", `crown${extra}`, CROWN);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function matchEndScreen(root: HTMLElement): Built {
  const m = session.matchEnd;
  if (!m) return { el: h("div.screen", null, h("div.hint", null, "Tallying results…")) };
  const stats = [...m.stats].sort((a, b) => a.place - b.place || b.kills - a.kills);
  const roomPlayer = (id: number) => session.room?.players.find((p) => p.id === id);
  const winCol = colorOf(m.winnerId);
  const top3 = stats.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]].filter((p): p is NonNullable<typeof p> => !!p);
  const sizes = [rem(8.4), rem(6.4), rem(5.8)];
  const heights = [rem(11), rem(8), rem(6)];
  const chaos = m.chaosMoment;
  const mine = stats.find((s) => s.playerId === session.myId);

  const podium = h(
    "div.podium",
    null,
    podiumOrder.map((s, idx) => {
      const rank = podiumOrder.length === 1 ? 1 : idx === 1 ? 1 : idx === 0 ? 2 : 3;
      const delay = 0.5 + (rank === 1 ? 0.5 : rank === 2 ? 0.15 : 0);
      return h(
        "div.step",
        { style: { "--c": colorOf(s.playerId), animationDelay: `${delay}s` } },
        h("div.corewrap", null, rank === 1 ? crown() : null, portrait(s.playerId, sizes[rank - 1] ?? rem(5.6), "hero-podium")),
        h("div.who", null, session.playerName(s.playerId)),
        h("div.block", { style: { height: `${heights[rank - 1] ?? rem(5)}px`, animationDelay: `${delay}s` } }, h("div.rank", null, ordinal(s.place)), h("div.pt", null, `${s.kills} kill${s.kills === 1 ? "" : "s"}`)),
      );
    }),
  );

  const cols: { t: string; v: (s: (typeof stats)[number]) => number; f?: (n: number) => string; low?: boolean }[] = [
    { t: "Place", v: (s) => s.place, f: (n) => ordinal(n), low: true },
    { t: "Kills", v: (s) => s.kills },
    { t: "Damage", v: (s) => s.damage },
    { t: "Accuracy", v: (s) => (s.shots ? Math.round((s.hits / s.shots) * 100) : 0), f: (n) => `${n}%` },
    { t: "Survived", v: (s) => s.survived, f: mmss },
    { t: "Looted", v: (s) => s.looted },
    { t: "Powers", v: (s) => s.powersUsed },
  ];
  const best = cols.map((c) => (c.low ? Math.min(...stats.map((s) => c.v(s))) : Math.max(...stats.map((s) => c.v(s)))));
  const table = h(
    "table.stats",
    null,
    h("tr", null, h("th", null, "Pilot"), cols.map((c) => h("th", null, c.t))),
    stats.map((s, i) =>
      h(
        `tr${i === 0 ? ".first" : ""}${s.playerId === session.myId ? ".me" : ""}`,
        { style: { "--c": colorOf(s.playerId) } },
        h("td.n", { style: { color: colorOf(s.playerId) } }, h("div.in", null, portrait(s.playerId, rem(1.9), "hero-mini sm"), session.playerName(s.playerId), roomPlayer(s.playerId)?.bot ? h("span.tag.bot", null, "BOT") : null)),
        cols.map((c, ci) => {
          const v = c.v(s);
          return h(`td${(c.low ? v === best[ci] : v > 0 && v === best[ci]) ? ".best" : ""}`, null, c.f ? c.f(v) : String(v));
        }),
      ),
    ),
  );

  const won = m.winnerId === session.myId;
  const screen = h(
    "div.screen.matchend",
    { style: { "--c": winCol } },
    h("div.winner-flood"),
    h("div.win-kicker", null, won ? "VICTORY ROYALE" : mine ? `YOU PLACED ${ordinal(mine.place).toUpperCase()} OF ${stats.length}` : "MATCH COMPLETE"),
    h("h2.phase-title.win-title", null, `${session.playerName(m.winnerId).toUpperCase()} WINS`),
    h(
      "div.end-grid",
      null,
      podium,
      h(
        "div.end-right",
        null,
        h("div.table-wrap", null, table),
        chaos
          ? h("div.chaos", null, h("span.flame", null, "🔥"), h("div", null, h("div.lbl", null, "MOST CHAOTIC MOMENT"), h("div.txt", null, h("b", { style: { color: colorOf(chaos.playerId) } }, session.playerName(chaos.playerId)), ` dealt ${chaos.damage} damage in 3 seconds`)))
          : null,
      ),
      // Practice: straight into a rematch. Online: back to the room's lobby (the host starts the
      // next match from there, and whoever is still here comes along).
      h(
        "div.end-actions",
        null,
        session.practice
          ? h("button.btn.primary", { onclick: () => session.rematch(), "data-nav": "1" }, "Rematch")
          : h("button.btn.primary", { onclick: () => session.leaveMatch(), "data-nav": "1" }, "Back to lobby"),
        h("button.btn", { onclick: () => session.leave(), "data-nav": "1" }, "Main menu"),
      ),
    ),
  );
  // (The placement stinger plays from the game loop as the results arrive.)
  queueMicrotask(() => confetti(winCol, root));
  return { el: screen };
}

/** The Tab scoreboard: who's still in, kills, and elimination order. Refreshed while held. */
export function scoreboard(): { el: HTMLElement; refresh: () => void } {
  const body = h("tbody");
  const title = h("h2");
  const el = h("div.scoreboard.panel", null, title, h("table.sb-table", null, body));
  const refresh = () => {
    const alive = new Set(session.view?.alive ?? []);
    const players = [...(session.room?.players ?? [])].sort(
      (a, b) => Number(alive.has(b.id)) - Number(alive.has(a.id)) || history.kills(b.id) - history.kills(a.id) || history.eliminated(b.id) - history.eliminated(a.id),
    );
    title.replaceChildren(`${alive.size} ALIVE`, h("span", null, `${players.length} FIGHTERS · LAST ONE STANDING WINS`));
    const head = h("tr", null, h("th"), h("th", null, "Pilot"), h("th", null, "Kills"), h("th", null, "Status"));
    const trs = players.map((p, i) => {
      const isAlive = alive.has(p.id);
      const out = history.eliminated(p.id);
      return h(
        `tr${p.id === session.myId ? ".me" : ""}${isAlive ? "" : ".dead"}`,
        { style: { color: colorOf(p.id) } },
        h("td", null, String(i + 1)),
        h("td.nm", null, h("div.in", null, portrait(p.id, rem(2), "hero-mini sm"), h("span", null, p.name), p.bot ? h("span.tag.bot", null, "BOT") : null)),
        h("td", null, String(history.kills(p.id))),
        h("td", null, h(`span.${isAlive ? "alive" : "ghost"}`, null, isAlive ? "ALIVE" : out ? `OUT #${players.length - out + 1}` : "OUT")),
      );
    });
    body.replaceChildren(head, ...trs);
  };
  refresh();
  return { el, refresh };
}
