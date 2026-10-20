#!/usr/bin/env node
// Screenshots the dev-only chibi hero preview page (client/hero-preview.html).
//   pnpm -C client dev -- --port 5199     then     node e2e/chibi.mjs [http://localhost:5199] [view ...]
// Output: e2e/out/chibi-<view>.png, plus the micro-benchmark numbers on stdout.

import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5199";
const only = args.filter((a) => !a.startsWith("http"));
const views = only.length ? only : ["close", "lineup", "turn", "weapons", "anims", "game", "game2x", "loot", "picker", "bench"];
mkdirSync("e2e/out", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
for (const v of views) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${v} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${v} console: ${m.text()}`));
  const q = v === "game2x" ? "view=game&zoom=2" : `view=${v}`;
  await page.goto(`${url}/hero-preview.html?${q}`);
  if (v === "bench") {
    await page.waitForFunction(() => "__bench" in window, null, { timeout: 60000 });
    console.log("bench", JSON.stringify(await page.evaluate(() => window.__bench)));
  } else {
    await page.waitForTimeout(900);
    if (v === "picker") await page.click('.hero-card[data-hero="pixel"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/out/chibi-${v}.png`, fullPage: true });
    console.log("shot", `e2e/out/chibi-${v}.png`);
  }
  await ctx.close();
}
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
