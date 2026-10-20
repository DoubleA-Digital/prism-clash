#!/usr/bin/env node
// Before/after floor loot on the same map seeds: builds each World in the browser (through the
// Vite dev server) once with the old loot numbers (spot fill 0.85, 2 items per crate, no
// stacking) and once with the current ones, and draws both side by side: walls, crates (brown)
// and every loot pile (weapons in their rarity color, ammo yellow, heals green, shields blue,
// grenades orange, shards pink).
//   node e2e/v2b-loot-map.mjs [url] [--seed 7]
// Output: e2e/out/v2b-loot-map-<map>.png

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const seed = Number(opt("seed", 7));
const out = "e2e/out";
mkdirSync(out, { recursive: true });
const shared = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)).replace(/\\/g, "/");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1640, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`${url}/?test=1`);
await page.waitForTimeout(800);
for (const map of ["neonCity", "crystalWilds"]) {
  const summary = await page.evaluate(
    async ({ path, map, seed }) => {
      const S = await import(/* @vite-ignore */ `/@fs/${path}`);
      const now = { spotFill: S.LOOT.spotFill, crateRolls: S.LOOT.crateRolls, crateBonusChance: S.LOOT.crateBonusChance, stackRadius: S.LOOT.stackRadius };
      const old = { spotFill: 0.85, crateRolls: 2, crateBonusChance: 0, stackRadius: 0 };
      const W = 800;
      const H = 860;
      document.body.replaceChildren();
      const c = document.createElement("canvas");
      c.width = W * 2 + 40;
      c.height = H;
      c.style.cssText = "position:fixed;left:0;top:0;z-index:99";
      document.body.append(c);
      const g = c.getContext("2d");
      g.fillStyle = "#07061a";
      g.fillRect(0, 0, c.width, c.height);
      const col = { ammo: "#ffd34d", bandage: "#7dffb0", medkit: "#5dff9d", shield: "#5fd0ff", throwable: "#ff8a2b", shard: "#ff7bf2" };
      const res = [];
      [old, now].forEach((cfg, k) => {
        Object.assign(S.LOOT, cfg);
        const w = new S.World(map, seed);
        // Break every crate so its drops show too.
        const crates = w.map.solids.filter((s) => s.kind === "crate");
        const before = w.loot.size;
        for (const s of crates) w.damageSolid(s, 9999, 0, true);
        const half = w.map.half;
        const sc = (W - 40) / (half * 2);
        const ox = k * (W + 40) + 20;
        const oy = 60;
        const X = (x) => ox + (x + half) * sc;
        const Y = (y) => oy + (y + half) * sc;
        g.fillStyle = "#11102e";
        g.fillRect(X(-half), Y(-half), half * 2 * sc, half * 2 * sc);
        for (const s of w.map.solids) {
          if (s.kind === "crate") continue;
          g.fillStyle = s.kind === "wall" || s.kind === "rock" || s.kind === "crystal" ? "#3b3f7a" : "#262a55";
          g.fillRect(X(s.x0), Y(s.y0), Math.max(1, (s.x1 - s.x0) * sc), Math.max(1, (s.y1 - s.y0) * sc));
        }
        for (const s of crates) {
          g.strokeStyle = "#a8743a";
          g.lineWidth = 1.5;
          g.strokeRect(X(s.x0), Y(s.y0), Math.max(2, (s.x1 - s.x0) * sc), Math.max(2, (s.y1 - s.y0) * sc));
        }
        let weapons = 0;
        for (const l of w.loot.values()) {
          if (l.dead) continue;
          if (l.kind === "weapon") weapons++;
          g.fillStyle = l.kind === "weapon" ? S.RARITY[l.rarity].color : col[l.kind] ?? "#fff";
          g.beginPath();
          g.arc(X(l.x), Y(l.y), l.kind === "weapon" ? 3.4 : 2.4, 0, Math.PI * 2);
          g.fill();
        }
        const label = `${k === 0 ? "BEFORE" : "AFTER"}  floor ${before}  + crate drops ${w.loot.size - before} = ${w.loot.size} piles (${weapons} guns, ${crates.length} crates)`;
        g.fillStyle = "#fff";
        g.font = "700 17px system-ui";
        g.fillText(`${map} seed ${seed}`, ox, 26);
        g.font = "600 15px system-ui";
        g.fillStyle = k === 0 ? "#ffb066" : "#9dff3a";
        g.fillText(label, ox, 48);
        res.push(label);
      });
      Object.assign(S.LOOT, now);
      return res;
    },
    { path: shared, map, seed },
  );
  console.log(summary.join("\n"));
  await page.screenshot({ path: `${out}/v2b-loot-map-${map}.png`, clip: { x: 0, y: 0, width: 1640, height: 860 } });
}
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
