// NEON CITY: a 6×6 grid of city blocks around a central plaza. Each block rolls a type
// (one big building, two buildings, a parking lot, a park or a warehouse yard), the streets
// get parked hover cars, barrels and loot. Seeded, so every match plays a little different.

import { MATCH, MAPS, WORLD_ART } from "../../config";
import { Rng } from "../../math/rng";
import { inset, MapBuilder, overlaps } from "./builder";
import type { MapDef, Rect } from "./types";

const PITCH = 1000;
const STREET = 260;
const BLOCK = PITCH - STREET;

type BlockType = "building" | "twin" | "lot" | "park" | "yard";

export function buildNeonCity(seed: number): MapDef {
  const half = MAPS.neonCity.half;
  const rng = new Rng(seed ^ 0x6e30c17);
  const b = new MapBuilder("neonCity", MAPS.neonCity.name, seed, half, rng);
  const n = Math.round((half * 2) / PITCH);
  const blockRect = (i: number, j: number): Rect => {
    const x0 = -half + i * PITCH + STREET / 2;
    const y0 = -half + j * PITCH + STREET / 2;
    return { x0, y0, x1: x0 + BLOCK, y1: y0 + BLOCK };
  };
  const mid = n / 2;
  const isPlaza = (i: number, j: number) => (i === mid - 1 || i === mid) && (j === mid - 1 || j === mid);

  // Street lane markings (decor) along every street center, broken at the intersections,
  // with zebra crosswalks on every arm of an intersection.
  const nearCross = (s: number) => {
    const g = Math.round((s + half) / PITCH) * PITCH - half;
    return Math.abs(s - g) < STREET / 2 + 90 || Math.abs(s + 80 - g) < STREET / 2 + 90;
  };
  for (let k = 0; k <= n; k++) {
    const c = -half + k * PITCH;
    if (k === 0 || k === n) continue;
    for (let s = -half + 60; s < half - 60; s += 160) {
      if (Math.abs(s) < PITCH && Math.abs(c) < PITCH) continue;
      if (nearCross(s)) continue;
      b.deco("lane", c - 3, s, c + 3, s + 80);
      b.deco("lane", s, c - 3, s + 80, c + 3);
    }
  }
  // The plaza first, so nothing else lands on it.
  const plaza: Rect = { x0: blockRect(mid - 1, mid - 1).x0, y0: blockRect(mid - 1, mid - 1).y0, x1: blockRect(mid, mid).x1, y1: blockRect(mid, mid).y1 };
  plazaBlock(b, plaza);

  const cw = WORLD_ART.crosswalk;
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < n; j++) {
      const cx = -half + i * PITCH;
      const cy = -half + j * PITCH;
      const e = STREET / 2 + cw.gap;
      const w = STREET / 2 - cw.inset;
      const arms: Rect[] = [
        { x0: cx - w, y0: cy - e - cw.depth, x1: cx + w, y1: cy - e },
        { x0: cx - w, y0: cy + e, x1: cx + w, y1: cy + e + cw.depth },
        { x0: cx - e - cw.depth, y0: cy - w, x1: cx - e, y1: cy + w },
        { x0: cx + e, y0: cy - w, x1: cx + e + cw.depth, y1: cy + w },
      ];
      for (const a of arms) if (!overlaps(a, plaza, 20)) b.deco("crosswalk", a.x0, a.y0, a.x1, a.y1);
    }
  }

  const weights: Record<BlockType, number> = { building: 34, twin: 22, lot: 15, park: 14, yard: 15 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (isPlaza(i, j)) continue;
      const r = blockRect(i, j);
      b.deco("sidewalk", r.x0, r.y0, r.x1, r.y1);
      const type = rng.weighted(weights);
      if (type === "building") b.building(r.x0 + 70, r.y0 + 70, r.x1 - 70, r.y1 - 70, { doors: 2 + rng.int(2), crates: 2, loot: 4 });
      else if (type === "twin") twinBlock(b, r);
      else if (type === "lot") lotBlock(b, r);
      else if (type === "park") parkBlock(b, r);
      else yardBlock(b, r);
    }
  }

  // Street life: parked cars along the curbs, barrels, crate piles and loot.
  for (let k = 0; k <= n; k++) {
    const c = -half + k * PITCH;
    for (let s = -half + 200; s < half - 200; s += 230) {
      if (rng.next() < 0.22) b.car(s + rng.int(60), c + (rng.next() < 0.5 ? -80 : 80), true);
      if (rng.next() < 0.22) b.car(c + (rng.next() < 0.5 ? -80 : 80), s + rng.int(60), false);
      if (rng.next() < 0.05) b.scatter("barrel", { x0: s - 40, y0: c - 110, x1: s + 80, y1: c + 110 }, 44, 44, 4, 30);
      if (rng.next() < 0.35) {
        const p = b.freePoint({ x0: s - 60, y0: c - 90, x1: s + 60, y1: c + 90 }, 30);
        if (p) b.loot(p.x, p.y, "street");
      }
      if (rng.next() < 0.35) {
        const p = b.freePoint({ x0: c - 90, y0: s - 60, x1: c + 90, y1: s + 60 }, 30);
        if (p) b.loot(p.x, p.y, "street");
      }
    }
  }
  streetlights(b, n, blockRect, isPlaza);
  return b.build("city", MATCH.fighters);
}

