// Procedural surface textures for the terrain, generated once into small tiles and used as
// repeating canvas patterns in world space (so chunks line up seamlessly). Everything is a
// dark, low-contrast neon-night material so the heroes stay the brightest thing on screen.

import { canvas, Prng } from "./rand";

export type TextureId =
  | "asphalt" | "lot" | "sidewalk" | "plaza" | "parkGrass" | "wildsGround" | "moss" | "sand"
  | "tile" | "wood" | "carpet" | "grate" | "ruinTile" | "concreteWall" | "stoneWall" | "gravel" | "metalRoof" | "tarRoof";

type RGB = readonly [number, number, number];
type Painter = (g: CanvasRenderingContext2D, s: number, r: Prng) => void;

const cache = new Map<TextureId, CanvasPattern>();

/** Per-pixel value noise over a base color (cheap grain). */
function grain(g: CanvasRenderingContext2D, w: number, h: number, base: RGB, amp: number, r: Prng) {
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const n = (r.next() - 0.5) * 2 * amp;
    d[i * 4] = base[0] + n;
    d[i * 4 + 1] = base[1] + n;
    d[i * 4 + 2] = base[2] + n * 1.2;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** Soft low-frequency blotches (wraps around the tile edges so the pattern stays seamless). */
function blotches(g: CanvasRenderingContext2D, s: number, r: Prng, n: number, color: string, min: number, max: number) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = r.next() * s;
    const y = r.next() * s;
    const rad = r.range(min, max);
    const sq = r.range(0.35, 0.8);
    const rot = r.next() * Math.PI;
    for (const ox of [-s, 0, s]) {
      for (const oy of [-s, 0, s]) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, rad, rad * sq, rot, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function tufts(g: CanvasRenderingContext2D, s: number, r: Prng, n: number, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = r.next() * s;
    const y = r.next() * s;
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k - 1) * 0.5 + r.range(-0.2, 0.2);
      const l = r.range(3, 7);
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
  }
  g.stroke();
}

function joints(g: CanvasRenderingContext2D, s: number, step: number, dark: string, light: string) {
  g.fillStyle = dark;
  for (let p = 0; p < s; p += step) {
    g.fillRect(p, 0, 2, s);
    g.fillRect(0, p, s, 2);
  }
  g.fillStyle = light;
  for (let p = 0; p < s; p += step) {
    g.fillRect(p + 2, 0, 1, s);
    g.fillRect(0, p + 2, s, 1);
  }
}

