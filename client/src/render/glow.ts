// Pre-rendered glow sprites. Drawing a cached radial gradient with additive blending is
// far cheaper than canvas shadowBlur, which is what keeps 2,000+ glowing particles at 60 fps.

const cache = new Map<string, HTMLCanvasElement>();
const SIZES = [8, 16, 32, 64, 128, 256];

function bucket(r: number): number {
  for (const s of SIZES) if (r <= s) return s;
  return 256;
}

/** A soft radial glow sprite of the given color, radius bucketed for reuse. */
export function glowSprite(color: string, radius: number, core = 0.18): HTMLCanvasElement {
  const r = bucket(radius);
  const key = `${color}|${r}|${core}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = r * 2;
  const g = c.getContext("2d");
  if (!g) return c;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(core, color);
  grad.addColorStop(0.45, withAlpha(color, 0.35));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, r * 2, r * 2);
  cache.set(key, c);
  return c;
}

/** Draws a glow centered at (x, y) with visual radius `radius` (additive). */
export function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 1, core = 0.18) {
  if (alpha <= 0.01 || radius <= 0.5) return;
  const s = glowSprite(color, radius, core);
  const prevA = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = prevA * Math.min(1, alpha);
  ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prevA;
  ctx.globalCompositeOperation = prevOp;
}

const parsed = new Map<string, [number, number, number]>();
export function rgb(hex: string): [number, number, number] {
  let v = parsed.get(hex);
  if (!v) {
    const h = hex.replace("#", "");
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    parsed.set(hex, v);
  }
  return v;
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`;
}

/** Hue-cycled rainbow for prism effects. */
export function rainbow(t: number): string {
  const h = ((t % 1) + 1) % 1;
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (1 - Math.max(0, Math.min(1, Math.min(k, 4 - k)))));
  };
  const hx = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hx(f(5))}${hx(f(3))}${hx(f(1))}`;
}
