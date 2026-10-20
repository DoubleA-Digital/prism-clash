// Walls with height: a dark south face under each wall, a textured top (concrete in the
// city, mossy stone blocks in the ruins), a neon rim outside the silhouette (stroked first,
// then covered by the tops, so joints between wall pieces never show seams), a lit top
// edge, and glowing door-frame posts on both sides of every doorway.

import { WORLD_ART, type MapDef, type Solid } from "@prism/shared";
import { withAlpha } from "../glow";
import { texture } from "./textures";
import { intersects, type Bounds } from "./rand";

export function drawWalls(ctx: CanvasRenderingContext2D, map: MapDef, walls: readonly Solid[], view: Bounds, time: number) {
  if (!walls.length) return;
  const ruins = map.theme === "wilds";
  const edge = ruins ? "#2BFFC8" : "#7CF6FF";
  const face = WORLD_ART.wallFace;
  const path = new Path2D();
  for (const s of walls) path.rect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  ctx.save();
  // South faces: the wall's visible side, darker toward the floor.
  ctx.fillStyle = ruins ? "#252b3e" : "#171944";
  for (const s of walls) ctx.fillRect(s.x0, s.y1 - 1, s.x1 - s.x0, face + 1);
  ctx.fillStyle = ruins ? "rgba(8,10,18,0.6)" : "rgba(4,4,16,0.6)";
  for (const s of walls) ctx.fillRect(s.x0, s.y1 + face * 0.45, s.x1 - s.x0, face * 0.55);
  if (!ruins) {
    // A faint neon base line where the face meets the floor.
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = withAlpha(edge, 0.12);
    for (const s of walls) ctx.fillRect(s.x0, s.y1 + face - 2, s.x1 - s.x0, 2);
    ctx.globalCompositeOperation = "source-over";
  }
  // Rim: glow + crisp line, half of which the tops then cover.
  ctx.globalCompositeOperation = "lighter";
  const pulse = 0.8 + 0.2 * Math.sin(time * 1.6);
  ctx.strokeStyle = withAlpha(edge, (ruins ? 0.05 : 0.1) * pulse);
  ctx.lineWidth = 16;
  ctx.stroke(path);
  ctx.strokeStyle = withAlpha(edge, ruins ? 0.35 : 0.85);
  ctx.lineWidth = ruins ? 3 : 4;
  ctx.stroke(path);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = texture(ruins ? "stoneWall" : "concreteWall");
  ctx.fill(path);
  // Lit top edge and a soft dark bottom edge on every piece.
  ctx.fillStyle = ruins ? "rgba(200,255,235,0.14)" : "rgba(210,230,255,0.2)";
  for (const s of walls) ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, Math.min(3, s.y1 - s.y0));
  ctx.fillStyle = "rgba(0,0,10,0.35)";
  for (const s of walls) ctx.fillRect(s.x0, s.y1 - 3, s.x1 - s.x0, 3);
  if (!ruins) {
    // Inset panel line on thick walls.
    ctx.strokeStyle = "rgba(124,246,255,0.08)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const s of walls) {
      const w = s.x1 - s.x0;
      const h = s.y1 - s.y0;
      if (w >= h && h >= 16) {
        ctx.moveTo(s.x0 + 4, s.y0 + h / 2);
        ctx.lineTo(s.x1 - 4, s.y0 + h / 2);
      } else if (w >= 16) {
        ctx.moveTo(s.x0 + w / 2, s.y0 + 4);
        ctx.lineTo(s.x0 + w / 2, s.y1 - 4);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
  if (!ruins) doorFrames(ctx, map, view, edge, time);
}

function doorFrames(ctx: CanvasRenderingContext2D, map: MapDef, view: Bounds, edge: string, time: number) {
  ctx.save();
  for (const d of map.doors) {
    if (!intersects(d, view, 30)) continue;
    const horiz = d.x1 - d.x0 > d.y1 - d.y0;
    const posts = horiz
      ? [[d.x0 - 5, d.y0 - 2, 10, d.y1 - d.y0 + 4], [d.x1 - 5, d.y0 - 2, 10, d.y1 - d.y0 + 4]]
      : [[d.x0 - 2, d.y0 - 5, d.x1 - d.x0 + 4, 10], [d.x0 - 2, d.y1 - 5, d.x1 - d.x0 + 4, 10]];
    for (const [x, y, w, h] of posts) {
      ctx.fillStyle = "#2e3270";
      ctx.fillRect(x ?? 0, y ?? 0, w ?? 0, h ?? 0);
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = withAlpha(edge, 0.55 + 0.15 * Math.sin(time * 2.4 + d.x0 * 0.01));
    for (const [x, y, w, h] of posts) ctx.fillRect((x ?? 0) + 2, (y ?? 0) + 2, (w ?? 0) - 4, (h ?? 0) - 4);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}
