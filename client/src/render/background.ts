// Deep-space backdrop: a slow color wash plus three parallax starfield layers,
// each pre-rendered to a repeating tile so it costs a few drawImage calls per frame.

import { PAL } from "./palette";

interface Layer {
  tile: HTMLCanvasElement;
  parallax: number;
  drift: number;
}

const TILE = 1024;

function makeTile(count: number, minR: number, maxR: number, seed: number, tint: string[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = TILE;
  const g = c.getContext("2d");
  if (!g) return c;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    const x = rnd() * TILE;
    const y = rnd() * TILE;
    const r = minR + rnd() * (maxR - minR);
    const col = tint[Math.floor(rnd() * tint.length)] ?? "#ffffff";
    const a = 0.35 + rnd() * 0.65;
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 3);
    grad.addColorStop(0, col);
    grad.addColorStop(0.3, col);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = a;
    g.fillStyle = grad;
    g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    // Wrap so the tile repeats seamlessly.
    for (const [dx, dy] of [[TILE, 0], [-TILE, 0], [0, TILE], [0, -TILE]] as const) {
      if (x + dx > -r * 3 && x + dx < TILE + r * 3 && y + dy > -r * 3 && y + dy < TILE + r * 3) g.fillRect(x + dx - r * 3, y + dy - r * 3, r * 6, r * 6);
    }
  }
  return c;
}

export class Background {
  private layers: Layer[];
  private wash: HTMLCanvasElement;

  constructor() {
    this.layers = [
      { tile: makeTile(420, 0.4, 1.0, 11, ["#ffffff", "#a7c4ff", "#ffd9f5"]), parallax: 0.06, drift: 4 },
      { tile: makeTile(160, 0.8, 1.6, 23, ["#ffffff", "#8ff6ff", "#c9a8ff"]), parallax: 0.14, drift: 9 },
      { tile: makeTile(50, 1.2, 2.4, 37, ["#ffffff", "#7cf6ff", "#ff9ee6"]), parallax: 0.28, drift: 16 },
    ];
    this.wash = document.createElement("canvas");
    this.wash.width = this.wash.height = 512;
    const g = this.wash.getContext("2d");
    if (g) {
      const blob = (x: number, y: number, r: number, col: string) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, col);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 512);
      };
      g.fillStyle = PAL.void;
      g.fillRect(0, 0, 512, 512);
      blob(120, 140, 260, "rgba(80,30,160,0.45)");
      blob(400, 360, 280, "rgba(0,110,170,0.35)");
      blob(380, 80, 200, "rgba(170,20,110,0.25)");
    }
  }

  /** Draws in screen space. camX/camY are the camera's world position. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, camX: number, camY: number, time: number, intensity: number) {
    ctx.drawImage(this.wash, 0, 0, w, h);
    for (const l of this.layers) {
      const ox = -(((camX * l.parallax + time * l.drift) % TILE) + TILE) % TILE;
      const oy = -(((camY * l.parallax + time * l.drift * 0.4) % TILE) + TILE) % TILE;
      ctx.globalAlpha = 0.75 + intensity * 0.25;
      for (let x = ox; x < w; x += TILE) for (let y = oy; y < h; y += TILE) ctx.drawImage(l.tile, x, y);
    }
    ctx.globalAlpha = 1;
  }
}
