// How to Play, v2 survival guide: small illustrated tip cards (looting, rarity, reload, heals
// and shields, throwables, line of sight, bushes, Prism Shards, the ultimate, ghosts). Every
// illustration is drawn in code with the same art the game uses.

import { HERO_IDS, ITEMS, PLAYER_COLORS, RARITY, WEAPONS, type HeroId, type ThrowableId, type WeaponId } from "@prism/shared";
import { keyLabel, type Action, type Input } from "../input/input";
import { drawWeaponIcon, drawWeaponItem } from "../render/chibi";
import { drawGlow, withAlpha } from "../render/glow";
import { drawItemGlyph, itemColor } from "../render/items";
import { h } from "./dom";
import { portraitImage } from "./heroPortrait";

const DEMO_W = 220;
const DEMO_H = 74;

/** A crisp canvas for a tip illustration, painted once in CSS-pixel units. */
function demo(paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement("canvas");
  c.className = "tip-art";
  c.width = Math.round(DEMO_W * dpr);
  c.height = Math.round(DEMO_H * dpr);
  c.setAttribute("aria-hidden", "true");
  const g = c.getContext("2d");
  if (g) {
    g.scale(dpr, dpr);
    paint(g, DEMO_W, DEMO_H);
  }
  return c;
}

const hex = (i: number) => PLAYER_COLORS[i]?.hex ?? "#00F0FF";

function hero(g: CanvasRenderingContext2D, id: HeroId, color: string, x: number, y: number, size: number, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(portraitImage(id, color, size * 2), x - size / 2, y - size / 2, size, size);
  g.restore();
}

function glyph(g: CanvasRenderingContext2D, kind: Parameters<typeof drawItemGlyph>[1], x: number, y: number, r: number, throwable: ThrowableId = "frag") {
  drawGlow(g, x, y, r * 3, itemColor(kind, throwable), 0.5);
  g.save();
  g.translate(x, y);
  drawItemGlyph(g, kind, r, throwable, 0);
  g.restore();
}

function keyCap(g: CanvasRenderingContext2D, label: string, x: number, y: number, color: string) {
  g.save();
  g.font = "800 15px 'JetBrains Mono', monospace";
  const w = Math.max(34, g.measureText(label).width + 18);
  drawGlow(g, x, y, w, color, 0.45);
  g.fillStyle = "#16143f";
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(x - w / 2, y - 16, w, 32, 8);
  g.fill();
  g.stroke();
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, x, y + 1);
  g.restore();
}

const artLoot = () =>
  demo((g, w, h) => {
    const items: [WeaponId, number][] = [["pistol", 0], ["smg", 1], ["shotgun", 2], ["rifle", 3]];
    items.forEach(([id, r], i) => drawWeaponItem(g, id, r, (w / items.length) * (i + 0.5), h / 2 + 2, i * 0.7));
  });

const artReload = () =>
  demo((g, w, h) => {
    drawWeaponIcon(g, "rifle", 2, w * 0.36, h / 2, 110, 40);
    g.save();
    g.font = "800 22px 'JetBrains Mono', monospace";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.fillText("0", w * 0.66, h / 2);
    g.fillStyle = "rgba(200,205,240,0.6)";
    g.font = "700 14px 'JetBrains Mono', monospace";
    g.fillText("/ 90", w * 0.66 + 16, h / 2 + 2);
    g.strokeStyle = "#ffd34d";
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    g.arc(w * 0.86, h / 2, 13, -Math.PI / 2, Math.PI * 1.1);
    g.stroke();
    g.restore();
  });

const artHeals = () =>
  demo((g, w, h) => {
    glyph(g, "bandage", w * 0.22, h / 2, 13);
    glyph(g, "medkit", w * 0.5, h / 2, 15);
    glyph(g, "shield", w * 0.78, h / 2, 14);
  });

const artThrow = () =>
  demo((g, w, h) => {
    const kinds: ThrowableId[] = ["frag", "smoke", "mine"];
    kinds.forEach((k, i) => glyph(g, "throwable", w * (0.22 + i * 0.28), h / 2, 13, k));
  });

const artSight = () =>
  demo((g, w, h) => {
    const vx = w * 0.18;
    const vy = h * 0.55;
    const x0 = w * 0.45;
    const x1 = w * 0.55;
    const y0 = h * 0.22;
    const y1 = h * 0.78;
    // Shadow cast away from the viewer by the wall.
    const far = 400;
    const ext = (px: number, py: number) => {
      const d = Math.hypot(px - vx, py - vy) || 1;
      return [px + ((px - vx) / d) * far, py + ((py - vy) / d) * far] as const;
    };
    const [ax, ay] = ext(x0, y0);
    const [bx, by] = ext(x0, y1);
    g.fillStyle = "rgba(3,3,14,0.75)";
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(ax, ay);
    g.lineTo(bx, by);
    g.lineTo(x0, y1);
    g.closePath();
    g.fill();
    hero(g, "vex", hex(1), w * 0.8, h * 0.52, 44, 0.25);
    g.fillStyle = "#1d1f4d";
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = "#7CF6FF";
    g.lineWidth = 2;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    hero(g, "blaze", hex(0), vx, vy - 4, 44);
  });

