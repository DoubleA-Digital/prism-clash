// Rivers: the outline of the union of water rects (so banks, shallows and foam only follow
// the real shoreline, never the seams between stacked rects), and the live layer drawn on
// top of the pre-rendered water: ripples flowing downstream, twinkling glints and lapping
// foam along the banks. Bridges are left clean.

import { WORLD_ART, type MapDef, type Rect } from "@prism/shared";
import { hash, intersects, type Bounds } from "./rand";

/** A shoreline segment and the outward normal (pointing from water to land). */
export interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  nx: number;
  ny: number;
}

/** Subtracts intervals from [a, b]. */
function subtract(a: number, b: number, cuts: [number, number][]): [number, number][] {
  let parts: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [p0, p1] of parts) {
      if (c1 <= p0 || c0 >= p1) next.push([p0, p1]);
      else {
        if (c0 > p0) next.push([p0, c0]);
        if (c1 < p1) next.push([c1, p1]);
      }
    }
    parts = next;
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 1);
}

/** The exposed outline of a union of rects. */
export function shoreline(rects: readonly Rect[]): Edge[] {
  const out: Edge[] = [];
  for (const r of rects) {
    const others = rects.filter((o) => o !== r);
    const top = others.filter((o) => o.y0 < r.y0 && o.y1 >= r.y0).map((o): [number, number] => [o.x0, o.x1]);
    const bot = others.filter((o) => o.y1 > r.y1 && o.y0 <= r.y1).map((o): [number, number] => [o.x0, o.x1]);
    const left = others.filter((o) => o.x0 < r.x0 && o.x1 >= r.x0).map((o): [number, number] => [o.y0, o.y1]);
    const right = others.filter((o) => o.x1 > r.x1 && o.x0 <= r.x1).map((o): [number, number] => [o.y0, o.y1]);
    for (const [a, b] of subtract(r.x0, r.x1, top)) out.push({ x0: a, y0: r.y0, x1: b, y1: r.y0, nx: 0, ny: -1 });
    for (const [a, b] of subtract(r.x0, r.x1, bot)) out.push({ x0: a, y0: r.y1, x1: b, y1: r.y1, nx: 0, ny: 1 });
    for (const [a, b] of subtract(r.y0, r.y1, left)) out.push({ x0: r.x0, y0: a, x1: r.x0, y1: b, nx: -1, ny: 0 });
    for (const [a, b] of subtract(r.y0, r.y1, right)) out.push({ x0: r.x1, y0: a, x1: r.x1, y1: b, nx: 1, ny: 0 });
  }
  return out;
}

/** Shoreline with the stretches under bridges removed (foam stops at the bridge). */
export function foamEdges(map: MapDef): Edge[] {
  const out: Edge[] = [];
  for (const e of shoreline(map.water)) {
    if (e.nx !== 0) {
      const cuts = map.bridges.filter((b) => b.x0 <= e.x0 && b.x1 >= e.x0).map((b): [number, number] => [b.y0, b.y1]);
      for (const [a, b] of subtract(e.y0, e.y1, cuts)) out.push({ ...e, y0: a, y1: b });
    } else out.push(e);
  }
  return out;
}

const inBridgeRow = (map: MapDef, y: number, x0: number, x1: number) => map.bridges.some((b) => y > b.y0 - 6 && y < b.y1 + 6 && b.x1 > x0 && b.x0 < x1);

/** The animated water layer for rivers in view (camera transform applied). */
export function drawWaterLive(ctx: CanvasRenderingContext2D, map: MapDef, foam: readonly Edge[], time: number, view: Bounds) {
  const visible = map.water.filter((w) => intersects(w, view, 40));
  if (!visible.length) return;
  const cfg = WORLD_ART.water;
  const sp = cfg.rippleSpacing;
  const travel = time * cfg.flowSpeed;
  const shift = Math.floor(travel / sp);
  const off = travel - shift * sp;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const w of visible) {
    const y0 = Math.max(w.y0, view.y0 - sp);
    const y1 = Math.min(w.y1, view.y1 + sp);
    const k0 = Math.floor((y0 - off) / sp);
    const k1 = Math.ceil((y1 - off) / sp);
    ctx.lineWidth = 2.2;
    for (let k = k0; k <= k1; k++) {
      const y = k * sp + off;
      if (y < w.y0 + 6 || y > w.y1 - 6 || inBridgeRow(map, y, w.x0, w.x1)) continue;
      const key = k - shift;
      const a = 0.09 + 0.07 * Math.sin(time * 1.3 + key);
      ctx.strokeStyle = `rgba(120,215,255,${a})`;
      ctx.beginPath();
      // Dashes along the row: positions fixed to the moving water parcel.
      for (let x = w.x0 + 10 + hash(key, 3) * 60; x < w.x1 - 30; x += 70 + hash(key, x | 0) * 70) {
        const len = 24 + hash(x | 0, key) * 46;
        const end = Math.min(w.x1 - 12, x + len);
        const bow = 3 + hash(key, x | 0, 7) * 4;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo((x + end) / 2, y + bow, end, y);
      }
      ctx.stroke();
    }
    // Glints that twinkle and drift with the flow.
    for (let k = k0; k <= k1; k++) {
      const key = k - shift;
      const gx = w.x0 + 20 + hash(key, 11) * (w.x1 - w.x0 - 40);
      const gy = k * sp + off + sp * 0.5;
      if (gy < w.y0 || gy > w.y1 || inBridgeRow(map, gy, w.x0, w.x1)) continue;
      const tw = Math.max(0, Math.sin(time * 3 + key * 1.7));
      if (tw < 0.4) continue;
      ctx.fillStyle = `rgba(200,245,255,${0.35 * tw})`;
      ctx.fillRect(gx - 4, gy - 0.8, 8, 1.6);
      ctx.fillRect(gx - 0.8, gy - 2.5, 1.6, 5);
    }
  }
  // Lapping foam along the banks.
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(170,235,255,${0.2 + 0.06 * Math.sin(time * 2)})`;
  ctx.beginPath();
  for (const e of foam) {
    if (!intersects({ x0: Math.min(e.x0, e.x1), y0: Math.min(e.y0, e.y1), x1: Math.max(e.x0, e.x1), y1: Math.max(e.y0, e.y1) }, view, 20)) continue;
    const lap = 3 + Math.sin(time * 1.8 + (e.x0 + e.y0) * 0.01) * 2;
    ctx.moveTo(e.x0 - e.nx * lap, e.y0 - e.ny * lap);
    ctx.lineTo(e.x1 - e.nx * lap, e.y1 - e.ny * lap);
  }
  ctx.stroke();
  ctx.setLineDash([10, 18]);
  ctx.lineDashOffset = -time * 14;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(150,225,255,0.12)";
  ctx.beginPath();
  for (const e of foam) {
    if (!intersects({ x0: Math.min(e.x0, e.x1), y0: Math.min(e.y0, e.y1), x1: Math.max(e.x0, e.x1), y1: Math.max(e.y0, e.y1) }, view, 20)) continue;
    ctx.moveTo(e.x0 - e.nx * 14, e.y0 - e.ny * 14);
    ctx.lineTo(e.x1 - e.nx * 14, e.y1 - e.ny * 14);
  }
  ctx.stroke();
  ctx.restore();
}
