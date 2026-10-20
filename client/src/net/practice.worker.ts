// Practice vs Bots, fully offline: the authoritative game server (GameHub: rooms, the match
// flow, the 30 Hz world step, bots and snapshots) running in a Web Worker. The page talks to
// it over WorkerTransport with the same msgpack frames a WebSocket would carry.

import { GameHub, randomFromBytes, type Logger, type PeerSocket } from "@prism/server/core";
import type { WorkerControl, WorkerWire } from "./transport";

const post = (msg: WorkerWire, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

// info/debug stay quiet (they'd only clutter the page console); problems surface.
const log: Logger = {
  debug: () => {},
  info: () => {},
  warn: (m) => console.warn(`[practice] ${m}`),
  // The page logs these (WorkerTransport), so they show up next to everything else.
  error: (m) => post({ t: "error", message: m } satisfies WorkerControl),
};

const hub = new GameHub({
  log,
  random: randomFromBytes((b) => crypto.getRandomValues(b)),
  maxRooms: 2,
  limitRoomCreation: false,
});

let open = true;
const socket: PeerSocket = {
  get readyState() {
    return open ? 1 : 3;
  },
  send(data) {
    // msgpackr hands out views into a pooled buffer: copy, then transfer the copy.
    const copy = new Uint8Array(data.length);
    copy.set(data);
    post(copy.buffer, [copy.buffer]);
  },
  close(_code, reason) {
    if (!open) return;
    open = false;
    conn.close();
    post({ t: "close", reason: reason ?? "Practice ended" } satisfies WorkerControl);
  },
};
const conn = hub.connect(socket, "local");

self.onmessage = (e: MessageEvent<unknown>) => {
  if (open && e.data instanceof ArrayBuffer) conn.receive(new Uint8Array(e.data));
};
