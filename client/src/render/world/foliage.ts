// Bushes: layered foliage sprites (a dark outlined base of leaf clusters and a lighter crown),
// shared by size bucket and style, rotated per bush for variety. The crown sways gently on
// its own phase; your own bush turns see-through so you can still see yourself.

import { WORLD_ART, type Circle, type MapDef } from "@prism/shared";
import { canvas, hash, Prng } from "./rand";

const RES = 1.25;
const sprites = new Map<string, { base: HTMLCanvasElement; crown: HTMLCanvasElement; size: number }>();

interface Palette {
  outline: string;
  dark: string;
  mid: string;
  light: string;
  top: string;
  rim: string;
  bloom: string;
}

const PALETTES: Record<"city" | "wilds", Palette> = {
  wilds: { outline: "#041a17", dark: "#0b3a33", mid: "#11574a", light: "#1c7c63", top: "#2ba47f", rim: "rgba(93,255,190,0.4)", bloom: "#7cf6ff" },
  city: { outline: "#05141f", dark: "#0b3440", mid: "#0f5258", light: "#1a7470", top: "#27a08e", rim: "rgba(124,246,255,0.38)", bloom: "#ff7bd8" },
};

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, light: string, dark: string) {
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function build(R: number, style: number, theme: "city" | "wilds") {
  const p = PALETTES[theme];
  const size = Math.ceil(R * 2 + 16);
  const c = size / 2;
  const r = new Prng(R * 131 + style * 7 + (theme === "city" ? 999 : 0));
  const clusters: [number, number, number][] = [];
  const n = 8 + style;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r.range(-0.2, 0.2);
    const d = R * r.range(0.5, 0.62);
    clusters.push([c + Math.cos(a) * d, c + Math.sin(a) * d, R * r.range(0.36, 0.46)]);
  }
  for (let k = 0; k < 4; k++) clusters.push([c + r.range(-R, R) * 0.3, c + r.range(-R, R) * 0.3, R * r.range(0.4, 0.5)]);
  const [base, g] = canvas(size * RES, size * RES);
  g.scale(RES, RES);
  // Outline pass, rim light, then the shaded clusters.
  g.fillStyle = p.outline;
  for (const [x, y, rr] of clusters) {
    g.beginPath();
    g.arc(x, y, rr + 2.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = p.rim;
  for (const [x, y, rr] of clusters) {
    g.beginPath();
    g.arc(x - 1.5, y - 1.5, rr + 1, 0, Math.PI * 2);
    g.fill();
  }
  for (const [x, y, rr] of clusters) blob(g, x, y, rr, p.mid, p.dark);
  // Leaf flecks.
  for (let k = 0; k < R * 0.9; k++) {
    const a = r.next() * Math.PI * 2;
    const d = r.next() * R * 0.85;
    g.fillStyle = r.next() < 0.5 ? p.light : p.dark;
    g.beginPath();
    g.ellipse(c + Math.cos(a) * d, c + Math.sin(a) * d, 4, 2, a, 0, Math.PI * 2);
    g.fill();
  }
  const [crown, cg] = canvas(size * RES, size * RES);
  cg.scale(RES, RES);
  const m = 3 + (style % 2);
  for (let k = 0; k < m; k++) {
    const a = (k / m) * Math.PI * 2 + r.next();
    const d = R * r.range(0.12, 0.3);
    const x = c - R * 0.12 + Math.cos(a) * d;
    const y = c - R * 0.16 + Math.sin(a) * d;
    const rr = R * r.range(0.26, 0.34);
    cg.fillStyle = p.outline;
    cg.globalAlpha = 0.5;
    cg.beginPath();
    cg.arc(x + 2, y + 3, rr + 1, 0, Math.PI * 2);
    cg.fill();
    cg.globalAlpha = 1;
    blob(cg, x, y, rr, p.top, p.light);
  }
  for (let k = 0; k < R * 0.4; k++) {
    const a = r.next() * Math.PI * 2;
    const d = r.next() * R * 0.4;
    cg.fillStyle = "rgba(200,255,230,0.25)";
    cg.beginPath();
    cg.ellipse(c - R * 0.15 + Math.cos(a) * d, c - R * 0.2 + Math.sin(a) * d, 3, 1.5, a, 0, Math.PI * 2);
    cg.fill();
  }
  // A few glowing blossoms.
  for (let k = 0; k < 2 + style; k++) {
    const a = r.next() * Math.PI * 2;
    const d = R * r.range(0.3, 0.7);
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    cg.fillStyle = p.bloom;
    cg.globalAlpha = 0.25;
    cg.beginPath();
    cg.arc(x, y, 6, 0, Math.PI * 2);
    cg.fill();
    cg.globalAlpha = 1;
    cg.beginPath();
    cg.arc(x, y, 2.2, 0, Math.PI * 2);
    cg.fill();
  }
  return { base, crown, size };
}

function spriteFor(b: Circle, theme: "city" | "wilds") {
  const R = Math.ceil(b.r / 8) * 8;
  const style = Math.floor(hash(b.x, b.y, 2) * 3);
  const key = `${theme}|${R}|${style}`;
  let s = sprites.get(key);
  if (!s) {
    s = build(R, style, theme);
    sprites.set(key, s);
  }
  return s;
}

export function drawBushes(ctx: CanvasRenderingContext2D, map: MapDef, view: { x0: number; y0: number; x1: number; y1: number }, time: number, me: { x: number; y: number } | null) {
  const theme = map.theme === "city" ? "city" : "wilds";
  const cfg = WORLD_ART.bush;
  const list: Circle[] = [];
  map.bushGrid.query(view.x0 - 120, view.y0 - 120, view.x1 + 120, view.y1 + 120, (i) => {
    const b = map.bushes[i];
    if (b && b.x + b.r > view.x0 && b.x - b.r < view.x1 && b.y + b.r > view.y0 && b.y - b.r < view.y1) list.push(b);
  });
  // Soft ground shadows first, so neighbouring bushes don't shade each other's leaves.
  ctx.fillStyle = "rgba(0,0,10,0.32)";
  for (const b of list) {
    ctx.beginPath();
    ctx.ellipse(b.x + 6, b.y + 10, b.r * 0.95, b.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of list) {
    const s = spriteFor(b, theme);
    const inside = !!me && (me.x - b.x) ** 2 + (me.y - b.y) ** 2 < b.r * b.r;
    const scale = b.r / (Math.ceil(b.r / 8) * 8);
    const d = s.size * scale;
    const rot = hash(b.x, b.y) * Math.PI * 2;
    const ph = hash(b.y, b.x) * 6.28;
    const sway = Math.sin(time * cfg.swaySpeed + ph) * cfg.swayAmp;
    const sway2 = Math.cos(time * cfg.swaySpeed * 0.8 + ph) * cfg.swayAmp * 0.6;
    ctx.save();
    ctx.globalAlpha = inside ? cfg.insideAlpha : 1;
    ctx.translate(b.x, b.y);
    ctx.save();
    ctx.rotate(rot + sway * 0.004);
    ctx.drawImage(s.base, -d / 2, -d / 2, d, d);
    ctx.restore();
    ctx.drawImage(s.crown, -d / 2 + sway, -d / 2 + sway2, d, d);
    ctx.restore();
  }
}
