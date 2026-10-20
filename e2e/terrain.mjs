#!/usr/bin/env node
// Screenshots the dev-only terrain preview (client/terrain-preview.html) at named spots on
// both maps, plus a render benchmark.
//   pnpm -C client dev -- --port 5174     then     node e2e/terrain.mjs [http://localhost:5174] [map:spot ...]
// Output: e2e/out/terrain-<map>-<spot>.png

import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5174";
const only = args.filter((a) => a.includes(":") && !a.startsWith("http"));
const shots = only.length
  ? only
  : ["neonCity:street", "neonCity:interior", "neonCity:plaza", "neonCity:lot", "neonCity:park", "crystalWilds:river", "crystalWilds:ruins", "crystalWilds:crystals", "crystalWilds:bushes"];
mkdirSync("e2e/out", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
const errors = [];
for (const s of shots) {
  const [map, spot] = s.split(":");
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => errors.push(`${s} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${s} console: ${m.text()}`));
  await page.goto(`${url}/terrain-preview.html?map=${map}&spot=${spot}`);
  await page.waitForFunction(() => "__ready" in window, null, { timeout: 30000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `e2e/out/terrain-${map}-${spot}.png` });
  console.log("shot", `e2e/out/terrain-${map}-${spot}.png`);
  await page.close();
}
for (const map of ["neonCity", "crystalWilds"]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${url}/terrain-preview.html?map=${map}&spot=${map === "neonCity" ? "street" : "river"}&bench=1`);
  await page.waitForFunction(() => "__bench" in window, null, { timeout: 60000 });
  console.log("bench", map, JSON.stringify(await page.evaluate(() => window.__bench)));
  await page.close();
}
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
