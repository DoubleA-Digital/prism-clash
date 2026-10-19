// CRYSTAL WILDS: open wilderness cut by a winding river (water slows you) with a few
// bridges, rock outcrops that block sight, bush thickets to hide in, ancient ruins with
// better loot, glowing crystal formations, and crates and barrels scattered around.

import { MATCH, MAPS } from "../../config";
import { Rng } from "../../math/rng";
import { MapBuilder } from "./builder";
import type { MapDef } from "./types";

const RIVER_W = 250;
const STEP = 300;

export function buildCrystalWilds(seed: number): MapDef {
  const half = MAPS.crystalWilds.half;
  const rng = new Rng(seed ^ 0x3a7f11d);
  const b = new MapBuilder("crystalWilds", MAPS.crystalWilds.name, seed, half, rng);

  // Patches of moss and sand for floor variety.
  for (let i = 0; i < 26; i++) {
    const s = 260 + rng.int(420);
    const x = Math.round(rng.range(-half, half - s));
    const y = Math.round(rng.range(-half, half - s));
    b.deco(rng.next() < 0.7 ? "moss" : "sand", x, y, x + s, y + Math.round(s * rng.range(0.6, 1.2)));
  }

  river(b, half);

  // Ruins first (they want space), then crystals, rocks, thickets, crates.
  let ruins = 0;
  for (let i = 0; i < 40 && ruins < 6; i++) {
    const size = 420 + rng.int(160);
    if (b.ruins(Math.round(rng.range(-half + 200, half - 200 - size)), Math.round(rng.range(-half + 200, half - 200 - size)), size)) ruins++;
  }
  let crystals = 0;
  for (let i = 0; i < 60 && crystals < 12; i++) if (b.crystals(Math.round(rng.range(-half + 250, half - 250)), Math.round(rng.range(-half + 250, half - 250)))) crystals++;
  let rocks = 0;
  for (let i = 0; i < 160 && rocks < 42; i++) if (b.rocks(Math.round(rng.range(-half + 200, half - 200)), Math.round(rng.range(-half + 200, half - 200)), 130 + rng.int(150))) rocks++;
  for (let i = 0; i < 46; i++) b.bushClump(Math.round(rng.range(-half + 150, half - 150)), Math.round(rng.range(-half + 150, half - 150)), 3 + rng.int(4), 120);
  for (let i = 0; i < 20; i++) b.cratePile(Math.round(rng.range(-half + 200, half - 200)), Math.round(rng.range(-half + 200, half - 200)));
  const all = { x0: -half + 120, y0: -half + 120, x1: half - 120, y1: half - 120 };
  for (let i = 0; i < 26; i++) b.scatter("crate", all, 54, 54, 6, 40);
  for (let i = 0; i < 18; i++) b.scatter("barrel", all, 44, 44, 6, 40);
  for (let i = 0; i < 150; i++) {
    const p = b.freePoint(all, 30, 6);
    if (p) b.loot(p.x, p.y, "street");
  }
  return b.build("wilds", MATCH.fighters);
}

/** The river: a chain of water rects stepping down the map with a meandering center line,
 *  plus three bridges (dry strips with low railings). Props stay off its banks. */
function river(b: MapBuilder, half: number) {
  const rng = b.rng;
  let cx = Math.round(rng.range(-half * 0.35, half * 0.35));
  const bridgeAt = new Set<number>();
  const rows = Math.ceil((half * 2) / STEP);
  while (bridgeAt.size < 3) bridgeAt.add(2 + rng.int(rows - 4));
  for (let k = 0; k < rows; k++) {
    const y0 = -half + k * STEP;
    const next = Math.max(-half + 400, Math.min(half - 400, cx + Math.round(rng.range(-160, 160))));
    const xa = Math.min(cx, next) - RIVER_W / 2;
    const xb = Math.max(cx, next) + RIVER_W / 2;
    b.water.push({ x0: xa, y0, x1: xb, y1: y0 + STEP });
    b.keepOut.push({ x0: xa - 60, y0, x1: xb + 60, y1: y0 + STEP });
    if (bridgeAt.has(k)) {
      const by0 = y0 + STEP / 2 - 80;
      const bridge = { x0: xa - 50, y0: by0, x1: xb + 50, y1: by0 + 160 };
      b.bridges.push(bridge);
      b.deco("bridge", bridge.x0, bridge.y0, bridge.x1, bridge.y1);
      b.solid("cover", bridge.x0 + 30, bridge.y0, bridge.x1 - 30, bridge.y0 + 14);
      b.solid("cover", bridge.x0 + 30, bridge.y1 - 14, bridge.x1 - 30, bridge.y1);
      b.loot(Math.round((bridge.x0 + bridge.x1) / 2), Math.round((bridge.y0 + bridge.y1) / 2), "building");
    }
    cx = next;
  }
}
