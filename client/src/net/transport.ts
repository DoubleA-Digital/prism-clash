// Byte transports under the Connection: a WebSocket to the game server, or a Web Worker that
// runs the whole server locally (Practice vs Bots, see practice.worker.ts). Both carry the
// same msgpack frames, so everything above this layer can't tell them apart.

export interface TransportHandlers {
  open(): void;
  message(bytes: Uint8Array): void;
  /** `opened`: whether the transport ever opened (false means it couldn't connect at all). */
  close(reason: string, opened: boolean): void;
}

export interface Transport {
  readonly kind: "ws" | "worker";
  readonly open: boolean;
  start(h: TransportHandlers): void;
  send(bytes: Uint8Array): void;
  close(): void;
}

/** The parts of a browser WebSocket the transport uses (so tests can pass a fake). */
export interface WebSocketLike {
  binaryType: BinaryType;
  readonly readyState: number;
  onopen: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

const WS_OPEN = 1;

export class WsTransport implements Transport {
  readonly kind = "ws";
  private ws: WebSocketLike | null = null;
  private opened = false;
  private closed = false;

  constructor(readonly url: string, private make: (url: string) => WebSocketLike = (u) => new WebSocket(u)) {}

  get open() {
    return !!this.ws && this.ws.readyState === WS_OPEN && !this.closed;
  }

  start(h: TransportHandlers) {
    let ws: WebSocketLike;
    try {
      ws = this.make(this.url);
    } catch {
      // A malformed URL throws synchronously: report it like any failed connection.
      this.closed = true;
      setTimeout(() => h.close("Could not connect", false), 0);
      return;
    }
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      this.opened = true;
      h.open();
    };
    ws.onclose = (e) => {
      if (this.closed) return;
      this.closed = true;
      h.close(e.reason || "Connection closed", this.opened);
    };
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) h.message(new Uint8Array(e.data));
    };
  }

  send(bytes: Uint8Array) {
    if (this.open) this.ws?.send(bytes);
  }

  close() {
    this.ws?.close();
  }
}

/** Main thread ↔ practice worker messages: binary frames travel as transferred ArrayBuffers. */
export type WorkerControl = { t: "close"; reason: string } | { t: "error"; message: string };
export type WorkerWire = ArrayBuffer | WorkerControl;

/** The parts of a Worker the transport uses (so tests can pass a fake). */
export interface WorkerLike {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}

/** Copies a (possibly shared, pooled) view into its own buffer so it can be transferred. */
export function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

export class WorkerTransport implements Transport {
  readonly kind = "worker";
  private worker: WorkerLike | null = null;
  private handlers: TransportHandlers | null = null;
  private live = false;

  constructor(private make: () => WorkerLike) {}

  get open() {
    return this.live;
  }

  start(h: TransportHandlers) {
    this.handlers = h;
    let w: WorkerLike;
    try {
      w = this.make();
    } catch (e) {
      setTimeout(() => h.close(`Practice could not start: ${(e as Error).message}`, false), 0);
      return;
    }
    this.worker = w;
    w.onmessage = (e: MessageEvent<WorkerWire>) => {
      const d = e.data;
      if (d instanceof ArrayBuffer) {
        if (this.live) h.message(new Uint8Array(d));
        return;
      }
      if (d.t === "error") console.error(`practice worker: ${d.message}`);
      else this.finish(d.reason);
    };
    w.onerror = (e) => {
      console.error(`practice worker crashed: ${e.message}`);
      this.finish("Practice stopped unexpectedly");
    };
    this.live = true;
    // Like a socket, "open" arrives asynchronously; posts made before the worker loads are queued.
    setTimeout(() => {
      if (this.live) h.open();
    }, 0);
  }

  send(bytes: Uint8Array) {
    if (!this.live || !this.worker) return;
    const buf = ownBuffer(bytes);
    this.worker.postMessage(buf, [buf]);
  }

  close() {
    this.finish("Practice ended");
  }

  private finish(reason: string) {
    if (!this.live) return;
    this.live = false;
    this.worker?.terminate();
    this.worker = null;
    this.handlers?.close(reason, true);
  }
}