const artBush = () =>
  demo((g, w, h) => {
    hero(g, "glitch", hex(2), w * 0.5, h * 0.5, 46);
    const blobs: [number, number, number, string][] = [
      [-30, 8, 20, "#0e4a3f"], [28, 10, 20, "#0e4a3f"], [0, 14, 24, "#13604f"], [-14, -6, 18, "#13604f"], [16, -4, 18, "#17725d"], [0, 2, 16, "#1d8a6e"],
    ];
    g.save();
    g.globalAlpha = 0.93;
    for (const [dx, dy, r, c] of blobs) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(w * 0.5 + dx, h * 0.5 + dy, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.strokeStyle = withAlpha("#5dffbe", 0.5);
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(w * 0.5, h * 0.55, 40, 0, Math.PI * 2);
    g.stroke();
  });

const artShard = () =>
  demo((g, w, h) => {
    glyph(g, "shard", w * 0.5, h / 2, 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      drawGlow(g, w * 0.5 + Math.cos(a) * 34, h / 2 + Math.sin(a) * 22, 6, "#ff7bf2", 0.8);
    }
  });

const artUlt = (label: string) =>
  demo((g, w, h) => {
    g.save();
    g.strokeStyle = withAlpha("#ffd34d", 0.85);
    g.lineWidth = 4;
    g.beginPath();
    g.arc(w * 0.5, h / 2, 28, -Math.PI / 2, Math.PI * 1.5);
    g.stroke();
    g.restore();
    keyCap(g, label, w * 0.5, h / 2, "#ffd34d");
  });

const artGhost = () =>
  demo((g, w, h) => {
    g.fillStyle = "rgba(255,120,40,0.85)";
    drawGlow(g, w * 0.66, h * 0.72, 40, "#ff6a1c", 0.7);
    g.beginPath();
    g.ellipse(w * 0.66, h * 0.72, 30, 9, 0, 0, Math.PI * 2);
    g.fill();
    hero(g, HERO_IDS[5] ?? "pixel", hex(4), w * 0.36, h * 0.46, 48, 0.45);
  });

/** The survival tips grid for the How to Play "Basics" tab. */
export function survivalTips(input: Input): HTMLElement {
  const kl = (a: Action) => keyLabel(input.binds[a]);
  const tip = (art: HTMLCanvasElement, title: string, text: string) => h("div.tip", null, h("div.demo", null, art), h("h4", null, title), h("p", null, text));
  return h(
    "div.tips",
    null,
    tip(artLoot(), "LOOT EVERYTHING", `You drop in with a pistol. Ammo, heals and shields pick up as you walk over them; press ${kl("interact")} to grab a gun (or swap it for the one in hand). Shoot crates open for more.`),
    tip(artReload(), "RELOAD + SWAP", `${kl("reload")} reloads (an empty magazine reloads by itself). Carry two guns: ${kl("slot1")}/${kl("slot2")} or the mouse wheel to switch. Ammo boxes refill your reserve.`),
    tip(artHeals(), "HEALS + SHIELDS", `Hold ${kl("heal")} to bandage (+${ITEMS.bandage.heal}) or use a medkit (+${ITEMS.medkit.heal}). You move slowly and shooting cancels it. Shield Cells absorb damage first, up to ${ITEMS.shield.max}.`),
    tip(artThrow(), "THROWABLES", `${kl("throw")} throws what you carry: a frag grenade blows up after a short fuse, smoke blocks everyone's sight, and a shock mine zaps and slows whoever steps on it.`),
    tip(artSight(), "LINE OF SIGHT", "Walls, rocks and crystals cast shadows. You can't see around corners, and nobody sees you either. Hold angles, flank, and listen for footsteps."),
    tip(artBush(), "BUSHES", "Step into a bush to vanish from anyone who isn't right next to you. Firing gives your spot away, so pick the moment."),
    tip(artShard(), "PRISM SHARDS", "Rare shards in crates and supply drops open the draft cards mid-match without pausing: take a second power, or swap one out."),
    tip(artUlt(kl("ult")), "ULTIMATE", `Your ultimate charges as you deal and take damage. When the meter glows, press ${kl("ult")}. ${kl("p1")} and ${kl("p2")} cast your two powers.`),
    tip(artGhost(), "GHOSTS HAUNT", `Out? Watch your killer or switch with the arrows. Every 10s drop lava (${kl("p1")}) or a slow field (${kl("p2")}) at your cursor.`),
  );
}

/** Rarity chips: the tier color, a sample gun glowing in it, and the damage bonus. */
export function rarityChips(): HTMLElement {
  return h(
    "div.scoring.rarity-chips",
    null,
    RARITY.map((r, i) => {
      const art = document.createElement("canvas");
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      art.width = Math.round(96 * dpr);
      art.height = Math.round(36 * dpr);
      art.style.width = "6rem";
      art.style.height = "2.25rem";
      const g = art.getContext("2d");
      if (g) {
        g.scale(dpr, dpr);
        drawWeaponIcon(g, "rifle", i, 48, 18, 92, 34);
      }
      return h(
        `div.score-chip.rarity${i === 3 ? ".gold" : ""}`,
        { style: { "--rc": r.color, color: r.color } },
        art,
        h("div.pl-n", null, r.name.toUpperCase()),
        h("div.pts", null, i === 0 ? "BASE" : `+${Math.round((r.damage - 1) * 100)}%`),
        h("div.sub", null, i === 0 ? `rifle: ${WEAPONS.rifle.mag}-round mag` : `damage · mag ×${r.mag}`),
      );
    }),
  );
}
