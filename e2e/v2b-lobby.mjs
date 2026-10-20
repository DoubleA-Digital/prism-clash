#!/usr/bin/env node
// A full 10-player lobby: the host creates a room, nine guests join through the invite link
// (some ready up, one swaps color), an eleventh is turned away. Screenshots the host's lobby at
// 1600x900 and 1280x720, plus a 3-player lobby (open seats + bot fill text).
//   node e2e/v2b-lobby.mjs [url] [--guests 9]
// Output: e2e/out/v2b-lobby-*.png. Fails (exit 1) on any console or page error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const guests = Number(opt("guests", 9));
const out = "e2e/out";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const open = async (w = 1600, h = 900) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${m.type()}: ${m.text()}`));
  return page;
};
const NAMES = ["Nova", "Blitz", "Kestrel", "Juno", "Rook", "Sable", "Vega", "Pixel", "Lumen", "Extra"];

const host = await open();
await host.goto(url);
await host.waitForTimeout(1000);
await host.fill('input[aria-label="Your name"]', "Hostess");
await host.click("text=Create room");
await host.waitForSelector(".code-tile", { timeout: 10000 });
const code = await host.$$eval(".code-tile", (els) => els.map((e) => e.textContent).join(""));
console.log("room", code);

const pages = [];
const join = async (name) => {
  const p = await open(1280, 720);
  await p.goto(`${url}/?room=${code}`);
  await p.waitForTimeout(700);
  await p.fill('input[aria-label="Your name"]', name);
  await p.keyboard.press("Enter");
  return p;
};
for (let i = 0; i < Math.min(2, guests); i++) pages.push(await join(NAMES[i]));
await Promise.all(pages.map((p) => p.waitForSelector(".code-tile", { timeout: 10000 })));
await pages[0]?.click(".ready-btn");
await host.waitForTimeout(800);
await host.screenshot({ path: `${out}/v2b-lobby-3p-1600.png` });
console.log("3p why:", await host.$eval(".why", (e) => e.textContent));

for (let i = 2; i < guests; i++) pages.push(await join(NAMES[i]));
await Promise.all(pages.map((p) => p.waitForSelector(".code-tile", { timeout: 10000 })));
for (const [i, p] of pages.entries()) if (i > 0 && i % 2 === 0) await p.click(".ready-btn");
await pages[3]?.locator(".swatch:not(.taken):not(.on)").first().click().catch(() => {});
await host.waitForTimeout(1200);
await host.screenshot({ path: `${out}/v2b-lobby-10p-1600.png` });
await pages[1]?.screenshot({ path: `${out}/v2b-lobby-10p-guest-1280.png` });
await host.setViewportSize({ width: 1280, height: 720 });
await host.waitForTimeout(700);
await host.screenshot({ path: `${out}/v2b-lobby-10p-1280.png` });
const overflow = await host.evaluate(() => {
  const s = document.querySelector(".lobby-screen");
  return s ? { scrollH: s.scrollHeight, clientH: s.clientHeight, rows: document.querySelectorAll(".slot:not(.empty)").length } : null;
});
console.log("host lobby at 1280x720:", JSON.stringify(overflow));
console.log("colors:", JSON.stringify(await host.$$eval(".slot:not(.empty)", (els) => els.map((e) => e.style.getPropertyValue("--c")))));

// An eleventh player is turned away.
const extra = await open(1280, 720);
await extra.goto(`${url}/?room=${code}`);
await extra.waitForTimeout(700);
await extra.fill('input[aria-label="Your name"]', NAMES[9]);
await extra.keyboard.press("Enter");
await extra.waitForTimeout(1200);
const full = await extra.evaluate(() => document.body.innerText.match(/room is full[^.]*/i)?.[0] ?? null);
console.log("11th player:", full ?? "NOT turned away");
if (guests >= 9 && !full) errors.push("an 11th player got in");
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