/** Streetlights on the sidewalk corners of every block (visual only, no RNG). */
function streetlights(b: MapBuilder, n: number, blockRect: (i: number, j: number) => Rect, isPlaza: (i: number, j: number) => boolean) {
  const sl = WORLD_ART.streetlight;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r = blockRect(i, j);
      const pts: [number, number][] = isPlaza(i, j)
        ? []
        : [[r.x0 + sl.inset, r.y0 + sl.inset], [r.x1 - sl.inset, r.y0 + sl.inset], [r.x0 + sl.inset, r.y1 - sl.inset], [r.x1 - sl.inset, r.y1 - sl.inset]];
      if (!isPlaza(i, j) && (i + j) % 2 === 0) pts.push([(r.x0 + r.x1) / 2, r.y0 + sl.inset], [(r.x0 + r.x1) / 2, r.y1 - sl.inset]);
      for (const [x, y] of pts) {
        if (Math.abs(x) > b.half - 60 || Math.abs(y) > b.half - 60) continue;
        if (b.free({ x0: x - 10, y0: y - 10, x1: x + 10, y1: y + 10 }, 4)) b.lights.push({ x: Math.round(x), y: Math.round(y), r: sl.radius });
      }
    }
  }
}

function plazaBlock(b: MapBuilder, r: Rect) {
  const rng = b.rng;
  b.deco("plaza", r.x0, r.y0, r.x1, r.y1);
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  // The monument: a big prism crystal in the middle, ringed by low benches.
  b.solid("crystal", cx - 90, cy - 90, cx + 90, cy + 90);
  for (const [dx, dy, horiz] of [[0, -230, true], [0, 230, true], [-230, 0, false], [230, 0, false]] as const) {
    if (horiz) b.solid("cover", cx + dx - 90, cy + dy - 14, cx + dx + 90, cy + dy + 14);
    else b.solid("cover", cx + dx - 14, cy + dy - 90, cx + dx + 14, cy + dy + 90);
  }
  // Lamps around the monument.
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.lights.push({ x: cx + sx * 330, y: cy + sy * 330, r: WORLD_ART.streetlight.radius });
  // Four planters (bushes) and kiosks with crates.
  const q = (r.x1 - r.x0) / 4;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const px = cx + sx * q * 1.15;
    const py = cy + sy * q * 1.15;
    b.deco("grass", px - 150, py - 150, px + 150, py + 150);
    b.bushClump(px, py, 4, 90);
    b.cratePile(Math.round(cx + sx * q * 0.55), Math.round(cy - sy * q * 1.5));
  }
  for (let i = 0; i < 10; i++) {
    const p = b.freePoint(inset(r, 80), 30);
    if (p) b.loot(p.x, p.y, rng.next() < 0.3 ? "building" : "street");
  }
}

