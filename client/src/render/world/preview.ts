// Dev-only terrain preview (client/terrain-preview.html; not part of the production build).
// Renders a real generated map through the game's Floor/Terrain/shadow layers at a chosen
// spot, with a few chibi heroes standing around for contrast checks.
//   ?map=neonCity|crystalWilds &seed=<n> &spot=street|interior|plaza|lot|park|river|ruins|crystals|bushes|wide
//   &x=&y= (override) &scale=<px per unit, default 0.86> &t=<seconds> &bench=1 (renders 120 frames, prints ms)

import { buildMap, canSeePoint, HERO_IDS, isMapId, PLAYER, roofAt, type MapDef, type MapId, type Rect } from "@prism/shared";
import { drawHero, idleAnim } from "../chibi";
import { Floor } from "../floor";
import { drawShadows } from "../shadows";
import { Terrain } from "../terrain";

const q = new URLSearchParams(location.search);
const mapParam = q.get("map") ?? "neonCity";
const MAP: MapId = isMapId(mapParam) ? mapParam : "neonCity";
const map = buildMap(MAP, Number(q.get("seed") ?? "1234"));
const SCALE = Number(q.get("scale") ?? "0.86");
const T = Number(q.get("t") ?? "1.7");
const COLORS = ["#00F0FF", "#FF2E88", "#9DFF3A", "#FFC83D", "#A970FF"];

const mid = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

function spot(m: MapDef, name: string): { x: number; y: number } {
  const decor = (k: string) => m.decor.find((d) => d.kind === k && Math.abs(d.x0) < m.half - 900 && Math.abs(d.y0) < m.half - 900);
  switch (name) {
    case "interior": {
      const r = [...m.roofs].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0];
      return r ? mid(r) : { x: 0, y: 0 };
    }
    case "street": {
      const c = decor("crosswalk");
      return c ? { x: c.x0 + 60, y: c.y0 + 60 } : { x: 0, y: 0 };
    }
    case "plaza":
      return { x: 0, y: 260 };
    case "lot": {
      const d = decor("lot");
      return d ? mid(d) : { x: 0, y: 0 };
    }
    case "park": {
      const d = decor("grass");
      return d ? mid(d) : { x: 0, y: 0 };
    }
    case "river": {
      const b = m.bridges[1] ?? m.bridges[0];
      return b ? mid(b) : { x: 0, y: 0 };
    }
    case "ruins": {
      const d = decor("tile");
      return d ? { x: d.x0 + 60, y: d.y1 + 120 } : { x: 0, y: 0 };
    }
    case "crystals": {
      const s = m.solids.find((o) => o.kind === "crystal");
      return s ? { x: s.x0, y: s.y1 + 120 } : { x: 0, y: 0 };
    }
    case "bushes": {
      const b = m.bushes[Math.floor(m.bushes.length / 2)];
      return b ? { x: b.x, y: b.y + 140 } : { x: 0, y: 0 };
    }
    default:
      return { x: 0, y: 0 };
  }
}

const at = spot(map, q.get("spot") ?? "street");
const cx = Number(q.get("x") ?? at.x);
const cy = Number(q.get("y") ?? at.y);

const canvas = document.createElement("canvas");
const dpr = 1;
canvas.width = innerWidth * dpr;
canvas.height = innerHeight * dpr;
canvas.style.width = `${innerWidth}px`;
canvas.style.height = `${innerHeight}px`;
document.body.append(canvas);
document.getElementById("nav")?.remove();
const ctx = canvas.getContext("2d", { alpha: false });
if (!ctx) throw new Error("no canvas");
const floor = new Floor(map);
const terrain = new Terrain(map);

// Heroes stand near the viewer (only where the floor is free).
const heroes: { x: number; y: number; c: string; aim: number }[] = [];
for (let k = 0; k < 5; k++) {
  const a = k * 1.3 + 0.4;
  const r = 90 + k * 55;
  const x = cx + Math.cos(a) * r;
  const y = cy + Math.sin(a) * r;
  if (!map.solids.some((s) => x > s.x0 - 22 && x < s.x1 + 22 && y > s.y0 - 22 && y < s.y1 + 22)) heroes.push({ x, y, c: COLORS[k] ?? "#fff", aim: a + 2 });
}

function render(t: number, dt: number) {
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#05040d";
  ctx.fillRect(0, 0, w, h);
  const sc = SCALE * dpr;
  ctx.setTransform(sc, 0, 0, sc, w / 2 - cx * sc, h / 2 - cy * sc);
  const hw = w / 2 / sc + 160;
  const hh = h / 2 / sc + 160;
  const b = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  floor.draw(ctx, t, b);
  terrain.drawSolids(ctx, b, t, false);
  heroes.forEach((p, i) => {
    if (!canSeePoint(map, cx, cy, p.x, p.y, PLAYER.radius * 0.8)) return;
    drawHero(ctx, { heroId: HERO_IDS[i % HERO_IDS.length] ?? "blaze", color: p.c, x: p.x, y: p.y, aim: p.aim, weapon: { id: "rifle", rarity: i % 4 }, anim: idleAnim(), scale: 1, time: t, seed: i });
  });
  drawShadows(ctx, map, cx, cy, b);
  terrain.drawSolids(ctx, b, t, true);
  terrain.drawBushes(ctx, b, t, { x: cx, y: cy });
  terrain.drawRoofs(ctx, b, roofAt(map, cx, cy), dt, t);
}

if (q.get("bench") === "1") {
  // Warm up (chunk builds), then time steady frames.
  for (let i = 0; i < 40; i++) render(T + i / 60, 1 / 60);
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) render(T + i / 60, 1 / 60);
  const ms = (performance.now() - t0) / 120;
  const t1 = performance.now();
  const f2 = new Floor(map);
  void f2;
  const built = performance.now() - t1;
  (window as unknown as { __bench: unknown }).__bench = { msPerFrame: Number(ms.toFixed(2)), floorInitMs: Number(built.toFixed(1)), chunks: floor.chunksBuilt };
} else {
  // Settle the roof fade and chunk builds, then hold the frame at time T.
  for (let i = 0; i < 90; i++) render(T, 1 / 30);
  (window as unknown as { __ready: boolean }).__ready = true;
}
