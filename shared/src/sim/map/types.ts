// Static map data. A map is generated deterministically from (mapId, seed) on both the
// server and every client, so only the id and seed travel over the network; destructible
// state (hp, broken) is synced separately.

import type { MAPS, SOLIDS } from "../../config";
import type { StaticGrid } from "./grid";

export type MapId = keyof typeof MAPS;
export type SolidKind = keyof typeof SOLIDS;
export const SOLID_KINDS = ["wall", "rock", "crystal", "cover", "fence", "car", "crate", "barrel", "glass"] as const satisfies readonly SolidKind[];

/** Destructible solids use ids from here up (index + base), so they never clash with entity ids. */
export const SOLID_ID_BASE = 1 << 24;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Axis-aligned blocker. Every solid blocks movement and bullets; some also block vision. */
export interface Solid extends Rect {
  id: number;
  idx: number;
  kind: SolidKind;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Blocks line of sight (walls, rocks, crystals). */
  vision: boolean;
  /** Only explosions and melee hurt it. */
  tough: boolean;
  /** 0..1 for visual variety (color, rotation of details). */
  variant: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Roof extends Rect {
  id: number;
  /** 0..1 tint variety. */
  variant: number;
}

export type DecorKind = "road" | "sidewalk" | "plaza" | "lot" | "floor" | "grass" | "moss" | "sand" | "tile" | "bridge" | "lane";

/** Flat floor art (no gameplay effect). Drawn into the floor texture. */
export interface Decor extends Rect {
  kind: DecorKind;
}

export type LootTableId = "street" | "building" | "crate";

export interface LootSpot {
  x: number;
  y: number;
  table: LootTableId;
}

export interface MapDef {
  id: MapId;
  name: string;
  seed: number;
  /** Playable area is [-half, half] on both axes. */
  half: number;
  solids: Solid[];
  grid: StaticGrid;
  bushes: Circle[];
  bushGrid: StaticGrid;
  water: Rect[];
  /** Rects inside water that are dry (bridges). */
  bridges: Rect[];
  roofs: Roof[];
  decor: Decor[];
  spawns: { x: number; y: number }[];
  lootSpots: LootSpot[];
  /** Floor palette for the client. */
  theme: "city" | "wilds" | "yard";
}
