// The small chibi body: a cel-shaded torso in the hero's outfit (details turn with the view),
// plus the live-drawn parts that animate every frame: round hands and little feet.

import type { HeroDef } from "@prism/shared";
import { INK, LINE, cel, circle, ellipse, light, poly, rrect, shade, type View } from "./paint";

/** Torso outline in body-local units (center 0,0). Puffers are wider, coats longer. */
function torsoPath(def: HeroDef): Path2D {
  const w = def.outfit === "puffer" ? 12 : def.outfit === "tee" ? 11.3 : 10.6;
  const top = -7.5;
  const bot = def.outfit === "coat" ? 10 : 8.4;
  const sh = w - 4.4;
  const p = new Path2D();
  p.moveTo(-sh, top);
  p.lineTo(sh, top);
  p.quadraticCurveTo(w - 0.4, top, w, top + 5.2);
  p.lineTo(w + (def.outfit === "coat" ? 1.2 : 0.2), bot - 3.4);
  p.quadraticCurveTo(w + 0.2, bot, w - 3.6, bot);
  p.lineTo(-w + 3.6, bot);
  p.quadraticCurveTo(-w - 0.2, bot, -w - (def.outfit === "coat" ? 1.2 : 0.2), bot - 3.4);
  p.lineTo(-w, top + 5.2);
  p.quadraticCurveTo(-w + 0.4, top, -sh, top);
  p.closePath();
  return p;
}

/** Front-detail frame: where the chest center sits for this view and how wide details are. */
function front(v: View) {
  return { x: v.s * 5.2, k: 0.45 + 0.55 * Math.max(0, v.c), on: v.c > -0.3 };
}

function line(g: CanvasRenderingContext2D, pts: [number, number][], color: string, w: number) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = "round";
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

function glowDot(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  g.save();
  g.shadowColor = color;
  g.shadowBlur = 4;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.35);
  g.fill();
  g.restore();
}

