// Paints the static ground of one area of the map (a chunk, or the whole map at low res for
// the fallback texture): base terrain, streets with curbs, lane dashes and crosswalks,
// sidewalks, plazas, parking lots, park grass, building interiors with doors, river banks,
// shallows and wooden bridges, ruins with scattered rubble, streetlight bases and ambient
// occlusion under walls. The caller has set the transform to world units and clipped.

import { inWater, WORLD_ART, type Decor, type DecorKind, type MapDef, type Rect } from "@prism/shared";
import { texture, type TextureId } from "./textures";
import { hash, intersects, Prng, type Bounds } from "./rand";
import type { Edge } from "./water";
import { doors } from "./doors";

export interface GroundData {
  shore: readonly Edge[];
}

const ORDER: DecorKind[] = ["moss", "sand", "sidewalk", "plaza", "lot", "grass", "tile", "floor", "lane", "crosswalk"];

const fill = (g: CanvasRenderingContext2D, id: TextureId, r: Rect) => {
  g.fillStyle = texture(id);
  g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
};

/** Interior material for a building floor, chosen per building. */
function floorMaterial(d: Rect): TextureId {
  const w = d.x1 - d.x0;
  const h = d.y1 - d.y0;
  if (w * h < 340 * 300) return "grate";
  const k = hash(d.x0, d.y0, 17);
  return k < 0.4 ? "tile" : k < 0.72 ? "wood" : "carpet";
}

function innerShadow(g: CanvasRenderingContext2D, r: Rect, depth: number, alpha: number) {
  for (let i = 0; i < 4; i++) {
    const d = (i + 0.5) * (depth / 4);
    g.strokeStyle = `rgba(2,2,12,${alpha * (1 - i / 4)})`;
    g.lineWidth = depth / 4 + 0.5;
    g.strokeRect(r.x0 + d, r.y0 + d, r.x1 - r.x0 - d * 2, r.y1 - r.y0 - d * 2);
  }
}

