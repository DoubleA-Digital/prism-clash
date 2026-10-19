// MapBuilder collects terrain while a map generator runs, and offers the reusable prefabs
// both maps are made of: buildings with rooms, doorways and windows, fences, cars, crate
// piles, rock clusters, bushes, crystal formations and ruins. Everything is integer and
// RNG-driven (no trig), so server and clients build bit-identical maps.

import { SOLIDS, TERRAIN } from "../../config";
import type { Rng } from "../../math/rng";
import { StaticGrid } from "./grid";
import { SOLID_ID_BASE, type Circle, type Decor, type DecorKind, type LootSpot, type LootTableId, type MapDef, type MapId, type Rect, type Roof, type Solid, type SolidKind } from "./types";

const T = TERRAIN.wallThickness;
const DOOR = 110;

export const overlaps = (a: Rect, b: Rect, pad = 0) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.y0 - pad < b.y1 && a.y1 + pad > b.y0;
const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0: Math.round(Math.min(x0, x1)), y0: Math.round(Math.min(y0, y1)), x1: Math.round(Math.max(x0, x1)), y1: Math.round(Math.max(y0, y1)) });

export class MapBuilder {
  solids: Solid[] = [];
  bushes: Circle[] = [];
  water: Rect[] = [];
  bridges: Rect[] = [];
  roofs: Roof[] = [];
  decor: Decor[] = [];
  lootSpots: LootSpot[] = [];
  /** Areas generators reserved (streets, river banks) that random props must avoid. */
  keepOut: Rect[] = [];

  constructor(readonly id: MapId, readonly name: string, readonly seed: number, readonly half: number, readonly rng: Rng) {
    // The map edge: four thick walls just outside the playable square.
    const h = half;
    const b = TERRAIN.border;
    this.solid("wall", -h - b, -h - b, h + b, -h);
    this.solid("wall", -h - b, h, h + b, h + b);
    this.solid("wall", -h - b, -h, -h, h);
    this.solid("wall", h, -h, h + b, h);
  }

  solid(kind: SolidKind, x0: number, y0: number, x1: number, y1: number): Solid | null {
    const r = rect(x0, y0, x1, y1);
    if (r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4) return null;
    const def = SOLIDS[kind];
    const idx = this.solids.length;
    const s: Solid = { ...r, id: SOLID_ID_BASE + idx, idx, kind, hp: def.hp, maxHp: def.hp, dead: false, vision: def.vision, tough: def.tough, variant: this.rng.next() };
    this.solids.push(s);
    return s;
  }

  deco(kind: DecorKind, x0: number, y0: number, x1: number, y1: number) {
    this.decor.push({ ...rect(x0, y0, x1, y1), kind });
  }

  bush(x: number, y: number, r: number) {
    this.bushes.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
  }

  loot(x: number, y: number, table: LootTableId) {
    this.lootSpots.push({ x: Math.round(x), y: Math.round(y), table });
  }

  /** True if a rect is clear of solids, water and reserved areas (with padding). */
  free(r: Rect, pad = 20): boolean {
    for (const s of this.solids) if (overlaps(r, s, pad)) return false;
    for (const w of this.water) if (overlaps(r, w, pad)) return false;
    for (const k of this.keepOut) if (overlaps(r, k, 0)) return false;
    const h = this.half - 40;
    return r.x0 > -h && r.y0 > -h && r.x1 < h && r.y1 < h;
  }

  /** Tries to place a w×h solid at random inside `area`. */
  scatter(kind: SolidKind, area: Rect, w: number, h: number, tries = 12, pad = 30): Solid | null {
    for (let i = 0; i < tries; i++) {
      const x = Math.round(this.rng.range(area.x0, area.x1 - w));
      const y = Math.round(this.rng.range(area.y0, area.y1 - h));
      const r = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (this.free(r, pad)) return this.solid(kind, r.x0, r.y0, r.x1, r.y1);
    }
    return null;
  }

  /** A horizontal (or vertical) wall run from a to b at c, with gaps (center, width) left open. */
  wallRun(kind: SolidKind, horizontal: boolean, a: number, b: number, c: number, gaps: [number, number][], thick: number = T) {
    const sorted = [...gaps].sort((g1, g2) => g1[0] - g2[0]);
    let start = a;
    const seg = (s: number, e: number, k: SolidKind) => {
      if (e - s < 6) return;
      if (horizontal) this.solid(k, s, c - thick / 2, e, c + thick / 2);
      else this.solid(k, c - thick / 2, s, c + thick / 2, e);
    };
    for (const [gc, gw] of sorted) {
      const g0 = Math.max(a, gc - gw / 2);
      const g1 = Math.min(b, gc + gw / 2);
      seg(start, g0, kind);
      start = g1;
    }
    seg(start, b, kind);
  }

