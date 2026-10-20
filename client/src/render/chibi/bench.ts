// Micro-benchmark: average cost of one drawHero call with a warm cache, measured on an
// offscreen 1280x720 canvas with 12 heroes in mixed animation states.

import { HERO_IDS, WEAPON_IDS } from "@prism/shared";
import { drawHero } from "./hero";
import { warmChibiCache } from "./sprites";
import { idleAnim, type ChibiAnim } from "./types";

export interface ChibiBenchResult {
  heroes: number;
  frames: number;
  /** Microseconds per drawHero call (warm cache). */
  usPerHero: number;
  /** Milliseconds per frame for all heroes. */
  msPerFrame: number;
  /** Milliseconds to build the sprite cache for these heroes and colors (cold). */
  warmMs: number;
}

const COLORS = ["#00F0FF", "#FF2E88", "#9DFF3A", "#FFC83D", "#A970FF", "#FF8A2B", "#2BFFC8", "#FF7BD5", "#5FA8FF", "#FF4A4A", "#B6FF8F", "#E8E4FF"];

export function benchmarkChibi(frames = 300, heroes = 12): ChibiBenchResult {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 720;
  const ctx = c.getContext("2d");
  if (!ctx) return { heroes, frames: 0, usPerHero: 0, msPerFrame: 0, warmMs: 0 };
  const t0 = performance.now();
  warmChibiCache(HERO_IDS, COLORS.slice(0, heroes));
  const warmMs = performance.now() - t0;
  const anims: ChibiAnim[] = [];
  for (let i = 0; i < heroes; i++) anims.push(idleAnim());
  const start = performance.now();
  for (let f = 0; f < frames; f++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 1280, 720);
    const time = f / 60;
    for (let i = 0; i < heroes; i++) {
      const a = anims[i]!;
      a.walkPhase = time * 12 + i;
      a.speed = i % 3 === 0 ? 0 : 330;
      a.recoilT = ((time * 3 + i * 0.17) % 1);
      a.reloadT = i % 4 === 1 ? (time * 0.5) % 1 : -1;
      a.hitT = i % 5 === 2 ? (time * 2) % 1 : -1;
      drawHero(ctx, {
        heroId: HERO_IDS[i % HERO_IDS.length]!,
        color: COLORS[i % COLORS.length]!,
        x: 80 + (i % 6) * 210,
        y: 180 + Math.floor(i / 6) * 330,
        aim: time * 1.3 + i,
        weapon: { id: WEAPON_IDS[i % WEAPON_IDS.length]!, rarity: i % 4 },
        anim: a,
        scale: 1.4,
        time,
        seed: i,
      });
    }
  }
  // Force the GPU / rasterizer to finish so the timing is honest.
  ctx.getImageData(0, 0, 1, 1);
  const ms = performance.now() - start;
  return { heroes, frames, usPerHero: (ms * 1000) / (frames * heroes), msPerFrame: ms / frames, warmMs };
}