function decor(g: CanvasRenderingContext2D, map: MapDef, d: Decor, detail: boolean) {
  const w = d.x1 - d.x0;
  const h = d.y1 - d.y0;
  switch (d.kind) {
    case "moss":
    case "sand": {
      g.fillStyle = texture(d.kind);
      for (const [s, a] of [[1.1, 0.3], [1, 0.55], [0.88, 1]] as const) {
        g.globalAlpha = a;
        g.beginPath();
        g.ellipse(d.x0 + w / 2, d.y0 + h / 2, (w / 2) * s, (h / 2) * s, hash(d.x0, d.y0) * 0.6, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }
    case "sidewalk": {
      g.strokeStyle = "rgba(0,0,6,0.5)";
      g.lineWidth = 10;
      g.strokeRect(d.x0 - 5, d.y0 - 5, w + 10, h + 10);
      fill(g, "sidewalk", d);
      // Curb: a lit top edge and a darker lip.
      g.strokeStyle = "rgba(150,170,255,0.16)";
      g.lineWidth = 6;
      g.strokeRect(d.x0 + 3, d.y0 + 3, w - 6, h - 6);
      g.strokeStyle = "rgba(124,246,255,0.22)";
      g.lineWidth = 1.5;
      g.strokeRect(d.x0 + 1, d.y0 + 1, w - 2, h - 2);
      return;
    }
    case "plaza": {
      fill(g, "plaza", d);
      const cx = d.x0 + w / 2;
      const cy = d.y0 + h / 2;
      g.strokeStyle = "rgba(169,112,255,0.13)";
      for (let r = 160; r < Math.min(w, h) / 2 - 40; r += 70) {
        g.lineWidth = r % 140 === 20 ? 6 : 3;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = "rgba(124,246,255,0.18)";
      g.lineWidth = 3;
      g.strokeRect(d.x0 + 4, d.y0 + 4, w - 8, h - 8);
      return;
    }
    case "lot": {
      fill(g, "lot", d);
      g.strokeStyle = "rgba(255,211,77,0.22)";
      g.lineWidth = 4;
      g.beginPath();
      for (let x = d.x0 + 60; x < d.x1 - 30; x += 120) {
        g.moveTo(x, d.y0 + 30);
        g.lineTo(x, d.y0 + 100);
        g.moveTo(x, d.y1 - 100);
        g.lineTo(x, d.y1 - 30);
      }
      g.stroke();
      g.fillStyle = "rgba(255,255,255,0.05)";
      for (let x = d.x0 + 120; x < d.x1 - 60; x += 120) {
        g.fillRect(x - 18, d.y0 + 36, 36, 6);
        g.fillRect(x - 18, d.y1 - 42, 36, 6);
      }
      g.strokeStyle = "rgba(255,211,77,0.12)";
      g.lineWidth = 3;
      g.strokeRect(d.x0 + 6, d.y0 + 6, w - 12, h - 12);
      return;
    }
    case "grass": {
      fill(g, "parkGrass", d);
      innerShadow(g, d, 18, 0.35);
      g.strokeStyle = map.theme === "city" ? "rgba(60,70,130,0.9)" : "rgba(40,90,80,0.6)";
      g.lineWidth = 6;
      g.strokeRect(d.x0 + 3, d.y0 + 3, w - 6, h - 6);
      g.strokeStyle = "rgba(93,255,190,0.14)";
      g.lineWidth = 1.5;
      g.strokeRect(d.x0 + 7, d.y0 + 7, w - 14, h - 14);
      return;
    }
    case "tile": {
      fill(g, "ruinTile", d);
      innerShadow(g, d, 14, 0.3);
      if (!detail) return;
      // Broken, overgrown edges: ground creeps back over the tiles.
      const r = new Prng(hash(d.x0, d.y0, 5) * 1e9);
      g.fillStyle = texture("wildsGround");
      for (let i = 0; i < 26; i++) {
        const side = Math.floor(r.next() * 4);
        const t = r.next();
        const x = side < 2 ? d.x0 + t * w : side === 2 ? d.x0 : d.x1;
        const y = side < 2 ? (side === 0 ? d.y0 : d.y1) : d.y0 + t * h;
        g.beginPath();
        g.ellipse(x, y, r.range(14, 40), r.range(10, 26), r.next() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgba(40,140,100,0.16)";
      for (let i = 0; i < 10; i++) {
        g.beginPath();
        g.ellipse(r.range(d.x0, d.x1), r.range(d.y0, d.y1), r.range(10, 30), r.range(8, 20), r.next() * 3, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    case "floor": {
      const mat = floorMaterial(d);
      fill(g, mat, d);
      if (mat === "wood" || mat === "carpet") {
        const k = hash(d.x0, d.y0, 3);
        if (k < 0.6 && w > 300 && h > 300) {
          // A rug in the middle of the biggest room.
          const rw = w * 0.34;
          const rh = h * 0.24;
          const rx = d.x0 + w * (0.33 + k * 0.1) - rw / 2;
          const ry = d.y0 + h * 0.5 - rh / 2;
          const col = k < 0.3 ? "rgba(255,46,136,0.12)" : "rgba(0,240,255,0.1)";
          g.fillStyle = col;
          g.beginPath();
          g.roundRect(rx, ry, rw, rh, 10);
          g.fill();
          g.strokeStyle = col;
          g.lineWidth = 5;
          g.strokeRect(rx + 10, ry + 10, rw - 20, rh - 20);
        }
      }
      innerShadow(g, d, 30, 0.45);
      return;
    }
    case "lane": {
      const cx = d.x0 + w / 2;
      const cy = d.y0 + h / 2;
      g.fillStyle = "rgba(255,200,70,0.08)";
      g.fillRect(d.x0 - (w < h ? 5 : 0), d.y0 - (h < w ? 5 : 0), w + (w < h ? 10 : 0), h + (h < w ? 10 : 0));
      g.fillStyle = "rgba(255,211,77,0.55)";
      g.beginPath();
      if (w < h) g.roundRect(cx - 3, d.y0, 6, h, 3);
      else g.roundRect(d.x0, cy - 3, w, 6, 3);
      g.fill();
      return;
    }
    case "crosswalk": {
      const s = WORLD_ART.crosswalk.stripe;
      g.fillStyle = "rgba(215,225,255,0.2)";
      if (w > h) for (let x = d.x0 + 4; x < d.x1 - s / 2; x += s * 2) g.fillRect(x, d.y0, s, h);
      else for (let y = d.y0 + 4; y < d.y1 - s / 2; y += s * 2) g.fillRect(d.x0, y, w, s);
      if (detail) {
        const r = new Prng(hash(d.x0, d.y0, 9) * 1e9);
        g.fillStyle = "rgba(10,12,30,0.5)";
        for (let i = 0; i < 40; i++) g.fillRect(r.range(d.x0, d.x1), r.range(d.y0, d.y1), r.range(2, 6), r.range(2, 5));
      }
      return;
    }
    default:
      return;
  }
}

function banksAndWater(g: CanvasRenderingContext2D, map: MapDef, data: GroundData, area: Bounds, detail: boolean) {
  const water = map.water.filter((w) => intersects(w, area, 80));
  if (!water.length) return;
  const shore = data.shore.filter((e) => intersects({ x0: Math.min(e.x0, e.x1), y0: Math.min(e.y0, e.y1), x1: Math.max(e.x0, e.x1), y1: Math.max(e.y0, e.y1) }, area, 80));
  // Muddy bank and a pebble strip along the shoreline.
  g.lineCap = "round";
  for (const [wd, col] of [[92, "rgba(20,24,36,0.55)"], [64, "#1c1d30"], [40, "#25243a"]] as const) {
    g.strokeStyle = col;
    g.lineWidth = wd;
    g.beginPath();
    for (const e of shore) {
      g.moveTo(e.x0, e.y0);
      g.lineTo(e.x1, e.y1);
    }
    g.stroke();
  }
  if (detail) {
    for (const e of shore) {
      const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
      const r = new Prng(hash(e.x0, e.y0, 21) * 1e9);
      for (let t = 0; t < len; t += 14) {
        const f = t / len;
        const out = r.range(4, 30);
        const x = e.x0 + (e.x1 - e.x0) * f + e.nx * out + (e.nx === 0 ? r.range(-6, 6) : 0);
        const y = e.y0 + (e.y1 - e.y0) * f + e.ny * out + (e.ny === 0 ? r.range(-6, 6) : 0);
        const l = Math.round(r.range(40, 70));
        g.fillStyle = `rgb(${l},${l + 4},${l + 22})`;
        g.beginPath();
        g.ellipse(x, y, r.range(3, 7), r.range(2, 5), r.next() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Deep water, then lighter shallows hugging the shore (clipped to the water).
  const clip = new Path2D();
  for (const w of water) clip.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
  g.fillStyle = "#04193a";
  g.fill(clip);
  g.save();
  g.clip(clip);
  for (const w of water) {
    const cx = (w.x0 + w.x1) / 2;
    const grd = g.createLinearGradient(w.x0, 0, w.x1, 0);
    grd.addColorStop(0, "rgba(6,40,88,0)");
    grd.addColorStop(0.5, "rgba(10,60,120,0.35)");
    grd.addColorStop(1, "rgba(6,40,88,0)");
    g.fillStyle = grd;
    g.fillRect(Math.min(cx - 200, w.x0), w.y0, Math.max(400, w.x1 - w.x0), w.y1 - w.y0);
  }
  g.lineCap = "round";
  for (const [wd, col] of [[110, "rgba(16,82,140,0.22)"], [64, "rgba(30,120,180,0.22)"], [26, "rgba(70,170,220,0.28)"]] as const) {
    g.strokeStyle = col;
    g.lineWidth = wd;
    g.beginPath();
    for (const e of shore) {
      g.moveTo(e.x0, e.y0);
      g.lineTo(e.x1, e.y1);
    }
    g.stroke();
  }
  g.restore();
}

function bridges(g: CanvasRenderingContext2D, map: MapDef, area: Bounds) {
  for (const b of map.bridges) {
    if (!intersects(b, area, 40)) continue;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    // Shadow on the water and support posts.
    g.fillStyle = "rgba(0,0,10,0.45)";
    g.fillRect(b.x0 + 6, b.y0 + 14, w, h);
    g.fillStyle = "#2a1c18";
    for (let x = b.x0 + 40; x < b.x1 - 20; x += 110) {
      g.fillRect(x - 9, b.y0 - 8, 18, 12);
      g.fillRect(x - 9, b.y1 - 4, 18, 12);
    }
    // Planks across the walking direction.
    const pw = 22;
    let i = 0;
    for (let x = b.x0; x < b.x1; x += pw, i++) {
      const k = hash(x, b.y0, 4);
      const l = 50 + k * 18;
      g.fillStyle = `rgb(${Math.round(l + 14)},${Math.round(l - 6)},${Math.round(l - 14)})`;
      const sag = k < 0.15 ? 3 : 0;
      g.fillRect(x + 1, b.y0 + 4 + sag, pw - 2, h - 8 - sag);
      g.fillStyle = "rgba(255,220,180,0.07)";
      g.fillRect(x + 1, b.y0 + 4 + sag, pw - 2, 3);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(x + 3, b.y0 + 20 + ((i * 37) % 30), 2, 2);
      g.fillRect(x + 3, b.y1 - 24 - ((i * 23) % 30), 2, 2);
    }
    g.strokeStyle = "rgba(255,170,90,0.18)";
    g.lineWidth = 2;
    g.strokeRect(b.x0 + 1, b.y0 + 3, w - 2, h - 6);
  }
}

/** Soft darkening around walls and rocks so they sit on the ground. */
function occlusion(g: CanvasRenderingContext2D, map: MapDef, area: Bounds) {
  g.lineJoin = "round";
  map.grid.query(area.x0 - 60, area.y0 - 60, area.x1 + 60, area.y1 + 60, (i) => {
    const s = map.solids[i];
    if (!s || (s.kind !== "wall" && s.kind !== "rock")) return;
    if (s.x1 - s.x0 > map.half || s.y1 - s.y0 > map.half) return;
    if (s.kind === "rock") {
      const w = s.x1 - s.x0;
      const h = s.y1 - s.y0;
      for (const [k, a] of [[0.68, 0.14], [0.58, 0.2]] as const) {
        g.fillStyle = `rgba(0,0,8,${a})`;
        g.beginPath();
        g.ellipse(s.x0 + w / 2 + 6, s.y0 + h / 2 + 10, w * k, h * k, 0, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    for (const [wd, a] of [[34, 0.12], [18, 0.18]] as const) {
      g.strokeStyle = `rgba(0,0,8,${a})`;
      g.lineWidth = wd;
      g.strokeRect(s.x0 + 4, s.y0 + 6, s.x1 - s.x0, s.y1 - s.y0);
    }
  });
}

function ruinsRubble(g: CanvasRenderingContext2D, map: MapDef, area: Bounds) {
  for (const d of map.decor) {
    if (d.kind !== "tile" || !intersects(d, area, 100)) continue;
    const r = new Prng(hash(d.x0, d.y1, 33) * 1e9);
    for (let i = 0; i < 46; i++) {
      const side = Math.floor(r.next() * 4);
      const t = r.next();
      const off = r.range(-70, 50);
      const x = side < 2 ? d.x0 + t * (d.x1 - d.x0) : side === 2 ? d.x0 - off : d.x1 + off;
      const y = side < 2 ? (side === 0 ? d.y0 - off : d.y1 + off) : d.y0 + t * (d.y1 - d.y0);
      stone(g, x, y, r.range(5, 16), r);
    }
  }
}

function stone(g: CanvasRenderingContext2D, x: number, y: number, s: number, r: Prng) {
  const n = 5 + Math.floor(r.next() * 3);
  const a0 = r.next() * Math.PI;
  g.fillStyle = "rgba(0,0,10,0.4)";
  g.beginPath();
  g.ellipse(x + s * 0.3, y + s * 0.4, s, s * 0.7, 0, 0, Math.PI * 2);
  g.fill();
  const l = Math.round(r.range(44, 66));
  g.fillStyle = `rgb(${l},${l + 6},${l + 26})`;
  g.beginPath();
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2;
    const rr = s * r.range(0.65, 1);
    if (k) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8);
    else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8);
  }
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.beginPath();
  g.ellipse(x - s * 0.25, y - s * 0.25, s * 0.45, s * 0.3, -0.5, 0, Math.PI * 2);
  g.fill();
}

/** Wilds scatter: pebbles, glowing flowers and fern sprigs, never in water or on decor. */
function wildsScatter(g: CanvasRenderingContext2D, map: MapDef, area: Bounds) {
  const r = new Prng(hash(area.x0, area.y0, map.seed) * 1e9);
  const n = Math.round(((area.x1 - area.x0) * (area.y1 - area.y0)) / 9000);
  for (let i = 0; i < n; i++) {
    const x = r.range(area.x0 + 20, area.x1 - 20);
    const y = r.range(area.y0 + 20, area.y1 - 20);
    const k = r.next();
    if (inWater(map, x, y)) continue;
    if (k < 0.35) stone(g, x, y, r.range(3, 7), r);
    else if (k < 0.47) {
      const col = r.next() < 0.5 ? "255,110,220" : "110,240,255";
      for (let j = 0; j < 4; j++) {
        const fx = x + r.range(-10, 10);
        const fy = y + r.range(-10, 10);
        g.fillStyle = `rgba(${col},0.18)`;
        g.beginPath();
        g.arc(fx, fy, 4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `rgba(${col},0.75)`;
        g.fillRect(fx - 1, fy - 1, 2, 2);
      }
    } else {
      g.strokeStyle = `rgba(70,${Math.round(r.range(150, 210))},140,0.3)`;
      g.lineWidth = 1.6;
      g.lineCap = "round";
      g.beginPath();
      const a0 = r.next() * Math.PI * 2;
      for (let j = 0; j < 5; j++) {
        const a = a0 + j * 1.26;
        const l = r.range(7, 13);
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a + 0.3) * l * 0.6, y + Math.sin(a + 0.3) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l);
      }
      g.stroke();
    }
  }
}

function lightBases(g: CanvasRenderingContext2D, map: MapDef, area: Bounds) {
  for (const l of map.lights) {
    if (l.x < area.x0 - 30 || l.x > area.x1 + 30 || l.y < area.y0 - 30 || l.y > area.y1 + 30) continue;
    g.fillStyle = "rgba(0,0,8,0.5)";
    g.beginPath();
    g.ellipse(l.x + 4, l.y + 5, 11, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2a2e5c";
    g.beginPath();
    g.arc(l.x, l.y, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#4a508a";
    g.beginPath();
    g.arc(l.x - 1.5, l.y - 1.5, 4, 0, Math.PI * 2);
    g.fill();
  }
}

/** Large soft tone patches on a world grid (identical in every chunk, so no seams). */
function macroPatches(g: CanvasRenderingContext2D, map: MapDef, area: Bounds) {
  const cell = 700;
  for (let gy = Math.floor((area.y0 - cell) / cell); gy <= Math.ceil((area.y1 + cell) / cell); gy++) {
    for (let gx = Math.floor((area.x0 - cell) / cell); gx <= Math.ceil((area.x1 + cell) / cell); gx++) {
      for (let k = 0; k < 2; k++) {
        const x = (gx + hash(gx, gy, k * 2 + map.seed)) * cell;
        const y = (gy + hash(gy, gx, k * 2 + 1 + map.seed)) * cell;
        const r = 220 + hash(gx, gy, 50 + k) * 300;
        if (x + r < area.x0 || x - r > area.x1 || y + r < area.y0 || y - r > area.y1) continue;
        const light = hash(gx + k, gy, 9) < 0.55;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, light ? "rgba(40,120,95,0.13)" : "rgba(0,8,12,0.2)");
        grd.addColorStop(1, light ? "rgba(40,120,95,0)" : "rgba(0,8,12,0)");
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }
}

/** Paints all static ground inside `area` (transform = world units, already clipped). */
export function paintGround(g: CanvasRenderingContext2D, map: MapDef, data: GroundData, area: Bounds, detail: boolean) {
  g.fillStyle = texture(map.theme === "wilds" ? "wildsGround" : map.theme === "city" ? "asphalt" : "lot");
  g.fillRect(area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
  if (map.theme === "wilds") macroPatches(g, map, area);
  for (const k of ORDER) for (const d of map.decor) if (d.kind === k && intersects(d, area, 60)) decor(g, map, d, detail);
  if (detail && map.theme === "wilds") wildsScatter(g, map, area);
  banksAndWater(g, map, data, area, detail);
  bridges(g, map, area);
  occlusion(g, map, area);
  doors(g, map, area);
  if (detail) ruinsRubble(g, map, area);
  lightBases(g, map, area);
}
