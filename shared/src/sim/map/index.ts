// Map registry and terrain queries (water, bushes, spawn checks).

import { MATCH, MAPS, SOLIDS } from "../../config";
import { Rng } from "../../math/rng";
import { MapBuilder } from "./builder";
import { buildCrystalWilds } from "./crystalWilds";
import { buildNeonCity } from "./neonCity";
import { SOLID_ID_BASE, type MapDef, type MapId, type Solid, type SolidKind } from "./types";

export * from "./types";
export { StaticGrid } from "./grid";

/** Maps a match can be played on (the test yard is for tests and debugging). */
export const PLAY_MAPS = ["neonCity", "crystalWilds"] as const satisfies readonly MapId[];
export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const mapName = (id: MapId) => MAPS[id].name;
export const isMapId = (s: unknown): s is MapId => typeof s === "string" && (MAP_IDS as string[]).includes(s);

function buildTestYard(seed: number): MapDef {
  const b = new MapBuilder("testYard", MAPS.testYard.name, seed, MAPS.testYard.half, new Rng(seed ^ 0x7e57));
  return b.build("yard", MATCH.fighters);
}

/** Adds a solid to a built map (tests, debugging). */
export function addSolid(map: MapDef, kind: SolidKind, x0: number, y0: number, x1: number, y1: number): Solid {
  const def = SOLIDS[kind];
  const idx = map.solids.length;
  const s: Solid = { x0, y0, x1, y1, id: SOLID_ID_BASE + idx, idx, kind, hp: def.hp, maxHp: def.hp, dead: false, vision: def.vision, tough: def.tough, variant: 0.5 };
  map.solids.push(s);
  map.grid.insert(idx, s);
  return s;
}

/** Adds a bush to a built map (tests, debugging). */
export function addBush(map: MapDef, x: number, y: number, r: number) {
  map.bushes.push({ x, y, r });
  map.bushGrid.insert(map.bushes.length - 1, { x0: x - r, y0: y - r, x1: x + r, y1: y + r });
}

export function buildMap(id: MapId, seed: number): MapDef {
  if (id === "neonCity") return buildNeonCity(seed);
  if (id === "crystalWilds") return buildCrystalWilds(seed);
  return buildTestYard(seed);
}

export function inWater(map: MapDef, x: number, y: number): boolean {
  let wet = false;
  for (const w of map.water) {
    if (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1) {
      wet = true;
      break;
    }
  }
  if (!wet) return false;
  for (const b of map.bridges) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return false;
  return true;
}

export function inBush(map: MapDef, x: number, y: number): boolean {
  let hit = false;
  map.bushGrid.query(x, y, x, y, (i) => {
    const b = map.bushes[i];
    if (b && (x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) {
      hit = true;
      return true;
    }
    return false;
  });
  return hit;
}

/** Index of the roof covering a point, or -1. */
export function roofAt(map: MapDef, x: number, y: number): number {
  for (let i = 0; i < map.roofs.length; i++) {
    const r = map.roofs[i];
    if (r && x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return i;
  }
  return -1;
}
