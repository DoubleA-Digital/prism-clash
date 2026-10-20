// Head geometry shared by the head, hair and live blink: head radius, the face opening in the
// hair, and where the eyes land for a given view.

import { ellipse, onHead, smooth, type View } from "./paint";

export const HR = 15;

/** Center and radii of the face opening for a view (null when facing away). */
export function windowGeom(v: View, grow = 1): { x: number; y: number; rx: number; ry: number } | null {
  if (v.c < -0.5) return null;
  const vis = smooth(-0.5, 0.05, v.c);
  const rx = HR * (0.52 + 0.3 * Math.max(0, v.c)) * vis * grow;
  const ry = HR * 0.7 * (0.6 + 0.4 * smooth(-0.5, 0.2, v.c)) * grow;
  return { x: v.s * HR * 0.5, y: 3.8 + v.c * 0.6, rx, ry };
}

/** The opening in the hair (or hood) where the face shows. Null when facing away. */
export function faceWindow(v: View, grow = 1): Path2D | null {
  const w = windowGeom(v, grow);
  return w ? ellipse(w.x, w.y, w.rx, w.ry) : null;
}

export interface EyeSpot {
  x: number;
  y: number;
  /** Width foreshortening 0..1. */
  k: number;
  side: -1 | 1;
}

/** Where the two eyes land for this view (only the ones turned toward the camera). */
export function eyeSpots(v: View): EyeSpot[] {
  const out: EyeSpot[] = [];
  for (const side of [-1, 1] as const) {
    const p = onHead(v, side * 0.4, 0.1, HR);
    if (p.d > 0.14) out.push({ x: p.x, y: p.y, k: Math.min(1, p.d * 1.1), side });
  }
  return out;
}

export const EYE_W = 4.8;
export const EYE_H = 6.8;

