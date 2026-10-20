// Static ground cache: the map is cut into square chunks that are painted once (lazily, the
// nearest first, a frame budget at a time) into offscreen canvases at about screen
// resolution, and kept in an LRU. Until a chunk is ready its area shows a low-res whole-map
// texture, so nothing ever pops in as a hole. Destructibles and animated bits are drawn
// live on top, so chunks never need repainting.

import { WORLD_ART, type MapDef } from "@prism/shared";
import { paintGround, type GroundData } from "./ground";
import { canvas, type Bounds } from "./rand";

interface Chunk {
  c: HTMLCanvasElement;
  res: number;
  used: number;
}

/** Overlap painted around each chunk so neighbours meet without hairline seams. */
const PAD = 3;

export class GroundChunks {
  private chunks = new Map<number, Chunk>();
  private fallback: HTMLCanvasElement;
  private res = 0;
  private frame = 0;
  private readonly n: number;
  private readonly size = WORLD_ART.chunkSize;
  /** Chunks painted so far (for perf stats). */
  built = 0;

  constructor(private map: MapDef, private data: GroundData) {
    this.n = Math.ceil((map.half * 2) / this.size);
    const fr = WORLD_ART.fallbackRes;
    const span = map.half * 2;
    const [c, g] = canvas(span * fr, span * fr);
    g.scale(fr, fr);
    g.translate(map.half, map.half);
    paintGround(g, map, data, { x0: -map.half, y0: -map.half, x1: map.half, y1: map.half }, false);
    this.fallback = c;
  }

  private paint(i: number, j: number, res: number): HTMLCanvasElement {
    const x0 = -this.map.half + i * this.size;
    const y0 = -this.map.half + j * this.size;
    const span = this.size + PAD * 2;
    const [c, g] = canvas(span * res, span * res);
    g.scale(res, res);
    g.translate(-x0 + PAD, -y0 + PAD);
    g.beginPath();
    g.rect(x0 - PAD, y0 - PAD, span, span);
    g.clip();
    paintGround(g, this.map, this.data, { x0: x0 - PAD, y0: y0 - PAD, x1: x0 + this.size + PAD, y1: y0 + this.size + PAD }, true);
    this.built++;
    return c;
  }

  /** Draws the ground in view (camera transform applied). `pxPerUnit` = device px per world unit. */
  draw(ctx: CanvasRenderingContext2D, view: Bounds, pxPerUnit: number) {
    this.frame++;
    const want = Math.ceil(Math.max(WORLD_ART.chunkResMin, Math.min(WORLD_ART.chunkResMax, pxPerUnit)) * 4) / 4;
    if (!this.res || want > this.res * 1.15 || want < this.res * 0.6) this.res = want;
    const h = this.map.half;
    const s = this.size;
    const i0 = Math.max(0, Math.floor((view.x0 + h) / s));
    const i1 = Math.min(this.n - 1, Math.floor((view.x1 + h) / s));
    const j0 = Math.max(0, Math.floor((view.y0 + h) / s));
    const j1 = Math.min(this.n - 1, Math.floor((view.y1 + h) / s));
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const todo: { k: number; i: number; j: number; d: number }[] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.n + i;
        const ch = this.chunks.get(k);
        if (!ch || ch.res !== this.res) todo.push({ k, i, j, d: Math.hypot(-h + (i + 0.5) * s - cx, -h + (j + 0.5) * s - cy) });
      }
    }
    if (todo.length) {
      todo.sort((a, b) => a.d - b.d);
      const missing = todo.filter((t) => !this.chunks.has(t.k)).length;
      const budget = missing > 2 ? WORLD_ART.chunksPerFrameBurst : WORLD_ART.chunksPerFrame;
      for (const t of todo.slice(0, budget)) this.chunks.set(t.k, { c: this.paint(t.i, t.j, this.res), res: this.res, used: this.frame });
    }
    ctx.imageSmoothingEnabled = true;
    const fr = WORLD_ART.fallbackRes;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -h + i * s;
        const y = -h + j * s;
        const ch = this.chunks.get(j * this.n + i);
        if (ch) {
          ch.used = this.frame;
          ctx.drawImage(ch.c, x - PAD, y - PAD, s + PAD * 2, s + PAD * 2);
        } else {
          const w = Math.min(s, h - x);
          const hh = Math.min(s, h - y);
          ctx.drawImage(this.fallback, (x + h) * fr, (y + h) * fr, w * fr, hh * fr, x, y, w, hh);
        }
      }
    }
    if (this.chunks.size > WORLD_ART.maxChunks) {
      const old = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [k] of old.slice(0, this.chunks.size - WORLD_ART.maxChunks)) this.chunks.delete(k);
    }
  }
}
