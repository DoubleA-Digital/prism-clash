// Hair and headgear: the main silhouette read for each hero. Each style paints a back layer
// (behind the skull), a cap (hair with a hole for the face) and a front layer (spikes, hats,
// headphones, eyewear). Features on the head follow the view so they turn with the aim.

import type { HeroDef } from "@prism/shared";
import { mix } from "../glow";
import { HR, faceWindow } from "./geom";
import { bangs, capWithWindow, domePath, knotTails, meridianPts, ringPts, strokeBand } from "./hairKit";
import { afroCloud, glowEyes, mask, mohawk, ponytail, scope, shades, spikes } from "./hairParts";
import { INK, LINE, cel, circle, ellipse, light, onHead, poly, shade, type View } from "./paint";

export function hairBack(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  switch (def.headgear) {
    case "spiky":
      spikes(g, def, v);
      knotTails(g, def.palette.gear, v, false);
      break;
    case "afro":
      afroCloud(g, def);
      break;
    case "ponytail":
      ponytail(g, def, v, false);
      break;
    case "bandana":
      mohawk(g, def, v, false);
      knotTails(g, def.palette.gear, v, false, 0.34);
      break;
    default:
      break;
  }
}

export function hairCap(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const P = def.palette;
  switch (def.headgear) {
    case "hood": {
      const shell = ellipse(0, -1.6, HR * 1.16, HR * 1.1);
      const win = faceWindow(v, 0.92);
      const p = new Path2D(shell);
      if (win) p.addPath(win);
      g.save();
      g.clip(shell);
      cel(g, p, P.gear, { rule: "evenodd", line: 0, dx: 2.6, dy: 3 });
      if (win) {
        const grad = g.createLinearGradient(0, -6, 0, 12);
        grad.addColorStop(0, "rgba(8,6,26,0.82)");
        grad.addColorStop(0.75, "rgba(8,6,26,0.25)");
        grad.addColorStop(1, "rgba(8,6,26,0.1)");
        g.fillStyle = grad;
        g.fill(win);
        g.strokeStyle = INK;
        g.lineWidth = 3.6;
        g.stroke(win);
        g.strokeStyle = light(P.gear, 0.22);
        g.lineWidth = 1.7;
        g.stroke(win);
      } else strokeBand(g, meridianPts(v, 0, -0.2, Math.PI + 0.2, HR * 1.1), shade(P.gear, 0.3), 0.6);
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = LINE;
      g.stroke(shell);
      break;
    }
    case "helmet": {
      const shell = ellipse(0, -0.8, HR * 1.1, HR * 1.06);
      cel(g, shell, P.gear, { dx: 2.6, dy: 3 });
      strokeBand(g, meridianPts(v, 0, 0.5, Math.PI, HR * 1.08), P.trim, 3.2);
      const win = faceWindow(v, 0.94);
      if (win) {
        g.save();
        g.clip(shell);
        g.strokeStyle = INK;
        g.lineWidth = 5.4;
        g.stroke(win);
        g.strokeStyle = P.trim;
        g.lineWidth = 3;
        g.stroke(win);
        const grad = g.createLinearGradient(0, -4, 0, 14);
        grad.addColorStop(0, "#0a0f2e");
        grad.addColorStop(1, shade(P.accent, 0.7));
        g.fillStyle = grad;
        g.fill(win);
        g.clip(win);
        g.fillStyle = "rgba(255,255,255,0.55)";
        g.beginPath();
        g.moveTo(v.s * 6 - 8, -6);
        g.lineTo(v.s * 6 - 3, -6);
        g.lineTo(v.s * 6 - 9, 12);
        g.lineTo(v.s * 6 - 12, 12);
        g.fill();
        g.strokeStyle = P.accent;
        g.lineWidth = 1.2;
        g.shadowColor = P.accent;
        g.shadowBlur = 5;
        g.beginPath();
        g.ellipse(v.s * HR * 0.5, 3.8 + v.c * 0.6, HR * 0.66, HR * 0.58, 0, 0.35, Math.PI - 0.35);
        g.stroke();
        g.restore();
      }
      for (const side of [-1, 1]) {
        const e = onHead(v, side * Math.PI * 0.5, 0.12, HR * 1.06);
        if (e.d < -0.3) continue;
        cel(g, ellipse(e.x, e.y, 1.8 + 2 * Math.abs(e.d), 4), P.trim, { dx: 0.5, dy: 0.8, line: 1.3 });
        g.fillStyle = P.accent;
        g.beginPath();
        g.arc(e.x, e.y, 1, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case "beanie":
      capWithWindow(g, P.hair, v, 1.06);
      break;
    case "ponytail":
      capWithWindow(g, P.hair, v);
      if (v.c > -0.3) {
        const wx = v.s * HR * 0.52;
        const sw = new Path2D();
        sw.moveTo(wx - 12, -5);
        sw.quadraticCurveTo(wx - 2, -9, wx + 9, -6);
        sw.quadraticCurveTo(wx + 1, -3, wx - 7, 5);
        sw.quadraticCurveTo(wx - 8, -1, wx - 12, -5);
        g.save();
        g.clip(ellipse(0, -0.8, HR * 1.06, HR * 1.02));
        cel(g, sw, P.hair, { dx: 0.6, dy: 1, line: 1.2 });
        g.restore();
      }
      break;
    case "catphones":
      capWithWindow(g, P.hair, v);
      bangs(g, P.hair, v, [-0.62, -0.25, 0.15, 0.55], 4.2, 0.6, 3.6);
      break;
    case "bandana":
      capWithWindow(g, mix(P.skin, P.hair, 0.2), v, 1.04);
      break;
    case "afro":
      capWithWindow(g, P.hair, v, 1.1);
      break;
    case "spiky":
      capWithWindow(g, P.hair, v);
      bangs(g, P.hair, v, [-0.55, -0.12, 0.35], 6, 1.4, 3.4);
      break;
  }
}

export function hairFront(g: CanvasRenderingContext2D, def: HeroDef, v: View) {
  const P = def.palette;
  switch (def.headgear) {
    case "hood":
      glowEyes(g, def, v);
      break;
    case "spiky":
      strokeBand(g, ringPts(-0.36, HR * 1.03), P.gear, 3);
      knotTails(g, P.gear, v, true);
      break;
    case "helmet": {
      const b = onHead(v, -Math.PI * 0.5, -0.45, HR * 1.05);
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - 3, b.y - 9);
      g.stroke();
      g.strokeStyle = P.trim;
      g.lineWidth = 1.4;
      g.stroke();
      g.save();
      g.shadowColor = P.accent;
      g.shadowBlur = 6;
      g.fillStyle = P.accent;
      g.beginPath();
      g.arc(b.x - 3, b.y - 9.5, 1.9, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    }
    case "beanie": {
      cel(g, domePath(-0.2, HR * 1.12), P.gear, { dx: 2, dy: 2.4 });
      g.strokeStyle = shade(P.gear, 0.25);
      g.lineWidth = 0.9;
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.moveTo(i * 3.2, -5);
        g.quadraticCurveTo(i * 3.6, -11, i * 2.2, -15.5);
        g.stroke();
      }
      strokeBand(g, ringPts(-0.2, HR * 1.13), light(P.gear, 0.12), 4.4);
      const top = HR * 1.1 + 2.2;
      cel(g, circle(-v.s * 1.5, -top, 4.4), light(P.gear, 0.25), { dx: 0.8, dy: 1.1 });
      const f = onHead(v, 0, -0.2, HR * 1.13);
      if (f.d > 0.25) {
        g.save();
        g.shadowColor = P.accent;
        g.shadowBlur = 4;
        g.fillStyle = P.accent;
        g.fillRect(f.x - 2.2 * f.d, f.y - 1.6, 4.4 * f.d, 3);
        g.restore();
      }
      break;
    }
    case "ponytail":
      ponytail(g, def, v, true);
      scope(g, def, v);
      break;
    case "catphones": {
      const band = meridianPts(v, Math.PI / 2, 0, Math.PI, HR * 1.1);
      for (const t of [Math.PI / 2 - 0.62, Math.PI / 2 + 0.62]) {
        const a = Math.PI / 2 + v.yaw;
        const x = Math.cos(t) * Math.sin(a) * HR * 1.08;
        const y = -Math.sin(t) * HR * 1.0 + Math.cos(t) * Math.cos(a) * HR * 0.22;
        const ear = poly([[x - 4.2, y + 1.5], [x - 1, y - 7.5], [x + 4.2, y + 1.5]]);
        cel(g, ear, P.gear, { dx: 0.6, dy: 1 });
        g.save();
        g.shadowColor = P.accent;
        g.shadowBlur = 5;
        g.fillStyle = P.accent;
        g.fill(poly([[x - 2.1, y + 0.6], [x - 0.6, y - 4.4], [x + 2.1, y + 0.6]]));
        g.restore();
      }
      strokeBand(g, band, P.gear, 3.2);
      for (const side of [-1, 1]) {
        const e = onHead(v, side * Math.PI * 0.5, 0.15, HR * 1.04);
        if (e.d < -0.25) continue;
        const rx = 2.6 + 2.6 * Math.abs(e.d);
        cel(g, ellipse(e.x, e.y, rx, 6), P.gear, { dx: 0.8, dy: 1.2 });
        g.save();
        g.shadowColor = P.accent;
        g.shadowBlur = 4;
        g.strokeStyle = P.accent;
        g.lineWidth = 1.3;
        g.beginPath();
        g.ellipse(e.x, e.y, rx * 0.55, 3.6, 0, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
      break;
    }
    case "bandana":
      mask(g, def, v);
      mohawk(g, def, v, true);
      knotTails(g, P.gear, v, true, 0.34);
      break;
    case "afro": {
      const x = 9 - v.s * 2;
      g.save();
      g.translate(x, -19);
      g.rotate(0.35);
      cel(g, poly([[-1.2, -5], [1.2, -5], [1.2, 2], [-1.2, 2]]), P.gear, { dx: 0.3, dy: 0.5, line: 1.1 });
      cel(g, ellipse(0, -6.2, 3.2, 2.2), P.gear, { dx: 0.4, dy: 0.5, line: 1.1 });
      g.restore();
      shades(g, def, v);
      break;
    }
  }
}
