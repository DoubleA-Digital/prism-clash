// Offscreen sprite cache. The static parts of a hero (head with hair and face, torso with outfit)
// are painted once per hero x facing bucket; the neon rim silhouette once per hero x color x
// bucket; hands and feet once per hero x color. Per frame a hero is then a handful of
// drawImage calls, which keeps 12 heroes plus effects cheap.

import { HEROES, type HeroDef, type HeroId } from "@prism/shared";
import { HAND_R, drawFoot, drawHand, paintBody } from "./body";
import { paintHead } from "./head";
import { view, type View } from "./paint";

export interface Sprite {
  c: HTMLCanvasElement;
  /** Local-unit rectangle to draw it into: drawImage(c, x, y, w, h). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Hero-local offsets of the head and body sprite centers. */
export const HEAD_Y = -10.5;
export const BODY_Y = 8;
/** Facing buckets over the right half (up .. down); the left half is mirrored. */
export const BUCKETS = 9;

let RES = 3;
const cache = new Map<string, Sprite>();
let built = 0;

/** Pixels per hero unit in the cache. Raise for very zoomed-in views; clears the cache. */
export function setChibiResolution(res: number) {
  RES = Math.max(1, Math.min(6, res));
  cache.clear();
}
export function clearChibiCache() {
  cache.clear();
}
export function chibiCacheStats() {
  let px = 0;
  for (const s of cache.values()) px += s.c.width * s.c.height;
  return { sprites: cache.size, built, megabytes: (px * 4) / 1048576 };
}

function make(x: number, y: number, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, res = RES): Sprite {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * res);
  c.height = Math.ceil(h * res);
  const g = c.getContext("2d");
  if (g) {
    g.scale(res, res);
    g.translate(-x, -y);
    paint(g);
  }
  built++;
  return { c, x, y, w, h };
}

function get(key: string, build: () => Sprite): Sprite {
  let s = cache.get(key);
  if (!s) cache.set(key, (s = build()));
  return s;
}

/** Bucket for an aim angle: index into the right-half views, and whether to mirror. */
export function facing(aim: number): { b: number; mirror: boolean } {
  const cx = Math.cos(aim);
  const sy = Math.sin(aim);
  const mirror = cx < -1e-6;
  const f = Math.atan2(sy, Math.abs(cx));
  const b = Math.max(0, Math.min(BUCKETS - 1, Math.round(((f + Math.PI / 2) / Math.PI) * (BUCKETS - 1))));
  return { b, mirror };
}

/** The view (yaw) for a bucket. Bucket 0 = facing up (back of the head), last = facing down. */
export function bucketView(b: number): View {
  const f = -Math.PI / 2 + (Math.PI * b) / (BUCKETS - 1);
  // Compress the front half so side aims still show a cute three-quarter face.
  const y0 = Math.PI / 2 - f;
  const FRONT = 0.62;
  const yaw = y0 <= Math.PI / 2 ? y0 * FRONT : (Math.PI / 2) * FRONT + (y0 - Math.PI / 2) * (2 - FRONT);
  return view(yaw);
}

const def = (id: HeroId): HeroDef => HEROES[id] ?? HEROES.blaze;

const HEAD_BOX = { x: -32, y: -40, w: 64, h: 66 };
const BODY_BOX = { x: -16, y: -12, w: 32, h: 25 };

export function headSprite(id: HeroId, b: number): Sprite {
  return get(`h|${id}|${b}|${RES}`, () => make(HEAD_BOX.x, HEAD_BOX.y, HEAD_BOX.w, HEAD_BOX.h, (g) => paintHead(g, def(id), bucketView(b))));
}

export function bodySprite(id: HeroId, b: number): Sprite {
  return get(`b|${id}|${b}|${RES}`, () => make(BODY_BOX.x, BODY_BOX.y, BODY_BOX.w, BODY_BOX.h, (g) => paintBody(g, def(id), bucketView(b))));
}

/** The rim is a soft glow edge, so it caches at a lower resolution (a third of the memory). */
const RIM_RES = 0.6;

/**
 * Neon rim: the union silhouette of body + head, dilated and filled with the player color,
 * with a soft outer halo. Drawn under the fills so only the outside edge shows.
 * Also used in white for the hit flash and in color for dash afterimages and the death ghost.
 */
export function rimSprite(id: HeroId, color: string, b: number): Sprite {
  return get(`r|${id}|${color}|${b}|${RES}`, () => {
    const pad = 5;
    const x = HEAD_BOX.x - pad;
    const y = HEAD_Y + HEAD_BOX.y - pad;
    const w = HEAD_BOX.w + pad * 2;
    const h = BODY_Y + BODY_BOX.y + BODY_BOX.h - y + pad;
    const head = headSprite(id, b);
    const body = bodySprite(id, b);
    const rr = RES * RIM_RES;
    const sil = make(x, y, w, h, (g) => {
      g.drawImage(body.c, body.x, BODY_Y + body.y, body.w, body.h);
      g.drawImage(head.c, head.x, HEAD_Y + head.y, head.w, head.h);
    }, rr);
    const dilate = (r: number): HTMLCanvasElement => {
      const d = make(x, y, w, h, (g) => {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          g.drawImage(sil.c, x + Math.cos(a) * r, y + Math.sin(a) * r, w, h);
        }
        g.globalCompositeOperation = "source-in";
        g.fillStyle = color;
        g.fillRect(x, y, w, h);
      }, rr);
      return d.c;
    };
    const soft = dilate(3.4);
    const hard = dilate(1.9);
    return make(x, y, w, h, (g) => {
      g.globalAlpha = 0.38;
      g.drawImage(soft, x, y, w, h);
      g.globalAlpha = 1;
      g.drawImage(hard, x, y, w, h);
    }, rr);
  });
}

export function handSprite(id: HeroId, color: string): Sprite {
  const r = HAND_R + 2;
  return get(`hand|${id}|${color}|${RES}`, () => make(-r, -r, r * 2, r * 2, (g) => drawHand(g, def(id), color, 0, 0)));
}

export function footSprite(id: HeroId, color: string, lifted: boolean): Sprite {
  return get(`foot|${id}|${color}|${lifted}|${RES}`, () => make(-7.5, -6, 15, 12, (g) => drawFoot(g, def(id), color, 0, 0, lifted ? 1.5 : 0)));
}

/** Draws a sprite centered on its local origin at (x, y). */
export function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number) {
  ctx.drawImage(s.c, x + s.x, y + s.y, s.w, s.h);
}

/** Pre-builds every bucket for the given heroes and colors (e.g. on the loading screen). */
export function warmChibiCache(ids: readonly HeroId[], colors: readonly string[]) {
  for (const id of ids) {
    for (let b = 0; b < BUCKETS; b++) {
      headSprite(id, b);
      bodySprite(id, b);
      for (const c of colors) rimSprite(id, c, b);
    }
    for (const c of colors) {
      handSprite(id, c);
      footSprite(id, c, false);
      footSprite(id, c, true);
    }
  }
}

