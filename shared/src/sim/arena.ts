// The arena: a 12-sided polygon sized for the player count, plus one of three layouts
// of destructible crystal pillars and nebula patches (hide spots, like Brawl Stars bushes).

import { ARENA } from "../config";
import { Rng } from "../math/rng";
import type { Nebula, Pillar } from "./types";

export const LAYOUTS = ["shatteredGrid", "twinCores", "openVoid"] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export const LAYOUT_NAMES: Record<LayoutId, string> = { shatteredGrid: "Shattered Grid", twinCores: "Twin Cores", openVoid: "Open Void" };

export interface ArenaDef {
  layout: LayoutId;
  radius: number;
  /** Polygon vertices, counter-clockwise. */
  verts: { x: number; y: number }[];
  /** Wall segments with inward normals. */
  walls: { ax: number; ay: number; bx: number; by: number; nx: number; ny: number }[];
  pillars: Pillar[];
  nebulas: Nebula[];
}

export function arenaRadius(players: number): number {
  return ARENA.baseRadius + ARENA.perPlayerRadius * Math.max(2, Math.min(5, players));
}

export function buildArena(layout: LayoutId, players: number, seed: number, firstPillarId: number): ArenaDef {
  const radius = arenaRadius(players);
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < ARENA.sides; i++) {
    const a = (i / ARENA.sides) * Math.PI * 2 + Math.PI / ARENA.sides;
    verts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  const walls = verts.map((a, i) => {
    const b = verts[(i + 1) % verts.length] ?? a;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const l = Math.hypot(mx, my) || 1;
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, nx: -mx / l, ny: -my / l };
  });

  const rng = new Rng(seed ^ 0x51ed);
  let nextId = firstPillarId;
  const pillars: Pillar[] = [];
  const add = (x: number, y: number, size: "small" | "medium" | "large") => {
    const hp = ARENA.pillarHp[size];
    pillars.push({ id: nextId++, x, y, r: ARENA.pillarRadius[size], hp, maxHp: hp, dead: false });
  };
  const nebulas: Nebula[] = [];
  const s = radius / 1400;

  if (layout === "shatteredGrid") {
    // Two rings of pillars, offset, with gaps for lanes.
    const ring = (count: number, rr: number, size: "small" | "medium", phase: number) => {
      for (let i = 0; i < count; i++) {
        const a = phase + (i / count) * Math.PI * 2 + rng.range(-0.08, 0.08);
        add(Math.cos(a) * rr, Math.sin(a) * rr, size);
      }
    };
    ring(6, radius * 0.3, "medium", 0);
    ring(8, radius * 0.62, "small", Math.PI / 8);
    add(0, 0, "medium");
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
      nebulas.push({ x: Math.cos(a) * radius * 0.47, y: Math.sin(a) * radius * 0.47, r: 120 * s + 40 });
    }
  } else if (layout === "twinCores") {
    add(-radius * 0.26, 0, "large");
    add(radius * 0.26, 0, "large");
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(Math.cos(a) * radius * 0.6, Math.sin(a) * radius * 0.6, "small");
    }
    nebulas.push({ x: 0, y: -radius * 0.42, r: 150 * s + 40 }, { x: 0, y: radius * 0.42, r: 150 * s + 40 });
    nebulas.push({ x: -radius * 0.66, y: 0, r: 100 * s + 30 }, { x: radius * 0.66, y: 0, r: 100 * s + 30 });
  } else {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng.range(-0.2, 0.2);
      add(Math.cos(a) * radius * 0.4, Math.sin(a) * radius * 0.4, "small");
    }
    nebulas.push({ x: 0, y: 0, r: 110 * s + 40 });
  }
  return { layout, radius, verts, walls, pillars, nebulas };
}

/** Spawn points evenly spaced around the edge, facing the center. */
export function spawnPoints(arena: ArenaDef, count: number, rotation: number): { x: number; y: number; aim: number }[] {
  const out: { x: number; y: number; aim: number }[] = [];
  const rr = arena.radius * Math.cos(Math.PI / 12) - 170;
  for (let i = 0; i < count; i++) {
    const a = rotation + (i / count) * Math.PI * 2;
    out.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, aim: a + Math.PI });
  }
  return out;
}

/** Inradius of the polygon: every point within this distance of the center is inside. */
export const inRadius = (arena: ArenaDef) => arena.radius * Math.cos(Math.PI / ARENA.sides);

export function insideNebula(arena: ArenaDef, x: number, y: number): boolean {
  for (const n of arena.nebulas) if ((x - n.x) ** 2 + (y - n.y) ** 2 < n.r * n.r) return true;
  return false;
}