const DEFS: Record<TextureId, { size: number; paint: Painter }> = {
  asphalt: {
    size: 256,
    paint: (g, s, r) => {
      grain(g, s, s, [13, 15, 36], 4, r);
      blotches(g, s, r, 22, "rgba(30,34,80,0.07)", 8, 34);
      g.fillStyle = "rgba(160,170,255,0.06)";
      for (let i = 0; i < 160; i++) g.fillRect(r.next() * s, r.next() * s, 1.5, 1.5);
      g.strokeStyle = "rgba(0,0,8,0.45)";
      g.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        let x = r.next() * s;
        let y = r.next() * s;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += r.range(-14, 14);
          y += r.range(-14, 14);
          g.lineTo(x, y);
        }
        g.stroke();
      }
    },
  },
  lot: {
    size: 256,
    paint: (g, s, r) => {
      grain(g, s, s, [16, 19, 46], 4, r);
      blotches(g, s, r, 18, "rgba(8,8,20,0.1)", 6, 24);
    },
  },
  sidewalk: {
    size: 160,
    paint: (g, s, r) => {
      grain(g, s, s, [22, 27, 60], 3, r);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = `rgba(${r.next() < 0.5 ? "255,255,255" : "0,0,10"},0.025)`;
        g.fillRect((i % 2) * 80, Math.floor(i / 2) * 80, 80, 80);
      }
      joints(g, s, 80, "rgba(5,6,20,0.7)", "rgba(124,246,255,0.05)");
    },
  },
  plaza: {
    size: 120,
    paint: (g, s, r) => {
      grain(g, s, s, [24, 28, 70], 3, r);
      g.fillStyle = "rgba(169,112,255,0.06)";
      for (let y = 0; y < s; y += 30) for (let x = (y / 30) % 2 ? 0 : 30; x < s; x += 60) g.fillRect(x, y, 30, 30);
      joints(g, s, 30, "rgba(6,6,24,0.55)", "rgba(169,112,255,0.06)");
    },
  },
  parkGrass: {
    size: 256,
    paint: (g, s, r) => {
      grain(g, s, s, [12, 40, 44], 4, r);
      blotches(g, s, r, 26, "rgba(30,90,80,0.07)", 8, 36);
      tufts(g, s, r, 70, "rgba(90,230,180,0.16)");
    },
  },
  wildsGround: {
    size: 320,
    paint: (g, s, r) => {
      grain(g, s, s, [11, 31, 34], 4, r);
      blotches(g, s, r, 34, "rgba(20,64,58,0.08)", 10, 50);
      blotches(g, s, r, 16, "rgba(4,14,18,0.1)", 8, 34);
      tufts(g, s, r, 90, "rgba(80,220,170,0.13)");
      g.fillStyle = "rgba(255,120,220,0.35)";
      for (let i = 0; i < 6; i++) g.fillRect(r.next() * s, r.next() * s, 2, 2);
      g.fillStyle = "rgba(120,240,255,0.3)";
      for (let i = 0; i < 6; i++) g.fillRect(r.next() * s, r.next() * s, 2, 2);
    },
  },
  moss: {
    size: 192,
    paint: (g, s, r) => {
      grain(g, s, s, [13, 46, 40], 5, r);
      blotches(g, s, r, 30, "rgba(40,120,90,0.1)", 5, 18);
      tufts(g, s, r, 60, "rgba(110,255,190,0.16)");
    },
  },
  sand: {
    size: 192,
    paint: (g, s, r) => {
      grain(g, s, s, [36, 32, 52], 4, r);
      g.fillStyle = "rgba(255,230,200,0.06)";
      for (let i = 0; i < 120; i++) g.fillRect(r.next() * s, r.next() * s, 1.5, 1.5);
      g.strokeStyle = "rgba(0,0,0,0.12)";
      g.lineWidth = 1.5;
      for (let y = 12; y < s; y += 24) {
        g.beginPath();
        for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin((x / s) * Math.PI * 4 + y) * 3);
        g.stroke();
      }
    },
  },
  tile: {
    size: 80,
    paint: (g, s, r) => {
      grain(g, s, s, [30, 30, 74], 3, r);
      g.fillStyle = "rgba(255,255,255,0.035)";
      g.fillRect(0, 0, 40, 40);
      g.fillRect(40, 40, 40, 40);
      joints(g, s, 40, "rgba(8,8,26,0.6)", "rgba(255,255,255,0.04)");
    },
  },
  wood: {
    size: 192,
    paint: (g, s, r) => {
      grain(g, s, s, [44, 32, 58], 3, r);
      for (let row = 0; row < s / 24; row++) {
        const y = row * 24;
        g.fillStyle = `rgba(${r.next() < 0.5 ? "255,200,170" : "0,0,0"},${r.range(0.02, 0.06)})`;
        g.fillRect(0, y, s, 24);
        g.strokeStyle = "rgba(255,210,180,0.04)";
        g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < 3; k++) {
          const gy = y + 5 + k * 6 + r.range(-1, 1);
          g.moveTo(0, gy);
          g.bezierCurveTo(s * 0.3, gy + r.range(-2, 2), s * 0.6, gy + r.range(-2, 2), s, gy);
        }
        g.stroke();
        g.fillStyle = "rgba(6,4,14,0.7)";
        g.fillRect(0, y, s, 1.5);
        const off = (row % 2) * 96 + 40;
        g.fillRect(off % s, y, 1.5, 24);
      }
    },
  },
  carpet: {
    size: 96,
    paint: (g, s, r) => {
      grain(g, s, s, [40, 22, 64], 6, r);
      g.strokeStyle = "rgba(255,120,220,0.05)";
      g.lineWidth = 2;
      for (let k = -s; k < s * 2; k += 24) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + s, s);
        g.moveTo(k + s, 0);
        g.lineTo(k, s);
        g.stroke();
      }
    },
  },
  grate: {
    size: 64,
    paint: (g, s, r) => {
      grain(g, s, s, [22, 26, 52], 3, r);
      g.fillStyle = "rgba(0,0,10,0.45)";
      for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < s; x += 8) g.fillRect(x, y, 4, 2);
      joints(g, s, 64, "rgba(4,4,16,0.7)", "rgba(180,200,255,0.06)");
    },
  },
  ruinTile: {
    size: 120,
    paint: (g, s, r) => {
      grain(g, s, s, [29, 34, 54], 4, r);
      for (let y = 0; y < s; y += 40) {
        for (let x = 0; x < s; x += 40) {
          g.fillStyle = `rgba(${r.next() < 0.5 ? "255,255,255" : "0,0,0"},${r.range(0.02, 0.07)})`;
          g.fillRect(x, y, 40, 40);
        }
      }
      joints(g, s, 40, "rgba(14,38,34,0.85)", "rgba(43,255,200,0.04)");
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        let x = r.next() * s;
        let y = r.next() * s;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) g.lineTo((x += r.range(-10, 10)), (y += r.range(-10, 10)));
        g.stroke();
      }
    },
  },
  concreteWall: {
    size: 64,
    paint: (g, s, r) => {
      grain(g, s, s, [30, 32, 78], 4, r);
      g.fillStyle = "rgba(255,255,255,0.03)";
      for (let i = 0; i < 30; i++) g.fillRect(r.next() * s, r.next() * s, 2, 2);
    },
  },
  stoneWall: {
    size: 96,
    paint: (g, s, r) => {
      grain(g, s, s, [22, 26, 40], 3, r);
      for (let y = 0; y < s; y += 24) {
        const off = (y / 24) % 2 ? 0 : 16;
        for (let x = -32 + off; x < s; x += 32) {
          const l = r.range(46, 60);
          g.fillStyle = `rgb(${Math.round(l)},${Math.round(l + 6)},${Math.round(l + 24)})`;
          g.beginPath();
          g.roundRect(x + 1.5, y + 1.5, 29, 21, 4);
          g.fill();
          g.fillStyle = "rgba(255,255,255,0.06)";
          g.fillRect(x + 3, y + 3, 25, 2);
        }
      }
      blotches(g, s, r, 7, "rgba(40,140,100,0.28)", 3, 9);
    },
  },
  gravel: {
    size: 128,
    paint: (g, s, r) => {
      grain(g, s, s, [27, 27, 62], 7, r);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = r.next() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.25)";
        g.fillRect(r.next() * s, r.next() * s, 2, 2);
      }
    },
  },
  metalRoof: {
    size: 96,
    paint: (g, s, r) => {
      grain(g, s, s, [30, 34, 72], 3, r);
      for (let x = 0; x < s; x += 16) {
        g.fillStyle = "rgba(255,255,255,0.05)";
        g.fillRect(x, 0, 3, s);
        g.fillStyle = "rgba(0,0,10,0.35)";
        g.fillRect(x + 13, 0, 2, s);
      }
    },
  },
  tarRoof: {
    size: 128,
    paint: (g, s, r) => {
      grain(g, s, s, [30, 22, 56], 5, r);
      blotches(g, s, r, 8, "rgba(0,0,0,0.12)", 10, 30);
      joints(g, s, 64, "rgba(0,0,12,0.35)", "rgba(255,255,255,0.025)");
    },
  },
};

/** A repeating world-space pattern for the texture (created once, then cached). */
export function texture(id: TextureId): CanvasPattern | string {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = DEFS[id];
  const [c, g] = canvas(def.size, def.size);
  def.paint(g, def.size, new Prng(id.length * 7919 + def.size));
  const p = g.createPattern(c, "repeat");
  if (!p) return "#101030";
  cache.set(id, p);
  return p;
}
