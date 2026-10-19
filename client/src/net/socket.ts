// The WebSocket connection, with a built-in network simulator (F2 panel) that adds
// latency, jitter and packet loss to both directions so bad connections can be tested
// on one machine. "Loss" drops whole hot messages (inputs/snapshots); TCP would otherwise
// retransmit them, so this models a worse-than-real connection.

import { C2S, decode, encode, S2C, type ClientMsg, type ServerMsg } from "@prism/shared";

export interface NetSim {
  latencyMs: number;
  jitterMs: number;
  loss: number;
}

export interface NetStats {
  bytesIn: number;
  bytesOut: number;
  snapshots: number;
  /** Rolling per-second rates, updated once a second. */
  inPerSec: number;
  outPerSec: number;
  snapsPerSec: number;
  dropped: number;
}

type Listener = (msg: ServerMsg) => void;

export class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private openListeners = new Set<() => void>();
  private closeListeners = new Set<(reason: string) => void>();
  sim: NetSim = { latencyMs: 0, jitterMs: 0, loss: 0 };
  stats: NetStats = { bytesIn: 0, bytesOut: 0, snapshots: 0, inPerSec: 0, outPerSec: 0, snapsPerSec: 0, dropped: 0 };
  private window = { in: 0, out: 0, snaps: 0, at: performance.now() };
  /** Keeps delayed messages in order per direction (a later message can't overtake). */
  private lastDeliverIn = 0;
  private lastDeliverOut = 0;
  open = false;

  connect(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this.open = true;
      this.openListeners.forEach((f) => f());
    };
    this.ws.onclose = (e) => {
      this.open = false;
      this.closeListeners.forEach((f) => f(e.reason || "Connection closed"));
    };
    this.ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const bytes = new Uint8Array(e.data);
      this.stats.bytesIn += bytes.length;
      this.window.in += bytes.length;
      let msg: ServerMsg;
      try {
        msg = decode<ServerMsg>(bytes);
      } catch {
        return;
      }
      if (msg.type === S2C.snapshot) {
        this.stats.snapshots++;
        this.window.snaps++;
      }
      const hot = msg.type === S2C.snapshot;
      this.deliver(() => this.listeners.forEach((f) => f(msg)), hot, "in");
    };
  }

  close() {
    this.ws?.close();
  }

  send(msg: ClientMsg) {
    const hot = msg.type === C2S.input;
    this.deliver(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const data = encode(msg);
      this.stats.bytesOut += data.length;
      this.window.out += data.length;
      this.ws.send(data);
    }, hot, "out");
  }

  private deliver(fn: () => void, hot: boolean, dir: "in" | "out") {
    const s = this.sim;
    if (s.latencyMs <= 0 && s.jitterMs <= 0 && s.loss <= 0) {
      fn();
      return;
    }
    if (hot && s.loss > 0 && Math.random() < s.loss) {
      this.stats.dropped++;
      return;
    }
    // Half the simulated round trip each way.
    const delay = s.latencyMs / 2 + (Math.random() * 2 - 1) * (s.jitterMs / 2);
    const now = performance.now();
    const last = dir === "in" ? this.lastDeliverIn : this.lastDeliverOut;
    const at = Math.max(now + Math.max(0, delay), last);
    if (dir === "in") this.lastDeliverIn = at;
    else this.lastDeliverOut = at;
    setTimeout(fn, at - now);
  }

  /** Call once per frame; rolls the per-second counters. */
  tickStats() {
    const now = performance.now();
    if (now - this.window.at >= 1000) {
      const k = 1000 / (now - this.window.at);
      this.stats.inPerSec = this.window.in * k;
      this.stats.outPerSec = this.window.out * k;
      this.stats.snapsPerSec = this.window.snaps * k;
      this.window = { in: 0, out: 0, snaps: 0, at: now };
    }
  }

  on(f: Listener) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  onOpen(f: () => void) {
    this.openListeners.add(f);
  }
  onClose(f: (reason: string) => void) {
    this.closeListeners.add(f);
  }
}

export function serverUrl(): string {
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override) return override;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
