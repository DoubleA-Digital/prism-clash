// Dev-only preview page entry (client/hero-preview.html; not part of the production build).
// Views: ?view=lineup | turn | weapons | anims | game | loot | picker | bench
// Options: &t=<seconds> freezes time (default 1.3), &live=1 animates, &zoom=<n> scales the canvas.

import { HERO_IDS, HEROES, WEAPON_IDS, type HeroId, type WeaponId } from "@prism/shared";
import { mountHeroPicker } from "../../ui/heroPicker";
import { benchmarkChibi, chibiCacheStats, drawHero, drawHeroPortrait, drawWeaponIcon, drawWeaponItem, idleAnim, type ChibiAnim } from "./index";

const q = new URLSearchParams(location.search);
const VIEW = q.get("view") ?? "lineup";
const LIVE = q.get("live") === "1";
const T0 = Number(q.get("t") ?? "1.3");
const ZOOM = Number(q.get("zoom") ?? "1");
const COLORS = ["#00F0FF", "#FF2E88", "#9DFF3A", "#FFC83D", "#A970FF"];
const VIEWS = ["close", "lineup", "turn", "weapons", "anims", "game", "loot", "picker", "bench"];

const nav = document.getElementById("nav");
if (nav) for (const v of VIEWS) {
  const a = document.createElement("a");
  a.href = `?view=${v}`;
  a.textContent = v;
  if (v === VIEW) a.className = "on";
  nav.append(a);
}