function twinBlock(b: MapBuilder, r: Rect) {
  const rng = b.rng;
  const vertical = rng.next() < 0.5;
  const split = Math.round(BLOCK * rng.range(0.42, 0.58));
  if (vertical) {
    b.building(r.x0 + 50, r.y0 + 50, r.x0 + split - 60, r.y1 - 50, { crates: 1, loot: 2 });
    b.building(r.x0 + split + 60, r.y0 + 50, r.x1 - 50, r.y1 - 50, { crates: 1, loot: 2 });
    // The alley between them gets a crate pile.
    b.cratePile(r.x0 + split - 30, Math.round((r.y0 + r.y1) / 2));
  } else {
    b.building(r.x0 + 50, r.y0 + 50, r.x1 - 50, r.y0 + split - 60, { crates: 1, loot: 2 });
    b.building(r.x0 + 50, r.y0 + split + 60, r.x1 - 50, r.y1 - 50, { crates: 1, loot: 2 });
    b.cratePile(Math.round((r.x0 + r.x1) / 2), r.y0 + split - 30);
  }
}

function lotBlock(b: MapBuilder, r: Rect) {
  const rng = b.rng;
  b.deco("lot", r.x0 + 30, r.y0 + 30, r.x1 - 30, r.y1 - 30);
  // Fences on two random sides, with openings.
  const sides = rng.shuffle([0, 1, 2, 3]).slice(0, 2);
  for (const s of sides) {
    if (s === 0) b.fence(true, r.x0 + 30, r.x1 - 30, r.y0 + 30, 2);
    if (s === 2) b.fence(true, r.x0 + 30, r.x1 - 30, r.y1 - 30, 2);
    if (s === 1) b.fence(false, r.y0 + 30, r.y1 - 30, r.x1 - 30, 2);
    if (s === 3) b.fence(false, r.y0 + 30, r.y1 - 30, r.x0 + 30, 2);
  }
  // Rows of parked hover cars.
  for (let row = 0; row < 3; row++) {
    const y = r.y0 + 170 + row * 200;
    for (let x = r.x0 + 150; x < r.x1 - 120; x += 120) if (rng.next() < 0.55) b.car(x, y, false);
  }
  for (let i = 0; i < 3; i++) {
    const p = b.freePoint(inset(r, 70), 30);
    if (p) b.loot(p.x, p.y, "street");
  }
}

function parkBlock(b: MapBuilder, r: Rect) {
  const rng = b.rng;
  b.deco("grass", r.x0 + 20, r.y0 + 20, r.x1 - 20, r.y1 - 20);
  for (let i = 0; i < 4; i++) b.bushClump(Math.round(rng.range(r.x0 + 140, r.x1 - 140)), Math.round(rng.range(r.y0 + 140, r.y1 - 140)), 3 + rng.int(3), 110);
  // Benches (low cover) and a little pavilion.
  for (let i = 0; i < 3; i++) {
    const horiz = rng.next() < 0.5;
    b.scatter("cover", inset(r, 80), horiz ? 150 : 28, horiz ? 28 : 150, 8, 40);
  }
  if (rng.next() < 0.5) b.crystals(Math.round((r.x0 + r.x1) / 2), Math.round((r.y0 + r.y1) / 2));
  for (let i = 0; i < 4; i++) {
    const p = b.freePoint(inset(r, 60), 30);
    if (p) b.loot(p.x, p.y, "street");
  }
}

function yardBlock(b: MapBuilder, r: Rect) {
  const rng = b.rng;
  b.deco("lot", r.x0 + 30, r.y0 + 30, r.x1 - 30, r.y1 - 30);
  b.fence(true, r.x0 + 30, r.x1 - 30, r.y0 + 30, 1);
  b.fence(true, r.x0 + 30, r.x1 - 30, r.y1 - 30, 1);
  b.fence(false, r.y0 + 30, r.y1 - 30, r.x0 + 30, 1);
  b.fence(false, r.y0 + 30, r.y1 - 30, r.x1 - 30, 1);
  // A small shed and stacks of crates.
  const sx = rng.next() < 0.5 ? r.x0 + 90 : r.x1 - 390;
  const sy = rng.next() < 0.5 ? r.y0 + 90 : r.y1 - 340;
  b.building(sx, sy, sx + 300, sy + 250, { doors: 2, windows: false, crates: 1, loot: 2 });
  for (let i = 0; i < 4; i++) b.cratePile(Math.round(rng.range(r.x0 + 140, r.x1 - 200)), Math.round(rng.range(r.y0 + 140, r.y1 - 200)));
  for (let i = 0; i < 3; i++) {
    const p = b.freePoint(inset(r, 70), 30);
    if (p) b.loot(p.x, p.y, "street");
  }
}