  /** Gap positions along a wall [a, b]: `n` doors kept away from the corners. */
  private gapsOn(a: number, b: number, n: number, width: number): [number, number][] {
    const out: [number, number][] = [];
    const len = b - a;
    if (len < width + 120) return out;
    for (let i = 0; i < n; i++) {
      const lo = a + 60 + width / 2 + ((len - 120 - width) * i) / n;
      const hi = a + 60 + width / 2 + ((len - 120 - width) * (i + 1)) / n;
      out.push([Math.round(this.rng.range(lo, hi)), width]);
    }
    return out;
  }

  /**
   * A building: outer walls with doorways and glass windows, 1–3 interior rooms split by
   * walls with doorways, crates and loot inside, a roof that fades when you walk in.
   */
  building(x0: number, y0: number, x1: number, y1: number, opts: { doors?: number; windows?: boolean; crates?: number; loot?: number } = {}) {
    const r = rect(x0, y0, x1, y1);
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    this.deco("floor", r.x0, r.y0, r.x1, r.y1);
    // Doors: spread over the four sides, at least two so nobody is trapped.
    const sides = [0, 1, 2, 3];
    this.rng.shuffle(sides);
    const doorCount = Math.max(2, Math.min(4, opts.doors ?? 2 + this.rng.int(2)));
    const doorSides = new Set(sides.slice(0, doorCount));
    const windows = opts.windows ?? true;
    const side = (s: number) => {
      const horizontal = s === 0 || s === 2;
      const a = horizontal ? r.x0 : r.y0;
      const b = horizontal ? r.x1 : r.y1;
      const c = s === 0 ? r.y0 + T / 2 : s === 2 ? r.y1 - T / 2 : s === 3 ? r.x0 + T / 2 : r.x1 - T / 2;
      const doors = doorSides.has(s) ? this.gapsOn(a, b, 1, DOOR) : [];
      // A window (glass panel) on the side, away from the door and the corners.
      let wc = 0;
      if (windows && b - a > 420 && this.rng.next() < 0.7) {
        for (let k = 0; k < 6 && !wc; k++) {
          const c0 = Math.round(this.rng.range(a + 130, b - 130));
          if (!doors.some(([dc]) => Math.abs(dc - c0) < 160)) wc = c0;
        }
      }
      if (!wc) {
        this.wallRun("wall", horizontal, a, b, c, doors, T);
        return;
      }
      this.wallRun("wall", horizontal, a, b, c, [...doors, [wc, 120]], T);
      if (horizontal) this.solid("glass", wc - 60, c - 7, wc + 60, c + 7);
      else this.solid("glass", c - 7, wc - 60, c + 7, wc + 60);
    };
    sides.forEach(side);
    // Interior split: one wall across the longer side, with a doorway; sometimes a second.
    const rooms: Rect[] = [];
    if (Math.max(w, h) > 520) {
      const vertical = w >= h;
      const at = Math.round(vertical ? this.rng.range(r.x0 + w * 0.38, r.x0 + w * 0.62) : this.rng.range(r.y0 + h * 0.38, r.y0 + h * 0.62));
      const [a, b] = vertical ? [r.y0 + T, r.y1 - T] : [r.x0 + T, r.x1 - T];
      this.wallRun("wall", !vertical, a, b, at, this.gapsOn(a, b, 1, DOOR - 10), 18);
      if (vertical) rooms.push({ x0: r.x0 + T, y0: r.y0 + T, x1: at - 9, y1: r.y1 - T }, { x0: at + 9, y0: r.y0 + T, x1: r.x1 - T, y1: r.y1 - T });
      else rooms.push({ x0: r.x0 + T, y0: r.y0 + T, x1: r.x1 - T, y1: at - 9 }, { x0: r.x0 + T, y0: at + 9, x1: r.x1 - T, y1: r.y1 - T });
    } else rooms.push({ x0: r.x0 + T, y0: r.y0 + T, x1: r.x1 - T, y1: r.y1 - T });
    // Crates against walls, then loot on the floor.
    const crates = opts.crates ?? 1 + this.rng.int(2);
    for (let i = 0; i < crates; i++) {
      const room = rooms[this.rng.int(rooms.length)];
      if (room) this.scatter("crate", inset(room, 50), 54, 54, 10, 34);
    }
    const loot = opts.loot ?? 2 + this.rng.int(2);
    for (let i = 0; i < loot; i++) {
      const room = rooms[i % rooms.length];
      if (!room) continue;
      const spot = this.freePoint(inset(room, 50), 26);
      if (spot) this.loot(spot.x, spot.y, "building");
    }
    this.roofs.push({ ...r, id: this.roofs.length, variant: this.rng.next() });
  }

