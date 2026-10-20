// What the room/match logic needs from its host, as small interfaces. The Node server
// (main.ts) and the in-browser practice worker (client/src/net/practice.worker.ts) each
// provide their own, so everything under rooms/, bots/ and hub.ts runs on either.

/** A connected client as the room sees it: a ws WebSocket on Node, a postMessage port in the worker. */
export interface PeerSocket {
  /** 1 while open (the WebSocket OPEN value); anything else means closed. */
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Unpredictable numbers for room codes, seeds and session tokens (not gameplay: that's the seeded Rng). */
export interface RandomSource {
  /** An integer in [0, max). */
  int(max: number): number;
  /** A 32-character hex session token. */
  token(): string;
}

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A RandomSource over a fill-bytes function (crypto.getRandomValues in browsers, randomFillSync on Node). */
export function randomFromBytes(fill: (bytes: Uint8Array) => void): RandomSource {
  const buf = new Uint8Array(16);
  const u32 = new Uint32Array(1);
  return {
    int(max) {
      if (max <= 1) return 0;
      // Rejection sampling, so every value is equally likely.
      const limit = Math.floor(0x1_0000_0000 / max) * max;
      for (;;) {
        fill(new Uint8Array(u32.buffer));
        const v = u32[0] ?? 0;
        if (v < limit) return v % max;
      }
    },
    token() {
      fill(buf);
      let s = "";
      for (const b of buf) s += b.toString(16).padStart(2, "0");
      return s;
    },
  };
}
