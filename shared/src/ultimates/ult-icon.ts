// Shared frame for ultimate icons: a gold hexagonal crest with corner studs, so an
// ultimate always reads as "ultimate" next to the plain power glyphs.

import { circle, glow, ngon, poly, type Ctx } from "../powers/icon";

export const ULT_GOLD = "#FFD34D";
const GOLD_DEEP = "#B8860B";

/** Draws the gold crest behind the glyph. Call first, then draw the glyph on top. */
export function ultFrame(ctx: Ctx, size: number, accent: string) {
  const r = size * 0.44;
  const hex = ngon(6, r, Math.PI / 6);
  // Dark inner plate tinted toward the ultimate's color.
  ctx.save();
  ctx.shadowBlur = 0;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, "rgba(20,14,40,0.85)");
  g.addColorStop(0.75, "rgba(10,6,22,0.9)");
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  poly(ctx, hex, true, true);
  ctx.restore();
  // Double gold rim.
  glow(ctx, ULT_GOLD, size * 0.08, size * 0.045);
  poly(ctx, hex);
  glow(ctx, GOLD_DEEP, 0, size * 0.015);
  poly(ctx, ngon(6, r * 0.86, Math.PI / 6));
  // Studs on every corner.
  glow(ctx, "#FFF3C4", size * 0.05, 1);
  for (const [x, y] of hex) circle(ctx, x, y, size * 0.028, true);
  ctx.shadowBlur = 0;
}