  /** A random point inside `area` at least `clear` away from any solid. */
  freePoint(area: Rect, clear: number, tries = 14): { x: number; y: number } | null {
    for (let i = 0; i < tries; i++) {
      const x = Math.round(this.rng.range(area.x0, area.x1));
      const y = Math.round(this.rng.range(area.y0, area.y1));
      if (this.free({ x0: x - clear, y0: y - clear, x1: x + clear, y1: y + clear }, 0)) return { x, y };
    }
    return null;
  }

  /** Fence line (low cover that only explosions break), with an opening or two. */
  fence(horizontal: boolean, a: number, b: number, c: number, gaps = 1) {
    this.wallRun("fence", horizontal, a, b, c, this.gapsOn(a, b, gaps, 130), 14);
  }

  /** A parked hover car: low cover, long side along the street. */
  car(cx: number, cy: number, horizontal: boolean): Solid | null {
    const [w, h] = horizontal ? [150, 72] : [72, 150];
    const r = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
    return this.free(r, 16) ? this.solid("car", r.x0, r.y0, r.x1, r.y1) : null;
  }

  /** A small pile: 2–4 crates and maybe a barrel. */
  cratePile(cx: number, cy: number) {
    const n = 2 + this.rng.int(3);
    for (let i = 0; i < n; i++) {
      const x = cx + this.rng.int(5) * 30 - 60;
      const y = cy + this.rng.int(5) * 30 - 60;
      const r = { x0: x, y0: y, x1: x + 54, y1: y + 54 };
      if (this.free(r, 8)) this.solid("crate", r.x0, r.y0, r.x1, r.y1);
    }
    if (this.rng.next() < 0.5) {
      const x = cx + 90;
      const y = cy - 20;
      if (this.free({ x0: x, y0: y, x1: x + 44, y1: y + 44 }, 10)) this.solid("barrel", x, y, x + 44, y + 44);
    }
  }

  /** A rock outcrop: two or three overlapping blocks (vision blocking). */
  rocks(cx: number, cy: number, size: number): boolean {
    const parts: Rect[] = [];
    const n = 2 + this.rng.int(2);
    for (let i = 0; i < n; i++) {
      const w = Math.round(size * this.rng.range(0.5, 1));
      const h = Math.round(size * this.rng.range(0.5, 1));
      const x = Math.round(cx + this.rng.range(-size * 0.45, size * 0.45) - w / 2);
      const y = Math.round(cy + this.rng.range(-size * 0.45, size * 0.45) - h / 2);
      parts.push({ x0: x, y0: y, x1: x + w, y1: y + h });
    }
    const bound = parts.reduce((a, p) => ({ x0: Math.min(a.x0, p.x0), y0: Math.min(a.y0, p.y0), x1: Math.max(a.x1, p.x1), y1: Math.max(a.y1, p.y1) }));
    if (!this.free(bound, 70)) return false;
    for (const p of parts) this.solid("rock", p.x0, p.y0, p.x1, p.y1);
    return true;
  }

  /** A crystal formation: a few tall shards (vision blocking) with loot tucked between. */
  crystals(cx: number, cy: number): boolean {
    const shards: Rect[] = [];
    for (let i = 0; i < 3 + this.rng.int(2); i++) {
      const s = 40 + this.rng.int(40);
      const x = Math.round(cx + this.rng.range(-110, 110));
      const y = Math.round(cy + this.rng.range(-110, 110));
      shards.push({ x0: x - s / 2, y0: y - s / 2, x1: x + s / 2, y1: y + s / 2 });
    }
    const bound = { x0: cx - 170, y0: cy - 170, x1: cx + 170, y1: cy + 170 };
    if (!this.free(bound, 30)) return false;
    for (const s of shards) this.solid("crystal", s.x0, s.y0, s.x1, s.y1);
    const spot = this.freePoint(bound, 30);
    if (spot) this.loot(spot.x, spot.y, "building");
    return true;
  }