function outfitDetails(g: CanvasRenderingContext2D, def: HeroDef, v: View, torso: Path2D) {
  const P = def.palette;
  const f = front(v);
  g.save();
  g.clip(torso);
  // Pants / hem band along the bottom.
  const hem = def.outfit === "coat" ? null : def.outfit === "hoodie" || def.outfit === "puffer" ? shade(P.outfit, 0.22) : P.trim;
  if (hem) {
    g.fillStyle = hem;
    g.fillRect(-14, 5.4, 28, 6);
    line(g, [[-14, 5.4], [14, 5.4]], INK, 1.1);
  }
  switch (def.outfit) {
    case "hoodie":
      if (f.on) {
        cel(g, poly([[f.x - 5.5 * f.k, 0.5], [f.x + 5.5 * f.k, 0.5], [f.x + 6.8 * f.k, 5.2], [f.x - 6.8 * f.k, 5.2]]), shade(P.outfit, 0.12), { dx: 0.4, dy: 0.6, line: 1.1 });
        for (const sx of [-1.6, 1.6]) {
          line(g, [[f.x + sx * f.k, -7], [f.x + sx * 1.2 * f.k, -1.5]], light(P.trim, 0.6), 0.9);
          glowDot(g, f.x + sx * 1.2 * f.k, -1.2, 1.2, 1.6, P.accent);
        }
      } else line(g, [[0, -7], [0, 5]], shade(P.outfit, 0.3), 0.8);
      break;
    case "tank": {
      // Bare shoulders, tank top body.
      g.fillStyle = P.skin;
      g.fillRect(-14, -9, 28, 6);
      cel(g, poly([[-7.5, -3.6], [-5.2, -8], [5.2, -8], [7.5, -3.6], [11, -2], [11, 9], [-11, 9], [-11, -2]]), P.outfit, { dx: 1.2, dy: 1.6, line: 1.2 });
      if (f.on) {
        g.save();
        g.translate(f.x, 1.2);
        g.scale(f.k, 1);
        g.fillStyle = P.accent;
        g.beginPath();
        g.moveTo(0, -3.4);
        g.quadraticCurveTo(3, 0, 0.8, 3);
        g.quadraticCurveTo(1, 0.6, -0.6, 0.4);
        g.quadraticCurveTo(-1, 2, -2, 3);
        g.quadraticCurveTo(-3, 0, 0, -3.4);
        g.fill();
        g.restore();
      }
      if (hem) {
        g.fillStyle = hem;
        g.fillRect(-14, 5.4, 28, 6);
        line(g, [[-14, 5.4], [14, 5.4]], INK, 1.1);
      }
      break;
    }
    case "flightsuit":
      if (f.on) {
        line(g, [[f.x - 4.5 * f.k, -7.5], [f.x - 2.5 * f.k, 5.4]], P.trim, 2.2);
        line(g, [[f.x + 4.5 * f.k, -7.5], [f.x + 2.5 * f.k, 5.4]], P.trim, 2.2);
        line(g, [[f.x, -6], [f.x, 5]], shade(P.outfit, 0.4), 0.9);
        glowDot(g, f.x + 5.6 * f.k, -2.6, 2.6 * f.k, 2.2, P.accent);
      } else {
        line(g, [[-4, -7.5], [4, 5]], P.trim, 2.2);
        line(g, [[4, -7.5], [-4, 5]], P.trim, 2.2);
      }
      break;
    case "puffer":
      for (const y of [-3.2, 1.2]) {
        g.strokeStyle = shade(P.outfit, 0.35);
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(-13, y + 1);
        g.quadraticCurveTo(0, y + 2.6, 13, y + 1);
        g.stroke();
      }
      cel(g, rrect(-7, -9.5, 14, 4.2, 2), P.trim, { dx: 0.5, dy: 0.8, line: 1.1 });
      if (f.on) {
        line(g, [[f.x, -5.5], [f.x, 6]], shade(P.outfit, 0.45), 1);
        glowDot(g, f.x - 5 * f.k, 3.2, 2.4 * f.k, 1.6, P.accent);
      }
      break;
    case "coat":
      g.fillStyle = P.trim;
      g.fillRect(-14, 4.2, 28, 2.4);
      line(g, [[-14, 4.2], [14, 4.2]], INK, 0.9);
      line(g, [[-14, 6.6], [14, 6.6]], INK, 0.9);
      if (f.on) {
        line(g, [[f.x - 7 * f.k, -7.5], [f.x + 6 * f.k, 4]], INK, 3.6);
        line(g, [[f.x - 7 * f.k, -7.5], [f.x + 6 * f.k, 4]], "#6b4a2e", 2.2);
        for (let i = 0; i < 4; i++) {
          const t = 0.18 + i * 0.2;
          g.fillStyle = "#ffd36b";
          g.fillRect(f.x + (-7 + 13 * t) * f.k - 0.6, -7.5 + 11.5 * t - 0.9, 1.2, 1.8);
        }
        cel(g, poly([[f.x - 3.6 * f.k, -8], [f.x, -4.6], [f.x + 3.6 * f.k, -8]]), shade(P.outfit, 0.25), { dx: 0.3, dy: 0.4, line: 1 });
      }
      break;
    case "tee":
      if (f.on) {
        g.save();
        g.translate(f.x, -0.2);
        g.scale(f.k, 1);
        g.shadowColor = P.accent;
        g.shadowBlur = 4;
        g.fillStyle = P.accent;
        g.beginPath();
        g.roundRect(-4.2, -2.2, 8.4, 4.4, 2.2);
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = shade(P.outfit, 0.55);
        g.fillRect(-3, -0.4, 2.2, 0.8);
        g.fillRect(-2.3, -1.1, 0.8, 2.2);
        g.beginPath();
        g.arc(1.6, -0.6, 0.6, 0, Math.PI * 2);
        g.arc(2.8, 0.5, 0.6, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      break;
    case "vest":
      if (f.on) {
        g.fillStyle = "#e8e6f0";
        g.beginPath();
        g.moveTo(f.x - 3.6 * f.k, -8);
        g.lineTo(f.x + 3.6 * f.k, -8);
        g.lineTo(f.x + 2 * f.k, 5.5);
        g.lineTo(f.x - 2 * f.k, 5.5);
        g.fill();
        line(g, [[f.x - 3.6 * f.k, -8], [f.x - 2 * f.k, 5.5]], INK, 1);
        line(g, [[f.x + 3.6 * f.k, -8], [f.x + 2 * f.k, 5.5]], INK, 1);
        glowDot(g, f.x, -1, 2 * f.k, 2, P.accent);
      }
      g.fillStyle = "#d8dcef";
      for (const [x, y] of [[-8.5, -4.5], [-6.5, -6.4], [8.5, -4.5], [6.5, -6.4]] as const) {
        g.beginPath();
        g.arc(x, y, 0.9, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case "track":
      for (const sx of [-1, 1]) line(g, [[sx * 9.2, -5], [sx * 10.4, 5]], P.trim, 1.6);
      if (f.on) {
        line(g, [[f.x, -6.5], [f.x, 5.4]], shade(P.outfit, 0.45), 1.1);
        cel(g, poly([[f.x - 4.2 * f.k, -8.4], [f.x, -3.6], [f.x + 4.2 * f.k, -8.4]]), P.trim, { dx: 0.3, dy: 0.4, line: 1 });
        g.strokeStyle = P.gear;
        g.lineWidth = 1.3;
        g.beginPath();
        g.ellipse(f.x, -5.4, 3.6 * f.k, 2.6, 0, 0.15, Math.PI - 0.15);
        g.stroke();
      }
      break;
  }
  g.restore();
}

/** The torso into `g` (body-local units). */
export function paintBody(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  g.lineJoin = "round";
  const torso = torsoPath(def);
  cel(g, torso, def.palette.outfit, { dx: 2, dy: 2.2, line: 0 });
  outfitDetails(g, def, v, torso);
  g.strokeStyle = INK;
  g.lineWidth = LINE;
  g.stroke(torso);
}

/** One foot: a round shoe with a light sole edge. `lift` raises it (walk cycle). */
export function drawFoot(ctx: CanvasRenderingContext2D, def: HeroDef, rim: string, x: number, y: number, lift: number) {
  const ry = 3.1 - lift * 0.25;
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(x, y, 5.6, ry + 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  cel(ctx, ellipse(x, y, 4.3, ry), def.palette.shoe, { dx: 0.6, dy: 1, line: 1.5 });
  ctx.fillStyle = light(def.palette.shoe, 0.55);
  ctx.beginPath();
  ctx.ellipse(x - 1, y - ry * 0.4, 1.6, 0.8, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

export const HAND_R = 3.6;

/** One round hand (mitten) with the player-color rim. */
export function drawHand(ctx: CanvasRenderingContext2D, def: HeroDef, rim: string, x: number, y: number, r = HAND_R) {
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(x, y, r + 1.2, 0, Math.PI * 2);
  ctx.fill();
  cel(ctx, circle(x, y, r), def.palette.hands, { dx: 0.8, dy: 1.1, line: 1.5 });
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}
