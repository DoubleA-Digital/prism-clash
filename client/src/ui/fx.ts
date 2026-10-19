// Small UI effects: rem sizing, 3D card tilt, count-up numbers, confetti, shared helpers.

export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Converts rem to CSS pixels at the current root font size (for canvases). */
export function rem(n: number): number {
  return Math.round(n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
}

/** 3D hover tilt: sets --rx / --ry (degrees) and --mx / --my (glare position, %) on the element. */
export function tilt(el: HTMLElement, max = 11) {
  el.addEventListener("pointermove", (e) => {
    if (reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  });
  el.addEventListener("pointerleave", () => {
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  });
}

/** Animates an element's text from one integer to another. */
export function countUp(el: HTMLElement, from: number, to: number, ms: number, delayMs = 0, fmt: (n: number) => string = (n) => String(n)) {
  el.textContent = fmt(from);
  if (reducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now() + delayMs;
  const step = (now: number) => {
    if (!el.isConnected && now - t0 > 100) return;
    const k = Math.max(0, Math.min(1, (now - t0) / ms));
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  life: number;
}

let confettiEl: HTMLCanvasElement | null = null;

export function stopConfetti() {
  confettiEl?.remove();
  confettiEl = null;
}

/** A celebratory burst from two points near the top, in the winner's color plus white and gold. */
export function confetti(color: string, parent: HTMLElement) {
  stopConfetti();
  if (reducedMotion()) return;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5";
  parent.append(canvas);
  confettiEl = canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const palette = [color, color, "#ffffff", "#ffc83d", color];
  const bits: Bit[] = [];
  const burst = (x: number, dir: number) => {
    for (let i = 0; i < 90; i++) {
      const a = -Math.PI / 2 + dir * (0.25 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.4;
      const sp = 700 + Math.random() * 900;
      bits.push({ x, y: H * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18, w: 6 + Math.random() * 8, h: 10 + Math.random() * 10, color: palette[i % palette.length] ?? color, life: 3.2 + Math.random() * 1.4 });
    }
  };
  burst(W * 0.12, 1);
  burst(W * 0.88, -1);
  // A second, softer rain from the top.
  for (let i = 0; i < 70; i++) bits.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 80, vy: 120 + Math.random() * 160, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, w: 6 + Math.random() * 6, h: 9 + Math.random() * 8, color: palette[i % palette.length] ?? color, life: 5 + Math.random() * 2 });
  let last = performance.now();
  const loop = (now: number) => {
    if (confettiEl !== canvas) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const b of bits) {
      b.life -= dt;
      if (b.life <= 0) continue;
      alive++;
      b.vy += 900 * dt;
      b.vx *= 1 - 1.4 * dt;
      b.vy *= 1 - 0.9 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life);
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.scale(1, Math.cos(b.rot * 1.7));
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(loop);
    else stopConfetti();
  };
  requestAnimationFrame(loop);
}

/** "1st", "2nd", ... */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
