#!/usr/bin/env node
// Floor loot density check: practice on each map, screenshot the drop zone (during the
// countdown, before anyone has picked anything up) and the inside of a building.
//   node e2e/v2b-loot.mjs [url] [--tag before] [--headed]
// Output: e2e/out/v2b-loot-<tag>-<map>-*.png. Fails (exit 1) on any console or page error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const tag = opt("tag", "after");
const out = "e2e/out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
for (const map of ["neonCity", "crystalWilds"]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
  const shot = async (name) => {
    await page.screenshot({ path: `${out}/v2b-loot-${tag}-${map}-${name}.png` });
    console.log("shot", map, name);
  };
  const loot = () => page.evaluate(() => window.__prism?.lootCount?.() ?? null);
  await page.goto(`${url}/?test=1&map=${map}`);
  await page.waitForTimeout(1200);
  await page.fill('input[aria-label="Your name"]', "Tester");
  await page.click("text=Practice vs bots");
  await page.waitForSelector(".card", { timeout: 15000 });
  await page.locator(".card").first().click();
  await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
  await page.locator(".card").first().click();
  await page.waitForFunction(() => window.__prism?.stats().phase === "countdown", null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("1-drop");
  console.log(map, "visible loot at the drop:", await loot());
  await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 });
  await page.evaluate(() => window.__prism?.grant("toBuilding"));
  await page.waitForTimeout(900);
  await shot("2-building");
  console.log(map, "visible loot in a building:", await loot());
  await page.close();
}
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
