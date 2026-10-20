// Doorways, baked into the ground chunks: a threshold plate, two door leaves swung open into
// the room, and for outer doors a doormat with warm light spilling out.

import type { MapDef, Rect } from "@prism/shared";
import { intersects, type Bounds } from "./rand";

/** The roof whose building contains the point (with a margin), or null. */
function roofNear(map: MapDef, x: number, y: number): Rect | null {
  for (const r of map.roofs) if (x > r.x0 - 2 && x < r.x1 + 2 && y > r.y0 - 2 && y < r.y1 + 2) return r;
  return null;
}

export function doors(g: CanvasRenderingContext2D, map: MapDef, area: Bounds) {
  for (const d of map.doors) {
    if (!intersects(d, area, 80)) continue;
    const horiz = d.x1 - d.x0 > d.y1 - d.y0;
    const cx = (d.x0 + d.x1) / 2;
    const cy = (d.y0 + d.y1) / 2;
    const room = roofNear(map, cx, cy);
    // Which way is inside: toward the building center (outer doors), else either.
    const inX = room ? Math.sign((room.x0 + room.x1) / 2 - cx) || 1 : 1;
    const inY = room ? Math.sign((room.y0 + room.y1) / 2 - cy) || 1 : 1;
    const outer = room && (Math.abs(cx - room.x0) < 30 || Math.abs(cx - room.x1) < 30 || Math.abs(cy - room.y0) < 30 || Math.abs(cy - room.y1) < 30);
    // Threshold plate.
    g.fillStyle = "#2c2f5e";
    g.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    g.fillStyle = "rgba(124,246,255,0.18)";
    if (horiz) for (let x = d.x0 + 6; x < d.x1 - 4; x += 10) g.fillRect(x, d.y0 + 3, 4, d.y1 - d.y0 - 6);
    else for (let y = d.y0 + 6; y < d.y1 - 4; y += 10) g.fillRect(d.x0 + 3, y, d.x1 - d.x0 - 6, 4);
    // Two door leaves swung open inward.
    const len = (horiz ? d.x1 - d.x0 : d.y1 - d.y0) / 2 - 4;
    g.fillStyle = "#24285a";
    g.strokeStyle = "rgba(124,246,255,0.35)";
    g.lineWidth = 1.5;
    const leaf = (x: number, y: number, lw: number, lh: number) => {
      g.fillRect(x, y, lw, lh);
      g.strokeRect(x, y, lw, lh);
    };
    if (horiz) {
      const y = inY > 0 ? d.y1 : d.y0 - len;
      leaf(d.x0 + 1, y, 6, len);
      leaf(d.x1 - 7, y, 6, len);
    } else {
      const x = inX > 0 ? d.x1 : d.x0 - len;
      leaf(x, d.y0 + 1, len, 6);
      leaf(x, d.y1 - 7, len, 6);
    }
    if (outer) {
      // Doormat outside, and light spilling out of the doorway.
      const mx = horiz ? cx : cx - inX * 34;
      const my = horiz ? cy - inY * 34 : cy;
      const mw = horiz ? (d.x1 - d.x0) * 0.6 : 26;
      const mh = horiz ? 26 : (d.y1 - d.y0) * 0.6;
      g.fillStyle = "rgba(255,211,77,0.06)";
      g.beginPath();
      g.ellipse(mx - (horiz ? 0 : inX * 20), my - (horiz ? inY * 20 : 0), horiz ? 80 : 60, horiz ? 60 : 80, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#1a1530";
      g.fillRect(mx - mw / 2, my - mh / 2, mw, mh);
      g.strokeStyle = "rgba(255,46,136,0.3)";
      g.strokeRect(mx - mw / 2 + 3, my - mh / 2 + 3, mw - 6, mh - 6);
    }
  }
}
