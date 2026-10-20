// Line-of-sight shadows: every vision-blocking solid near the camera casts a shadow away
// from the viewer (each of its back-facing edges is extruded far out), and the union is
// filled once with a dark tint. What's in shadow is exactly what the server's LOS check
// hides, so the darkness reads as "you can't see there".

import { FX, type MapDef } from "@prism/shared";

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const FAR = 5000;

export function drawShadows(ctx: CanvasRenderingContext2D, map: MapDef, vx: number, vy: number, b: Bounds, alpha: number = FX.shadowAlpha) {
  const path = new Path2D();
  let any = false;
  const pad = 200;
  map.grid.query(b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad, (i) => {
    const s = map.solids[i];
    if (!s || s.dead || !s.vision) return;
    // Skip the map's outer border walls: everything beyond them is void anyway.
    if (s.x1 - s.x0 > map.half || s.y1 - s.y0 > map.half) return;
    const edge = (ax: number, ay: number, bx: number, by: number) => {
      const ad = Math.hypot(ax - vx, ay - vy) || 1;
      const bd = Math.hypot(bx - vx, by - vy) || 1;
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
      path.lineTo(bx + ((bx - vx) / bd) * FAR, by + ((by - vy) / bd) * FAR);
      path.lineTo(ax + ((ax - vx) / ad) * FAR, ay + ((ay - vy) / ad) * FAR);
      path.closePath();
      any = true;
    };
    // An edge casts shadow when the viewer is behind its outward normal.
    if (vy > s.y0) edge(s.x0, s.y0, s.x1, s.y0);
    if (vy < s.y1) edge(s.x1, s.y1, s.x0, s.y1);
    if (vx > s.x0) edge(s.x0, s.y1, s.x0, s.y0);
    if (vx < s.x1) edge(s.x1, s.y0, s.x1, s.y1);
  });
  if (!any) return;
  ctx.save();
  ctx.fillStyle = `rgba(3,3,14,${alpha})`;
  ctx.fill(path, "nonzero");
  ctx.restore();
}
