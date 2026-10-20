// Hero portrait for the lobby, hero select and results podium: the full chibi standing in a
// three-quarter view on a neon backdrop in the player's color. The fills are painted as vectors
// at the requested size (crisp at any scale); the rim comes from the sprite cache.

import { HEROES, type HeroId } from "@prism/shared";
import { drawGlow, withAlpha } from "../glow";
import { drawFoot, drawHand, paintBody } from "./body";
import { paintHead } from "./head";
import { bucketView, BODY_Y, HEAD_Y, blit, rimSprite } from "./sprites";

/** Bucket for the portrait pose: turned a little to the right, facing the viewer. */
const PORTRAIT_BUCKET = 6;

/**
 * Draws hero `heroId` into the square [0, size] x [0, size] of the current transform.
 * `opts.backdrop` (default true) paints the glow disc behind; `opts.time` adds an idle bob.
 */
export function drawHeroPortrait(ctx: CanvasRenderingContext2D, heroId: HeroId, color: string, size: number, opts: { backdrop?: boolean; time?: number } = {}) {
  const def = HEROES[heroId] ?? HEROES.blaze;
  const v = bucketView(PORTRAIT_BUCKET);
  const k = size / 64;
  const t = opts.time ?? 0;
  const bob = Math.sin(t * 2.4) * 0.8;
  ctx.save();
  if (opts.backdrop !== false) {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c * 0.9, 0, c, c, c);
    g.addColorStop(0, withAlpha(color, 0.34));
    g.addColorStop(0.6, withAlpha(color, 0.1));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.translate(size / 2, size / 2 + 9.5 * k);
  ctx.scale(k, k);
  drawGlow(ctx, 0, 19, 30, color, 0.35);
  ctx.fillStyle = "rgba(3,2,12,0.5)";
  ctx.beginPath();
  ctx.ellipse(0, 20, 15, 5.4, 0, 0, Math.PI * 2);
  ctx.fill();
  drawFoot(ctx, def, color, -5.3, 18.6, 0);
  drawFoot(ctx, def, color, 5.3, 18.6, 0);
  ctx.translate(0, bob * 0.4);
  blit(ctx, rimSprite(heroId, color, PORTRAIT_BUCKET), 0, 0);
  ctx.save();
  ctx.translate(0, BODY_Y);
  paintBody(ctx, def, v);
  ctx.restore();
  ctx.save();
  ctx.translate(0, HEAD_Y + bob * 0.6);
  paintHead(ctx, def, v);
  ctx.restore();
  drawHand(ctx, def, color, -11.5, 11.5);
  drawHand(ctx, def, color, 12, 10.5);
  ctx.restore();
}