type Draw = (ctx: CanvasRenderingContext2D, t: number) => void;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 14, color = "#8a90c0", align: CanvasTextAlign = "center") {
  ctx.font = `700 ${size}px Rajdhani, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function floor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#0b0a24";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(42,58,138,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x += 48) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 0; y < h; y += 48) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();
}

const anim = (o: Partial<ChibiAnim> = {}): ChibiAnim => ({ ...idleAnim(), ...o });

function hero(ctx: CanvasRenderingContext2D, heroId: HeroId, color: string, x: number, y: number, aim: number, weapon: WeaponId | null, rarity: number, scale: number, t: number, a: Partial<ChibiAnim> = {}, seed = 0) {
  drawHero(ctx, { heroId, color, x, y, aim, weapon: weapon ? { id: weapon, rarity } : null, anim: anim(a), scale, time: t, seed });
}

const views: Record<string, { w: number; h: number; draw: Draw }> = {
  close: {
    w: 1600,
    h: 980,
    draw(ctx, t) {
      floor(ctx, 1600, 980);
      const weapons: WeaponId[] = ["rifle", "shotgun", "smg", "pistol", "sniper", "lance", "rocket", "blade"];
      HERO_IDS.forEach((id, i) => {
        const x = 200 + (i % 4) * 400;
        const y = 230 + Math.floor(i / 4) * 450;
        hero(ctx, id, COLORS[i % 5]!, x, y, 0.5, weapons[i]!, i % 4, 5.2, t, {}, i);
        label(ctx, HEROES[id].name.toUpperCase(), x, y + 160, 22, "#ffffff");
      });
    },
  },
  lineup: {
    w: 1600,
    h: 900,
    draw(ctx, t) {
      floor(ctx, 1600, 900);
      label(ctx, "PRISM CLASH · MINI HEROES", 800, 40, 26, "#ffffff");
      HERO_IDS.forEach((id, i) => {
        const x = 110 + i * 197;
        const c = COLORS[i % 5]!;
        const weapons: WeaponId[] = ["smg", "shotgun", "rifle", "pistol", "sniper", "lance", "rocket", "blade"];
        hero(ctx, id, c, x, 230, 0.55, weapons[i]!, i % 4, 3, t, {}, i);
        label(ctx, HEROES[id].name.toUpperCase(), x, 345, 22, "#ffffff");
        label(ctx, HEROES[id].tagline, x, 368, 14);
        ctx.save();
        ctx.translate(x - 70, 400);
        drawHeroPortrait(ctx, id, c, 140);
        ctx.restore();
        hero(ctx, id, c, x - 40, 640, Math.PI / 2, "pistol", 0, 2, t, {}, i);
        hero(ctx, id, c, x + 40, 640, -Math.PI / 2, "rifle", 1, 2, t, {}, i);
        hero(ctx, id, c, x, 790, 0, null, 0, 1, t, {}, i);
        hero(ctx, id, c, x + 40, 790, Math.PI, "smg", 2, 1, t, {}, i);
        hero(ctx, id, c, x - 40, 790, 1.2, "shotgun", 3, 1, t, {}, i);
      });
      label(ctx, "1x game scale →", 40, 790, 13, "#8a90c0", "left");
    },
  },
  turn: {
    w: 1600,
    h: 900,
    draw(ctx, t) {
      floor(ctx, 1600, 900);
      HERO_IDS.forEach((id, r) => {
        for (let k = 0; k < 16; k++) {
          const aim = (k / 16) * Math.PI * 2;
          hero(ctx, id, COLORS[r % 5]!, 70 + k * 96, 75 + r * 108, aim, k % 2 ? "rifle" : "pistol", r % 4, 1.6, t, {}, r);
        }
      });
    },
  },
  weapons: {
    w: 1600,
    h: 900,
    draw(ctx, t) {
      floor(ctx, 1600, 900);
      WEAPON_IDS.forEach((w, c) => label(ctx, w.toUpperCase(), 140 + c * 190, 24, 15, "#ffffff"));
      HERO_IDS.forEach((id, r) => {
        WEAPON_IDS.forEach((w, c) => {
          hero(ctx, id, COLORS[(r + c) % 5]!, 120 + c * 190, 92 + r * 106, c % 2 ? 0.25 : Math.PI - 0.5, w, (r + c) % 4, 1.75, t, {}, r);
        });
      });
    },
  },
  anims: {
    w: 1600,
    h: 1330,
    draw(ctx, t) {
      floor(ctx, 1600, 1330);
      const rows: [string, WeaponId | null, (i: number) => Partial<ChibiAnim>][] = [
        ["walk", "rifle", (i) => ({ walkPhase: (i / 8) * Math.PI * 2, speed: 330 })],
        ["recoil sniper", "sniper", (i) => ({ recoilT: i / 8 })],
        ["recoil smg", "smg", (i) => ({ recoilT: i / 8 })],
        ["reload", "rifle", (i) => ({ reloadT: i / 8 })],
        ["heal bandage", "shotgun", (i) => ({ healT: i / 8, healKind: "bandage" })],
        ["heal medkit", "pistol", (i) => ({ healT: i / 8, healKind: "medkit" })],
        ["throw", "smg", (i) => ({ throwT: i / 8 })],
        ["slash", "blade", (i) => ({ slashT: i / 8 })],
        ["dash", "rifle", (i) => ({ dashT: i / 8, dashAngle: 0 })],
        ["hit", "pistol", (i) => ({ hitT: i / 8 })],
        ["death", "rifle", (i) => ({ deathT: i / 8 })],
        ["cloak / spawn", "pistol", (i) => (i < 3 ? { cloak: 0.35 + i * 0.3 } : { spawnT: 0.45 + ((i - 3) / 5) * 0.55 })],
      ];
      rows.forEach(([name, w, f], r) => {
        const y = 70 + r * 106;
        label(ctx, name.toUpperCase(), 20, y, 14, "#ffffff", "left");
        for (let i = 0; i < 8; i++) {
          const id = HERO_IDS[(r + i) % 8]!;
          hero(ctx, id, COLORS[r % 5]!, 230 + i * 170, y - 4, 0.15, w, r % 4, 1.5, t, f(i), r);
        }
      });
    },
  },
  game: {
    w: 1280,
    h: 720,
    draw(ctx, t) {
      floor(ctx, 1280, 720);
      const states: Partial<ChibiAnim>[] = [{}, { speed: 330, walkPhase: t * 12 }, { recoilT: 0.1 }, { reloadT: 0.5 }, { healT: 0.4 }, { speed: 330, walkPhase: t * 12 + 2 }, { slashT: 0.45 }, { hitT: 0.15 }, { throwT: 0.42 }, {}, { speed: 200, walkPhase: t * 9 }, { recoilT: 0.05 }];
      for (let i = 0; i < 12; i++) {
        const id = HERO_IDS[i % 8]!;
        const x = 180 + (i % 4) * 300 + (Math.floor(i / 4) % 2) * 60;
        const y = 150 + Math.floor(i / 4) * 210;
        const w = WEAPON_IDS[i % 8]!;
        hero(ctx, id, COLORS[i % 5]!, x, y, i * 0.9 + 0.3, w, i % 4, 1, t, states[i] ?? {}, i);
      }
      drawWeaponItem(ctx, "rifle", 3, 640, 640, t);
      drawWeaponItem(ctx, "shotgun", 1, 520, 660, t);
    },
  },
  loot: {
    w: 1600,
    h: 640,
    draw(ctx, t) {
      floor(ctx, 1600, 640);
      WEAPON_IDS.forEach((w, c) => {
        label(ctx, w.toUpperCase(), 110 + c * 195, 30, 15, "#ffffff");
        for (let r = 0; r < 4; r++) drawWeaponItem(ctx, w, r, 110 + c * 195, 100 + r * 110, t + r);
        for (let r = 0; r < 4; r++) {
          const x = 60 + c * 195 + (r % 2) * 52;
          const y = 540 + Math.floor(r / 2) * 44;
          ctx.fillStyle = "rgba(255,255,255,0.05)";
          ctx.fillRect(x - 24, y - 18, 48, 36);
          drawWeaponIcon(ctx, w, r, x, y, 48, 36);
        }
      });
    },
  },
};

function canvasView(v: { w: number; h: number; draw: Draw }) {
  const c = document.createElement("canvas");
  const dpr = (window.devicePixelRatio || 1) * ZOOM;
  c.width = v.w * dpr;
  c.height = v.h * dpr;
  c.style.width = `${v.w * ZOOM}px`;
  c.style.height = `${v.h * ZOOM}px`;
  c.style.marginTop = "2.6rem";
  document.body.append(c);
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const frame = (ms: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    v.draw(ctx, LIVE ? ms / 1000 : T0);
    if (LIVE) requestAnimationFrame(frame);
  };
  void document.fonts.ready.then(() => requestAnimationFrame(frame));
}

if (VIEW === "picker") {
  const host = document.createElement("div");
  host.id = "picker";
  document.body.append(host);
  const out = document.createElement("div");
  out.style.cssText = "margin-top:1rem;font-family:Orbitron;letter-spacing:0.1em";
  const picker = mountHeroPicker(host, { selected: "nova", color: COLORS[1]!, onSelect: (id) => (out.textContent = `onSelect → ${id}`) });
  host.append(out);
  const sw = document.createElement("div");
  sw.style.cssText = "display:flex;gap:0.5rem;margin-top:1rem";
  for (const c of COLORS) {
    const b = document.createElement("button");
    b.style.cssText = `width:2rem;height:2rem;border-radius:0.5rem;background:${c};border:0;cursor:pointer`;
    b.addEventListener("click", () => picker.setColor(c));
    sw.append(b);
  }
  host.append(sw);
} else if (VIEW === "bench") {
  const out = document.createElement("div");
  out.id = "out";
  document.body.append(out);
  setTimeout(() => {
    const cold = benchmarkChibi(400, 12);
    const warm = benchmarkChibi(400, 12);
    const res = { cold, warm, cache: chibiCacheStats() };
    out.textContent = JSON.stringify(res, null, 2);
    (window as unknown as { __bench: unknown }).__bench = res;
  }, 200);
} else {
  const v = views[VIEW];
  if (v) canvasView(v);
}
