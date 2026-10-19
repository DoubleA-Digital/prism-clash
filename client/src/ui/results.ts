// Between rounds: animated standings (point bars, +N gains, crown). At the end: the winner's color
// floods the screen, a podium for the top 3, full stats and the Most Chaotic Moment. Also the Tab scoreboard.

import { PLAYER_COLORS, POINTS } from "@prism/shared";
import { audio } from "../audio/audio";
import { session } from "../net/session";
import { coreCanvas } from "./coreView";
import { h, raw } from "./dom";
import { confetti, countUp, ordinal, rem } from "./fx";
import { history } from "./history";
import type { Built } from "./types";

const colorOf = (id: number) => PLAYER_COLORS[session.playerColor(id)]?.hex ?? "#fff";
const CROWN = `<svg viewBox="0 0 32 24"><path d="M2 20 0 5l8 7 8-11 8 11 8-7-2 15z" fill="#ffc83d" stroke="#fff3c4" stroke-width="1.6" stroke-linejoin="round"/><rect x="3" y="20" width="26" height="3" rx="1.4" fill="#ff9f1c"/></svg>`;
const crown = (extra = "") => raw("div", `crown${extra}`, CROWN);

export function standingsScreen(): Built {
  const re = session.roundEnd;
  const players = [...(session.room?.players ?? [])];
  const gained = new Map(re?.placements.map((p) => [p.playerId, p.points] as const) ?? []);
  const place = new Map(re?.placements.map((p) => [p.playerId, p.place] as const) ?? []);
  const kills = new Map(re?.placements.map((p) => [p.playerId, p.kills] as const) ?? []);
  const prev = (id: number, pts: number) => Math.max(0, pts - (gained.get(id) ?? 0));
  const before = [...players].sort((a, b) => prev(b.id, b.points) - prev(a.id, a.points) || a.id - b.id);
  const after = [...players].sort((a, b) => b.points - a.points || (place.get(a.id) ?? 9) - (place.get(b.id) ?? 9));
  const leader = after[0];
  const rowH = rem(4.9) + rem(0.55);
  const list = h("div.st-list", { style: { height: `${players.length * rowH}px` } });

  const rows = new Map<number, HTMLElement>();
  players.forEach((p) => {
    const gain = gained.get(p.id) ?? 0;
    const pPts = prev(p.id, p.points);
    const pl = place.get(p.id);
    const placePts = pl ? (POINTS.placement[pl - 1] ?? 0) : 0;
    const k = kills.get(p.id) ?? 0;
    const winner = re?.winnerId === p.id;
    const add = h("div.add", { style: { left: `${Math.min(100, (pPts / POINTS.toWin) * 100)}%` } });
    const gainEl = h("div.gain", null, gain ? `+${gain}` : "");
    const ptsEl = h("div.pts", null, String(pPts));
    const idx = before.indexOf(p);
    const row = h(
      `div.stand-row${winner ? ".winner" : ""}${p.id === session.myId ? ".me" : ""}`,
      { style: { "--c": colorOf(p.id), "--k": String(idx), transform: `translateY(${idx * rowH}px)` } },
      h("div.place", null, h("span.rk", null, `#${after.indexOf(p) + 1}`)),
      coreCanvas(p.color, rem(2.7), { ultReady: winner }),
      h(
        "div.who",
        null,
        h("div.nm", null, h("span.t", null, p.name), winner ? h("span.badge", null, "ROUND WINNER") : null, p.id === leader?.id && leader.points > 0 ? h("span.badge.lead", null, "LEADER") : null),
        h("div.detail", null, pl ? [h("b", null, ordinal(pl)), ` place · +${placePts} placement`, k ? ` · +${k} kill${k > 1 ? "s" : ""}` : ""] : "Did not play"),
        h("div.bar", null, h("div.base", { style: { width: `${Math.min(100, (pPts / POINTS.toWin) * 100)}%` } }), add),
      ),
      gainEl,
      ptsEl,
    );
    rows.set(p.id, row);
    list.append(row);
    // Gain fills the bar, the total counts up, then rows re-sort.
    requestAnimationFrame(() => requestAnimationFrame(() => (add.style.width = `${Math.min(100, (gain / POINTS.toWin) * 100)}%`)));
    countUp(ptsEl, pPts, p.points, 900, 750);
  });
  // Re-sort with a slide, then crown the leader.
  const timers: number[] = [];
  timers.push(
    window.setTimeout(() => {
      after.forEach((p, i) => {
        const row = rows.get(p.id);
        if (!row) return;
        row.style.transform = `translateY(${i * rowH}px)`;
        const pl = row.querySelector(".place");
        const rk = pl?.querySelector(".rk");
        if (rk) rk.textContent = `#${i + 1}`;
        pl?.classList.toggle("first", i === 0);
      });
      const top = after[0] && rows.get(after[0].id)?.querySelector(".place");
      if (top && after[0] && after[0].points > 0 && !top.querySelector(".crown")) top.prepend(crown());
      audio.sfx("ui", 0, 0, { positional: false, gain: 0.5 });
    }, 1900),
  );

  const winnerName = re ? session.playerName(re.winnerId) : "";
  const fill = h("div.fill");
  const nextLabel = h("div.label", null, "Next round");
  const screen = h(
    "div.screen.standings-screen",
    null,
    h("div.st-head", null, h("div.kicker", null, "STANDINGS"), h("h2.phase-title", null, `ROUND ${session.round} COMPLETE`), h("div.hint", null, winnerName ? [h("b", null, winnerName), ` took the round · first to ${POINTS.toWin} points wins`] : `First to ${POINTS.toWin} points wins`)),
    h("div.panel.standings", null, h("div.st-cols", null, h("span", null, "Rank"), h("span"), h("span", null, "Pilot"), h("span", null, "Gain"), h("span", null, "Points")), list, h("div.goal", null, "FIRST TO", h("b", null, String(POINTS.toWin)))),
    h("div.next-up", null, nextLabel, h("div.track", null, fill)),
  );
  const total = Math.max(1, session.phaseRemaining());
  return {
    el: screen,
    tick: () => {
      const r = session.phaseRemaining();
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, r / total))})`;
      const t = `Next draft in ${Math.ceil(r)}s`;
      if (nextLabel.textContent !== t) nextLabel.textContent = t;
    },
    dispose: () => timers.forEach((t) => window.clearTimeout(t)),
  };
}

export function matchEndScreen(root: HTMLElement): Built {
  const m = session.matchEnd;
  if (!m) return { el: h("div.screen", null, h("div.hint", null, "Tallying results…")) };
  const players = [...(session.room?.players ?? [])].sort((a, b) => b.points - a.points);
  const winCol = colorOf(m.winnerId);
  const top3 = players.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]].filter((p): p is NonNullable<typeof p> => !!p);
  const rankOf = (id: number) => players.findIndex((p) => p.id === id) + 1;
  const sizes = [rem(6.2), rem(4.6), rem(4.2)];
  const heights = [rem(8), rem(11), rem(6)];
  const statsFor = (id: number) => m.stats.find((s) => s.playerId === id);
  const chaos = m.chaosMoment;

  const podium = h(
    "div.podium",
    null,
    podiumOrder.map((p) => {
      const rank = rankOf(p.id);
      const delay = 0.5 + (rank === 1 ? 0.5 : rank === 2 ? 0.15 : 0);
      return h(
        "div.step",
        { style: { "--c": colorOf(p.id), animationDelay: `${delay}s` } },
        h("div.corewrap", null, rank === 1 ? crown() : null, coreCanvas(p.color, sizes[rank === 1 ? 0 : rank - 1] ?? rem(4), { ultReady: rank === 1 })),
        h("div.who", null, p.name),
        h("div.block", { style: { height: `${heights[rank - 1] ?? rem(5)}px`, animationDelay: `${delay}s` } }, h("div.rank", null, String(rank)), h("div.pt", null, `${p.points} pts`)),
      );
    }),
  );

  const cols: { t: string; v: (id: number) => number; f?: (n: number) => string }[] = [
    { t: "Points", v: (id) => players.find((p) => p.id === id)?.points ?? 0 },
    { t: "Kills", v: (id) => statsFor(id)?.kills ?? 0 },
    { t: "Damage", v: (id) => statsFor(id)?.damage ?? 0 },
    { t: "Accuracy", v: (id) => { const s = statsFor(id); return s && s.shots ? Math.round((s.hits / s.shots) * 100) : 0; }, f: (n) => `${n}%` },
    { t: "Powers", v: (id) => statsFor(id)?.powersUsed ?? 0 },
    { t: "Combos", v: (id) => statsFor(id)?.combos ?? 0 },
    { t: "Wins", v: (id) => statsFor(id)?.roundWins ?? 0 },
  ];
  const best = cols.map((c) => Math.max(...players.map((p) => c.v(p.id))));
  const table = h(
    "table.stats",
    null,
    h("tr", null, h("th", null, "Pilot"), cols.map((c) => h("th", null, c.t))),
    players.map((p, i) =>
      h(
        `tr${i === 0 ? ".first" : ""}`,
        { style: { "--c": colorOf(p.id) } },
        h("td.n", { style: { color: colorOf(p.id) } }, h("div.in", null, coreCanvas(p.color, rem(1.5)), p.name, p.bot ? h("span.tag.bot", null, "BOT") : null)),
        cols.map((c, ci) => {
          const v = c.v(p.id);
          return h(`td${v > 0 && v === best[ci] ? ".best" : ""}`, null, c.f ? c.f(v) : String(v));
        }),
      ),
    ),
  );

  const screen = h(
    "div.screen.matchend",
    { style: { "--c": winCol } },
    h("div.winner-flood"),
    h("div.win-kicker", null, "MATCH COMPLETE"),
    h("h2.phase-title.win-title", null, `${session.playerName(m.winnerId).toUpperCase()} WINS`),
    h(
      "div.end-grid",
      null,
      podium,
      h(
        "div.end-right",
        null,
        table,
        chaos
          ? h("div.chaos", null, h("span.flame", null, "🔥"), h("div", null, h("div.lbl", null, "MOST CHAOTIC MOMENT"), h("div.txt", null, h("b", { style: { color: colorOf(chaos.playerId) } }, session.playerName(chaos.playerId)), ` dealt ${chaos.damage} damage in 3 seconds (round ${chaos.round})`)))
          : null,
      ),
      h("div.end-actions", null, h("button.btn.primary", { onclick: () => session.rematch(), "data-nav": "1" }, "Rematch"), h("button.btn", { onclick: () => session.leave(), "data-nav": "1" }, "Main menu")),
    ),
  );
  queueMicrotask(() => {
    audio.sfx("combo", 0, 0, { positional: false, pitch: 0.75 });
    confetti(winCol, root);
  });
  // Rematch/Main menu land focus on the primary button, not the winner's stats.
  return { el: screen };
}

/** The Tab scoreboard: points, kills, per-round placements and alive/ghost status. Refreshed while held. */
export function scoreboard(): { el: HTMLElement; refresh: () => void } {
  const body = h("tbody");
  const title = h("h2");
  const el = h("div.scoreboard.panel", null, title, h("table.sb-table", null, body));
  const refresh = () => {
    const players = [...(session.room?.players ?? [])].sort((a, b) => b.points - a.points);
    const rounds = history.rounds;
    const view = session.view;
    title.replaceChildren(`ROUND ${session.round}`, h("span", null, `FIRST TO ${POINTS.toWin} POINTS`));
    const head = h("tr", null, h("th"), h("th", null, "Pilot"), h("th", null, "Finishes"), h("th", null, "Kills"), h("th", null, "Damage"), h("th", null, "Points"), h("th", null, "Status"));
    const trs = players.map((p, i) => {
      const alive = view?.latest?.ents.get(p.id);
      const isAlive = alive ? ((alive[7] ?? 0) & 1) === 1 : false;
      const places = history.places(p.id);
      return h(
        `tr${p.id === session.myId ? ".me" : ""}${isAlive ? "" : ".dead"}`,
        { style: { color: colorOf(p.id) } },
        h("td", null, String(i + 1)),
        h("td.nm", null, h("div.in", null, coreCanvas(p.color, rem(1.7)), h("span", null, p.name), p.bot ? h("span.tag.bot", null, "BOT") : null)),
        h("td", null, rounds.length ? places.map((pl) => h(`span.pl${pl && pl <= 3 ? `.p${pl}` : ""}${pl ? "" : ".none"}`, null, pl ? String(pl) : "-")) : h("span", { style: { color: "var(--dim)" } }, "-")),
        h("td", null, String(history.kills(p.id))),
        h("td", null, String(history.damage(p.id))),
        h("td.pts", { style: { color: "#fff" } }, String(p.points)),
        h("td", null, h(`span.${isAlive ? "alive" : "ghost"}`, null, isAlive ? "ALIVE" : "GHOST")),
      );
    });
    body.replaceChildren(head, ...trs);
  };
  refresh();
  return { el, refresh };
}
