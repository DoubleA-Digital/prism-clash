// Dev/test hooks: lets the e2e scripts set the network simulator and read netcode stats.
// Only installed in development builds and when the URL has ?test=1.

import { decodePlayer, EK, PFLAG, type DebugGrant } from "@prism/shared";
import { session } from "./net/session";

declare global {
  interface Window {
    __prism?: {
      setSim(latencyMs: number, jitterMs: number, loss: number): void;
      recent(): unknown[];
      /** Test rooms: grant yourself a power, ultimate or helper (see DebugGrant). */
      grant(power: DebugGrant): void;
      /** Screen position (CSS px) and distance of the nearest visible living enemy. */
      foe(): { x: number; y: number; dist: number } | null;
      /** Loot piles the client currently knows about (what the server sent within loot range). */
      lootCount(): number;
      stats(): { rtt: number; corrections: number; correctionsPerMin: number; maxCorrection: number; phase: string; alive: boolean; snaps: number; downKBs: number; upKBs: number };
    };
  }
}

export function installDevHooks(toScreen: (x: number, y: number) => { x: number; y: number }) {
  if (!import.meta.env.DEV && !new URLSearchParams(location.search).has("test")) return;
  window.__prism = {
    setSim(latencyMs, jitterMs, loss) {
      session.conn.sim = { latencyMs, jitterMs, loss };
    },
    recent() {
      return session.view?.debug.recent ?? [];
    },
    grant(power) {
      session.debugGrant(session.myId, power);
    },
    foe() {
      const v = session.view;
      const me = v?.me;
      if (!v?.latest || !me) return null;
      let best: { x: number; y: number; dist: number } | null = null;
      for (const [id, a] of v.latest.ents) {
        if (a[0] !== EK.player || id === session.myId) continue;
        const p = decodePlayer(id, a);
        if (!(p.flags & PFLAG.alive)) continue;
        const dist = Math.hypot(p.x - me.x, p.y - me.y);
        if (!best || dist < best.dist) best = { ...toScreen(p.x, p.y), dist };
      }
      return best;
    },
    lootCount() {
      let n = 0;
      for (const a of session.view?.latest?.ents.values() ?? []) if (a[0] === EK.loot) n++;
      return n;
    },
    stats() {
      const d = session.view?.debug;
      const s = session.conn.stats;
      return {
        rtt: session.rtt, corrections: d?.corrections ?? 0, correctionsPerMin: d?.correctionsPerMin ?? 0, maxCorrection: d?.maxCorrection ?? 0,
        phase: session.phase, alive: !!session.view?.me, snaps: s.snapsPerSec, downKBs: s.inPerSec / 1024, upKBs: s.outPerSec / 1024,
      };
    },
  };
}
