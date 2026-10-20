// Terrain drawn live on top of the cached ground (crisp at any zoom, culled to the camera):
// walls with height and neon rims, faceted rocks, glowing crystals, barriers and bridge
// railings, neon fences, hover cars, wooden and metal crates with rarity trim, explosive
// barrels, glass panels (cracking as they take damage), bush foliage drawn over players,
// and rooftops with neon signs that fade out while you're inside the building.
// Module art lives in ./world/.

import type { MapDef, Solid } from "@prism/shared";
import { breakColors, drawBarrel, drawCar, drawCracks, drawCrate } from "./world/breakables";
import { drawBushes } from "./world/foliage";
import { drawCover, drawCrystal, drawFence, drawGlass, drawRock } from "./world/props";
import { intersects, type Bounds } from "./world/rand";
import { Roofs } from "./world/roofs";
import { drawWalls } from "./world/walls";

export { breakColors };

export class Terrain {
  private roofs: Roofs;
  private edge: string;
  /** Low cover pieces that are bridge railings (drawn as wood). */
  private rails = new Set<number>();
  private walls: Solid[] = [];
  private rest: Solid[] = [];

  constructor(readonly map: MapDef) {
    this.roofs = new Roofs(map);
    this.edge = map.theme === "wilds" ? "#2BFFC8" : "#7CF6FF";
    for (const s of map.solids) if (s.kind === "cover" && map.bridges.some((b) => intersects(b, s, 2))) this.rails.add(s.idx);
  }

  /** Solids in view: `tall` = the sight blockers (walls, rocks, crystals, drawn above the
   *  shadows), otherwise the low stuff (cover, crates, cars, glass… drawn under players). */
  drawSolids(ctx: CanvasRenderingContext2D, b: Bounds, time: number, tall: boolean) {
    const walls = this.walls;
    const rest = this.rest;
    walls.length = 0;
    rest.length = 0;
    const m = this.map;
    m.grid.query(b.x0 - 60, b.y0 - 60, b.x1 + 60, b.y1 + 60, (i) => {
      const s = m.solids[i];
      if (!s || s.dead || s.vision !== tall || !intersects(s, b, 60)) return;
      // The map's outer border walls sit in the void past the glowing edge line.
      if (s.x1 - s.x0 > m.half || s.y1 - s.y0 > m.half) return;
      if (s.kind === "wall") walls.push(s);
      else rest.push(s);
    });
    // Back to front, so overlapping props stack naturally.
    rest.sort((a, c) => a.y1 - c.y1);
    if (tall) drawWalls(ctx, m, walls, b, time);
    for (const s of rest) this.drawSolid(ctx, s, time);
  }

  private drawSolid(ctx: CanvasRenderingContext2D, s: Solid, time: number) {
    const dmg = s.maxHp > 0 ? 1 - s.hp / s.maxHp : 0;
    switch (s.kind) {
      case "rock":
        drawRock(ctx, s, this.edge);
        break;
      case "crystal":
        drawCrystal(ctx, s, time);
        break;
      case "cover":
        drawCover(ctx, s, this.rails.has(s.idx));
        break;
      case "fence":
        drawFence(ctx, s, time);
        break;
      case "car":
        drawCar(ctx, s, time);
        break;
      case "crate":
        drawCrate(ctx, s, time);
        break;
      case "barrel":
        drawBarrel(ctx, s, time);
        break;
      case "glass":
        drawGlass(ctx, s, time);
        break;
      default:
        break;
    }
    if (dmg > 0.05 && s.kind !== "barrel" && s.kind !== "fence") drawCracks(ctx, s, dmg);
  }

  /** Bush foliage, drawn above players so it hides them. Your own bush is see-through. */
  drawBushes(ctx: CanvasRenderingContext2D, b: Bounds, time: number, me: { x: number; y: number } | null) {
    drawBushes(ctx, this.map, b, time, me);
  }

  /** Roofs: opaque from outside, fading away while `inside` is that building. */
  drawRoofs(ctx: CanvasRenderingContext2D, b: Bounds, inside: number, dt: number, time = performance.now() / 1000) {
    this.roofs.draw(ctx, b, inside, dt, time);
  }
}
