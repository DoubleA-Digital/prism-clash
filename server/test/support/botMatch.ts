// Runs a full headless battle royale with bots only (no network) and measures how much time
// the bot brains and the world step take per tick.
import { performance } from "node:perf_hooks";
import { allPowers, allUlts, draftOffer, MATCH, Rng, ultOffer, World, type Difficulty, type InputFrame, type MapId } from "@prism/shared";
import { createBrain, prepareBots, type BotBrain } from "../../src/bots/brain";

export interface BotMatchResult {
  w: World;
  ticks: number;
  seconds: number;
  winner: number;
  maxTravel: number;
  /** Mean / p99 / max milliseconds per tick spent in all bot brains together. */
  botMs: { mean: number; p99: number; max: number };
  /** Mean milliseconds per tick for the world step (for comparison). */
  stepMs: number;
  /** One-off nav grid build for the map (done during the countdown in a real room). */
  navBuildMs: number;
  kills: number;
  shots: number;
  looted: number;
}

/**
 * Plays a full match. `draft`: loadouts come from the bots' own picks out of real offers (one
 * power, ultimate at zero charge), like a room's pre-match; otherwise every bot gets two
 * fixed powers and a part-charged ultimate (more chaos per minute).
 */
export function playBotMatch(seed: number, map: MapId, opts: { difficulty?: Difficulty; draft?: boolean } = {}): BotMatchResult {
  const w = new World(map, seed);
  const powers = allPowers();
  const ults = allUlts();
  const brains = new Map<number, BotBrain>();
  const rng = new Rng(seed ^ 0x5eed);
  for (let i = 1; i <= MATCH.fighters; i++) {
    const p = w.addPlayer(i, `BOT${i}`, i - 1, true);
    const brain = createBrain(opts.difficulty ?? (i % 3 === 0 ? "hard" : i % 2 ? "normal" : "easy"), seed * 31 + i);
    brains.set(i, brain);
    if (opts.draft) {
      const uo = ultOffer(rng);
      const po = draftOffer(rng, []);
      const ult = uo[brain.pickUlt(uo)] ?? null;
      const pow = po[brain.pickPower(po, [null, null])] ?? null;
      p.slots = [pow ? { id: pow, cd: 0, recast: 0 } : null, null];
      p.ult = ult ? { id: ult, charge: 0 } : null;
      continue;
    }
    const a = powers[(seed + i) % Math.max(1, powers.length)];
    const b = powers[(seed + i * 7 + 3) % Math.max(1, powers.length)];
    p.slots = [a ? { id: a.id, cd: 0, recast: 0 } : null, b ? { id: b.id, cd: 0, recast: 0 } : null];
    const u = ults[(seed + i) % Math.max(1, ults.length)];
    p.ult = u ? { id: u.id, charge: 40 } : null;
  }
  w.placeSpawns();
  const n0 = performance.now();
  prepareBots(w);
  const navBuildMs = performance.now() - n0;
  const start = new Map([...w.players.values()].map((p) => [p.id, { x: p.x, y: p.y }] as const));
  let ticks = 0;
  let maxTravel = 0;
  const limit = 30 * MATCH.maxSeconds;
  const botTimes: number[] = [];
  let stepTotal = 0;
  while (w.alivePlayers().length > 1 && ticks < limit) {
    const inputs = new Map<number, InputFrame[]>();
    const t0 = performance.now();
    for (const p of w.alivePlayers()) inputs.set(p.id, [brains.get(p.id)!.think(w, p)]);
    const t1 = performance.now();
    w.step(inputs);
    stepTotal += performance.now() - t1;
    botTimes.push(t1 - t0);
    ticks++;
    if (ticks % 300 === 0) {
      for (const p of w.alivePlayers()) {
        const s = start.get(p.id)!;
        maxTravel = Math.max(maxTravel, Math.hypot(p.x - s.x, p.y - s.y));
      }
    }
  }
  const sorted = [...botTimes].sort((a, b) => a - b);
  const sum = botTimes.reduce((a, b) => a + b, 0);
  const stats = [...w.stats.values()];
  return {
    w, ticks, seconds: ticks / 30, winner: w.alivePlayers()[0]?.id ?? 0, maxTravel,
    botMs: { mean: sum / Math.max(1, ticks), p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0, max: sorted[sorted.length - 1] ?? 0 },
    stepMs: stepTotal / Math.max(1, ticks),
    navBuildMs,
    kills: stats.reduce((a, s) => a + s.kills, 0),
    shots: stats.reduce((a, s) => a + s.shots, 0),
    looted: stats.reduce((a, s) => a + s.looted, 0),
  };
}

export function describeMatch(map: MapId, r: BotMatchResult): string {
  const killers = [...r.w.stats.entries()].filter(([, s]) => s.kills > 0).map(([id, s]) => `${id}:${s.kills}`).join(" ");
  const zoneDeaths = r.w.deaths.filter((d) => d.killer === 0).length;
  return `${map}: winner BOT${r.winner} after ${r.seconds.toFixed(0)}s (${r.ticks} ticks), kills ${r.kills} [${killers}], zone/self deaths ${zoneDeaths}, shots ${r.shots}, looted ${r.looted}, ` +
    `bot ms/tick mean ${r.botMs.mean.toFixed(3)} p99 ${r.botMs.p99.toFixed(3)} max ${r.botMs.max.toFixed(2)}, world step ms/tick ${r.stepMs.toFixed(3)}, nav build ${r.navBuildMs.toFixed(1)} ms`;
}