  /** A clump of bushes. */
  bushClump(cx: number, cy: number, n: number, spread: number) {
    for (let i = 0; i < n; i++) {
      const x = cx + this.rng.range(-spread, spread);
      const y = cy + this.rng.range(-spread, spread);
      const r = 55 + this.rng.int(50);
      if (this.free({ x0: x - r * 0.6, y0: y - r * 0.6, x1: x + r * 0.6, y1: y + r * 0.6 }, 0)) this.bush(x, y, r);
    }
  }

  /** Ruins: broken walls around a tiled floor, some crates and good loot (no roof). */
  ruins(x0: number, y0: number, size: number): boolean {
    const r = { x0, y0, x1: x0 + size, y1: y0 + size };
    if (!this.free(r, 40)) return false;
    this.deco("tile", r.x0, r.y0, r.x1, r.y1);
    // Each side is a wall run with big random gaps (rubble openings).
    for (let s = 0; s < 4; s++) {
      const horizontal = s % 2 === 0;
      const a = horizontal ? r.x0 : r.y0;
      const b = horizontal ? r.x1 : r.y1;
      const c = s === 0 ? r.y0 : s === 1 ? r.x1 : s === 2 ? r.y1 : r.x0;
      this.wallRun("wall", horizontal, a, b, c, this.gapsOn(a, b, 1 + this.rng.int(2), 120 + this.rng.int(80)), 26);
    }
    // A pillar stub in the middle and a crate.
    const m = size / 2;
    this.solid("wall", x0 + m - 30, y0 + m - 30, x0 + m + 30, y0 + m + 30);
    this.scatter("crate", inset(r, 60), 54, 54, 8, 20);
    for (let i = 0; i < 2; i++) {
      const spot = this.freePoint(inset(r, 50), 26);
      if (spot) this.loot(spot.x, spot.y, "building");
    }
    return true;
  }

  /** Finish: index everything and pick spread-out spawn points. */
  build(theme: MapDef["theme"], spawnCount: number): MapDef {
    const grid = new StaticGrid(this.half + TERRAIN.border, TERRAIN.gridCell, this.solids.length);
    for (const s of this.solids) grid.insert(s.idx, s);
    const bushGrid = new StaticGrid(this.half + TERRAIN.border, TERRAIN.gridCell, this.bushes.length);
    this.bushes.forEach((b, i) => bushGrid.insert(i, { x0: b.x - b.r, y0: b.y - b.r, x1: b.x + b.r, y1: b.y + b.r }));
    // Loot spots must be clear of solids (props may have landed on them).
    this.lootSpots = this.lootSpots.filter((l) => !this.solids.some((s) => overlaps(s, { x0: l.x - 20, y0: l.y - 20, x1: l.x + 20, y1: l.y + 20 })));
    const spawns = this.pickSpawns(spawnCount);
    return {
      id: this.id, name: this.name, seed: this.seed, half: this.half, solids: this.solids, grid, bushes: this.bushes, bushGrid,
      water: this.water, bridges: this.bridges, roofs: this.roofs, decor: this.decor, spawns, lootSpots: this.lootSpots, theme,
    };
  }

  /** Spread-out spawn points: candidates on a jittered grid, then farthest-point picking. */
  private pickSpawns(count: number): { x: number; y: number }[] {
    const cands: { x: number; y: number }[] = [];
    const step = Math.max(200, Math.round(this.half / 7));
    for (let y = -this.half + step / 2; y < this.half; y += step) {
      for (let x = -this.half + step / 2; x < this.half; x += step) {
        const px = Math.round(x + this.rng.range(-step * 0.3, step * 0.3));
        const py = Math.round(y + this.rng.range(-step * 0.3, step * 0.3));
        const c = 70;
        const box = { x0: px - c, y0: py - c, x1: px + c, y1: py + c };
        if (!this.free(box, 0)) continue;
        if (this.roofs.some((rf) => overlaps(rf, box))) continue;
        cands.push({ x: px, y: py });
      }
    }
    if (!cands.length) cands.push({ x: 0, y: 0 });
    const out: { x: number; y: number }[] = [cands[this.rng.int(cands.length)] ?? { x: 0, y: 0 }];
    while (out.length < count) {
      let best = cands[0] ?? { x: 0, y: 0 };
      let bd = -1;
      for (const c of cands) {
        let d = Infinity;
        for (const o of out) d = Math.min(d, (c.x - o.x) ** 2 + (c.y - o.y) ** 2);
        if (d > bd) {
          bd = d;
          best = c;
        }
      }
      out.push(best);
    }
    return out;
  }
}

export const inset = (r: Rect, d: number): Rect => ({ x0: r.x0 + d, y0: r.y0 + d, x1: r.x1 - d, y1: r.y1 - d });
