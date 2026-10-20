// The chibi head: a big cel-shaded skull seen from above-front, the face (eyes, brows, mouth,
// blush) turned toward the aim, and the hair or headgear from hair.ts layered behind and in
// front. Drawn in head-local units around (0, 0) with radius HR.

import type { HeroDef, HeroFace } from "@prism/shared";
import { hairBack, hairCap, hairFront } from "./hair";
import { EYE_H, EYE_W, HR, eyeSpots } from "./geom";
import { INK, cel, ellipse, onHead, shade, type View } from "./paint";

function irisColor(face: HeroFace, def: HeroDef): string {
  if (face === "sparkle") return def.palette.accent;
  if (face === "scope") return "#4a6bff";
  if (face === "grin") return "#ff7a2e";
  return "#6a4cff";
}

function paintEyes(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const face = def.face;
  if (face === "visor" || face === "shades" || face === "glow") return;
  const spots = eyeSpots(v);
  for (const e of spots) {
    const w = EYE_W * e.k;
    const h = face === "chill" ? EYE_H * 0.8 : face === "smirk" ? EYE_H * 0.82 : EYE_H;
    // Dark eye with a colored lower iris and two highlights.
    g.fillStyle = "#1c1038";
    g.beginPath();
    g.ellipse(e.x, e.y, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.ellipse(e.x, e.y, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = irisColor(face, def);
    g.beginPath();
    g.ellipse(e.x, e.y + h * 0.32, w * 0.5, h * 0.36, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(e.x - w * 0.14, e.y - h * 0.2, w * 0.24, h * 0.17, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(e.x + w * 0.2, e.y + h * 0.18, w * 0.1, 0, Math.PI * 2);
    g.fill();
    if (face === "sparkle") {
      g.fillStyle = "#ffffff";
      g.beginPath();
      const sx = e.x + w * 0.18;
      const sy = e.y - h * 0.28;
      g.moveTo(sx, sy - 1.3);
      g.lineTo(sx + 0.4, sy - 0.4);
      g.lineTo(sx + 1.3, sy);
      g.lineTo(sx + 0.4, sy + 0.4);
      g.lineTo(sx, sy + 1.3);
      g.lineTo(sx - 0.4, sy + 0.4);
      g.lineTo(sx - 1.3, sy);
      g.lineTo(sx - 0.4, sy - 0.4);
      g.fill();
    }
    // Lids and brows give each face its attitude.
    g.strokeStyle = INK;
    g.lineCap = "round";
    if (face === "chill") {
      g.fillStyle = def.palette.skin;
      g.fillRect(e.x - w * 0.6, e.y - h * 0.62, w * 1.2, h * 0.48);
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(e.x - w * 0.58, e.y - h * 0.14);
      g.lineTo(e.x + w * 0.58, e.y - h * 0.16);
      g.stroke();
    }
    const brow = (tilt: number, lift: number, lw: number) => {
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(e.x - w * 0.55, e.y - h * 0.78 - lift + tilt * e.side);
      g.lineTo(e.x + w * 0.55, e.y - h * 0.78 - lift - tilt * e.side);
      g.stroke();
    };
    if (face === "grin") brow(-1.3, 0.2, 1.9);
    else if (face === "smirk") brow(e.side === 1 ? -1.4 : 0.5, e.side === 1 ? 0 : 0.8, 1.7);
    else if (face === "scope") brow(-0.5, 0.1, 1.3);
  }
}

function paintMouth(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const m = onHead(v, 0, 0.5, HR);
  if (m.d < 0.18 || def.face === "visor") return;
  const k = Math.min(1, m.d * 1.2);
  const x = m.x;
  const y = m.y;
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 1.2;
  switch (def.face) {
    case "grin": {
      g.fillStyle = "#3a0f24";
      g.beginPath();
      g.moveTo(x - 2.8 * k, y - 0.6);
      g.quadraticCurveTo(x, y - 1.2, x + 2.8 * k, y - 0.6);
      g.quadraticCurveTo(x + 2 * k, y + 2.6, x, y + 2.7);
      g.quadraticCurveTo(x - 2 * k, y + 2.6, x - 2.8 * k, y - 0.6);
      g.fill();
      g.stroke();
      g.fillStyle = "#ffffff";
      g.fillRect(x - 2 * k, y - 0.7, 4 * k, 1);
      break;
    }
    case "sparkle": {
      g.beginPath();
      g.moveTo(x - 1.8 * k, y);
      g.quadraticCurveTo(x - 0.9 * k, y + 1.3, x, y);
      g.quadraticCurveTo(x + 0.9 * k, y + 1.3, x + 1.8 * k, y);
      g.stroke();
      break;
    }
    case "smirk": {
      g.beginPath();
      g.moveTo(x - 1.8 * k, y + 0.5);
      g.quadraticCurveTo(x + 0.4 * k, y + 1.1, x + 2.2 * k, y - 0.8);
      g.stroke();
      break;
    }
    case "shades": {
      g.fillStyle = "#3a0f24";
      g.beginPath();
      g.moveTo(x - 2.6 * k, y - 0.4);
      g.quadraticCurveTo(x, y + 3.2, x + 2.6 * k, y - 0.4);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    case "glow":
      break;
    default: {
      g.beginPath();
      g.moveTo(x - 1.4 * k, y + 0.2);
      g.quadraticCurveTo(x, y + 1.2, x + 1.4 * k, y + 0.2);
      g.stroke();
    }
  }
}

function paintBlush(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  if (def.face === "glow" || def.face === "visor") return;
  g.save();
  g.fillStyle = "#ff6b9a";
  for (const side of [-1, 1]) {
    const p = onHead(v, side * 0.78, 0.36, HR);
    if (p.d < 0.2) continue;
    g.globalAlpha = 0.42 * Math.min(1, p.d * 1.4);
    g.beginPath();
    g.ellipse(p.x, p.y, 2.3 * p.d, 1.3, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Small per-face extras that sit on the skin (band-aid, scar). */
function paintFaceMarks(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  if (def.face === "grin") {
    const p = onHead(v, -0.75, 0.3, HR);
    if (p.d > 0.25) {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(-0.5);
      g.fillStyle = "#ffe6c4";
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.beginPath();
      g.roundRect(-2.6 * p.d, -1.1, 5.2 * p.d, 2.2, 1);
      g.fill();
      g.stroke();
      g.restore();
    }
  } else if (def.face === "smirk") {
    const p = onHead(v, 0.72, 0.15, HR);
    if (p.d > 0.25) {
      g.strokeStyle = shade(def.palette.skin, 0.55);
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(p.x - 1.4 * p.d, p.y - 1.6);
      g.lineTo(p.x + 1.2 * p.d, p.y + 1.6);
      g.moveTo(p.x - 1.4 * p.d, p.y + 0.6);
      g.lineTo(p.x + 0.4 * p.d, p.y - 0.4);
      g.stroke();
    }
  }
}

/** Ears (skipped under hoods and helmets). */
function paintEars(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  if (def.headgear === "hood" || def.headgear === "helmet" || def.headgear === "catphones") return;
  for (const side of [-1, 1]) {
    const p = onHead(v, side * Math.PI * 0.5, 0.18, HR * 0.98);
    if (p.d < -0.35) continue;
    const rx = 2 + 1.4 * Math.abs(p.d);
    cel(g, ellipse(p.x, p.y, rx, 3.1), def.palette.skin, { dx: 0.6, dy: 0.8, line: 1.3 });
  }
}

/** The whole head into `g` (head-local units). */
export function paintHead(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  g.lineJoin = "round";
  g.lineCap = "round";
  hairBack(g, def, v);
  const skull = ellipse(0, 0, HR * 1.02, HR * 0.97);
  cel(g, skull, def.palette.skin, { dx: 2.2, dy: 2.6 });
  paintEars(g, def, v);
  paintBlush(g, def, v);
  paintFaceMarks(g, def, v);
  paintEyes(g, def, v);
  paintMouth(g, def, v);
  hairCap(g, def, v);
  hairFront(g, def, v);
}

/** Closed eyelids for a blink, drawn live over a cached head (head-local units). */
export function paintBlink(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  if (def.face === "glow" || def.face === "visor" || def.face === "shades") return;
  g.lineCap = "round";
  for (const e of eyeSpots(v)) {
    const w = EYE_W * e.k;
    g.fillStyle = def.palette.skin;
    g.beginPath();
    g.ellipse(e.x, e.y, w / 2 + 0.7, EYE_H / 2 + 0.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(e.x - w * 0.55, e.y + 0.4);
    g.quadraticCurveTo(e.x, e.y + 1.8, e.x + w * 0.55, e.y + 0.4);
    g.stroke();
  }
}

