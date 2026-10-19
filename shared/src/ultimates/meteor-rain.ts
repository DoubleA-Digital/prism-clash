// METEOR RAIN: a wide area ahead of you is marked, then 12 meteors crash into it over 3s.
// Every meteor shows its own filling warning circle first, so anyone paying attention can
// weave between impacts.

import { ULTIMATES } from "../config";
import { defineUlt } from "../sim/hooks";
import type { Effect } from "../sim/types";
import type { World } from "../sim/world";
import { circle, glow, poly } from "../powers/icon";
import { ultFrame } from "./ult-icon";

const C = ULTIMATES.meteorRain;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** meteorWarn n values: the whole marked area, and one incoming meteor. */
export const METEOR_AREA = 0;
export const METEOR_ONE = 1;

/** Seconds after the cast when meteor i's warning appears (it lands `warn` later). */
export const meteorSpawnAt = (i: number) => (C.count <= 1 ? 0 : (i * (C.duration - C.warn)) / (C.count - 1));

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** A stride coprime with the count, so impacts hop around the area instead of spiralling. */
const STRIDE = [5, 7, 11, 13, 3, 1].find((s) => gcd(s, C.count) === 1) ?? 1;

function meteorPoint(w: World, area: Effect, i: number): { x: number; y: number } {
  // Every `trackEvery`-th meteor hunts an enemy standing in the area (leading their
  // movement by half the warning time), so the rain is a real threat, not just scenery.
  if (i % C.trackEvery === 1) {
    const inArea = [...w.players.values()].filter((o) => o.alive && o.id !== area.owner && Math.hypot(o.x - area.x, o.y - area.y) < area.r + o.r);
    const t = inArea.length ? inArea[w.rng.int(inArea.length)] : undefined;
    if (t) {
      const lead = C.warn * 0.5;
      const x = t.x + (t.vx + t.px) * lead + w.rng.range(-C.trackJitter, C.trackJitter);
      const y = t.y + (t.vy + t.py) * lead + w.rng.range(-C.trackJitter, C.trackJitter);
      if (w.insideArena(x, y, 20)) return { x, y };
    }
  }
  const k = (i * STRIDE) % C.count;
  const rr = area.r * Math.sqrt((k + 0.5) / C.count);
  const a = area.angle + k * GOLDEN;
  const j = (area.r / Math.sqrt(C.count)) * C.jitter;
  let x = area.x + Math.cos(a) * rr + w.rng.range(-j, j);
  let y = area.y + Math.sin(a) * rr + w.rng.range(-j, j);
  // Keep impacts inside the walls: slide toward the area center until they fit.
  for (let s = 0; s < 6 && !w.insideArena(x, y, 20); s++) {
    x = (x + area.x) / 2;
    y = (y + area.y) / 2;
  }
  return { x, y };
}

function rainCenter(w: World, x: number, y: number, aim: number): { x: number; y: number } {
  for (let s = 0; s <= 8; s++) {
    const d = C.centerDist * (1 - s / 8);
    const cx = x + Math.cos(aim) * d;
    const cy = y + Math.sin(aim) * d;
    if (w.insideArena(cx, cy, 60)) return { x: cx, y: cy };
  }
  return { x, y };
}

export const meteorRain = defineUlt({
  id: "meteorRain",
  name: "Meteor Rain",
  description: "Mark a wide area ahead of you: 12 meteors crash into it over 3s, each blasting for 22 after a warning circle.",
  color: "#FF7A2B",
  drawIcon(ctx, size) {
    ultFrame(ctx, size, "#5a1d06");
    // Three falling meteors with flaming tails, the big one in front.
    const rocks: [number, number, number][] = [[-0.16, -0.14, 0.05], [0.14, -0.2, 0.04], [0.02, 0.06, 0.085]];
    for (const [x, y, r] of rocks) {
      const px = x * size;
      const py = y * size;
      const tail = size * (r * 3.2);
      const grad = ctx.createLinearGradient(px, py, px - tail, py - tail);
      grad.addColorStop(0, "rgba(255,200,80,0.95)");
      grad.addColorStop(1, "rgba(255,60,20,0)");
      ctx.shadowBlur = 0;
      ctx.fillStyle = grad;
      const s = size * r;
      poly(ctx, [[px + s * 0.7, py - s * 0.7], [px - tail, py - tail], [px - s * 0.7, py + s * 0.7]], true, true);
      glow(ctx, "#FF7A2B", size * 0.08, size * 0.02);
      circle(ctx, px, py, s, true);
      ctx.fillStyle = "#FFF1C2";
      ctx.shadowBlur = 0;
      circle(ctx, px + s * 0.2, py + s * 0.2, s * 0.45, true);
    }
    // Impact ring under the big one.
    glow(ctx, "#FFD34D", size * 0.06, size * 0.025);
    ctx.save();
    ctx.scale(1, 0.4);
    circle(ctx, size * 0.04, size * 0.42, size * 0.2);
    ctx.restore();
  },
  onCast(w, p) {
    const c = rainCenter(w, p.x, p.y, p.aim);
    w.spawnEffect({ kind: "meteorWarn", owner: p.id, source: "meteorRain", x: c.x, y: c.y, r: C.radius, life: C.duration, n: METEOR_AREA, angle: w.rng.range(0, Math.PI * 2), v: 0 });
    return true;
  },
  effects: {
    meteorWarn: {
      update(w, e) {
        if (e.n !== METEOR_AREA) return;
        // v counts meteors launched so far.
        while (e.v < C.count && e.age >= meteorSpawnAt(e.v)) {
          const pt = meteorPoint(w, e, e.v);
          w.spawnEffect({ kind: "meteorWarn", owner: e.owner, source: "meteorRain", x: pt.x, y: pt.y, r: C.impactRadius, life: C.warn, n: METEOR_ONE, link: e.id });
          e.v++;
        }
      },
      onExpire(w, e) {
        if (e.n !== METEOR_ONE) return;
        w.explode(e.x, e.y, C.impactRadius, C.damage, e.owner, "meteorRain", { knock: C.knock });
      },
    },
  },
  bot: { minTargets: 2 },
});
