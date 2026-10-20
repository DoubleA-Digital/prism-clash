// Deterministic cosmetic randomness for terrain art: a position hash (same answer on every
// rebuild of a chunk or sprite) and a tiny seeded generator. Never used for gameplay.

/** Hash of up to three numbers to [0, 1). */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 16), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Small seeded generator (mulberry32) for scattering details. */
export class Prng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x2545f491;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(arr: readonly T[], fallback: T): T {
    return arr[Math.floor(this.next() * arr.length)] ?? fallback;
  }
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const intersects = (a: Bounds, b: Bounds, pad = 0) => a.x1 + pad > b.x0 && a.x0 - pad < b.x1 && a.y1 + pad > b.y0 && a.y0 - pad < b.y1;

/** A blank canvas of at least 1x1 pixels and its 2D context. */
export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D is not available");
  return [c, g];
}
