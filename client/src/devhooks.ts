// Dev/test hooks: lets the e2e scripts set the network simulator and read netcode stats.
// Only installed in development builds and when the URL has ?test=1.

import { session } from "./net/session";

declare global {
  interface Window {
    __prism?: {
      setSim(latencyMs: number, jitterMs: number, loss: number): void;
      recent(): unknown[];
      stats(): { rtt: number; corrections: number; correctionsPerMin: number; maxCorrection: number; phase: string; alive: boolean; snaps: number; downKBs: number; upKBs: number };
    };
  }
}

export function installDevHooks() {
  if (!import.meta.env.DEV && !new URLSearchParams(location.search).has("test")) return;
  window.__prism = {
    setSim(latencyMs, jitterMs, loss) {
      session.conn.sim = { latencyMs, jitterMs, loss };
    },
    recent() {
      return session.view?.debug.recent ?? [];
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
