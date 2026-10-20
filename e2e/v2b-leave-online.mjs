#!/usr/bin/env node
// Online room with two browser contexts (host Ann at 1600x900, guest Bea at 1280x720) and bots:
// Bea is eliminated, presses "Back to lobby" and watches the match progress from the lobby;
// Ann is eliminated too but stays to watch, sees the results, then heads back. Both end up in the
// lobby, Bea with her result card. The host can't start while the match runs.
//   node e2e/v2b-leave-online.mjs [url] [--headed]
// Output: e2e/out/v2b-online-*.png. Fails (exit 1) on any console/page error or a wrong turn.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const out = "e2e/out";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const fail = (msg) => {
  errors.push(msg);
  console.log("FAIL:", msg);
};
const open = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
  return page;
};
const shot = async (page, name) => {
  await page.screenshot({ path: `${out}/v2b-online-${name}.png` });
  console.log("shot", name);
};
const phase = (page) => page.evaluate(() => window.__prism?.stats().phase ?? null);
const pick = async (page) => {
  await page.waitForSelector(".card", { timeout: 20000 });
  await page.locator(".card").first().click();
  await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
  await page.locator(".card").first().click();
};

const ann = await open(1600, 900);
await ann.goto(`${url}/?test=1`);
await ann.waitForTimeout(1000);
await ann.fill('input[aria-label="Your name"]', "Ann");
await ann.click("text=Create room");
await ann.waitForSelector(".code-tile", { timeout: 10000 });
const code = await ann.$$eval(".code-tile", (els) => els.map((e) => e.textContent).join(""));
console.log("room", code);

const bea = await open(1280, 720);
await bea.goto(`${url}/?room=${code}&test=1`);
await bea.waitForTimeout(800);
await bea.fill('input[aria-label="Your name"]', "Bea");
await bea.keyboard.press("Enter");
await bea.waitForSelector(".ready-btn", { timeout: 10000 });
await bea.click(".ready-btn");
await ann.waitForFunction(() => !document.querySelector(".btn.start")?.hasAttribute("disabled"), null, { timeout: 5000 });
console.log("lobby why:", await ann.textContent(".why"));
await ann.click(".btn.start");
await Promise.all([pick(ann), pick(bea)]);
await Promise.all([ann, bea].map((p) => p.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 })));
await bea.waitForTimeout(2500);

// Bea goes down and heads back to the lobby.
await bea.evaluate(() => window.__prism?.grant("die"));
await bea.waitForSelector(".spectate-bar .leave-btn", { timeout: 8000 });
await bea.waitForTimeout(1500);
const label = (await bea.textContent(".spectate-bar .leave-btn"))?.trim();
console.log("Bea's death screen button:", label);
if (label !== "Back to lobby") fail(`expected "Back to lobby", got "${label}"`);
await shot(bea, "1-death-leave-button");
await bea.keyboard.press("Escape");
await bea.waitForSelector(".esc-menu", { timeout: 3000 });
await bea.waitForTimeout(300);
await shot(bea, "2-esc-menu-dead");
await bea.click(".esc-menu >> text=Resume");
await bea.click(".spectate-bar .leave-btn");
await bea.waitForSelector(".match-live", { timeout: 5000 }).catch(() => fail("Bea's lobby has no match panel"));
await bea.waitForTimeout(2500);
const live1 = await bea.textContent(".match-live");
await bea.waitForTimeout(2200);
const live2 = await bea.textContent(".match-live");
console.log("Bea's lobby:", live1, "->", live2);
if (live1 === live2) fail("the match clock in the lobby is not moving");
await shot(bea, "3-lobby-match-in-progress");
if ((await phase(ann)) !== "round") fail("Ann was pulled out of the match");
const annAlive = await ann.evaluate(() => window.__prism?.stats().alive);
console.log("Ann still playing:", annAlive);
await shot(ann, "4-host-still-playing");

// Ann goes down too but stays to watch.
await ann.evaluate(() => window.__prism?.grant("die"));
await ann.waitForSelector(".spectate-bar", { timeout: 8000 });
await ann.waitForTimeout(800);
const hostLobbyCheck = await bea.evaluate(() => document.querySelector(".ready-btn")?.textContent ?? "");
console.log("Bea can ready up from the lobby:", hostLobbyCheck);
await bea.click(".ready-btn");
await bea.waitForTimeout(600);

// Let the bots finish (up to 5 minutes).
const t0 = Date.now();
while (Date.now() - t0 < 5 * 60 * 1000 && (await phase(ann)) === "round") await ann.waitForTimeout(2000);
console.log(`match ended after ~${Math.round((Date.now() - t0) / 1000)} s more; Ann: ${await phase(ann)}, Bea: ${await phase(bea)}`);
await ann.waitForSelector(".matchend table.stats", { timeout: 15000 }).catch(() => fail("Ann sees no results"));
await ann.waitForTimeout(2600);
await shot(ann, "5-results-watcher");
const rows = await ann.$$eval("table.stats tr", (els) => els.length - 1);
console.log("results rows:", rows);
if (rows !== 10) fail(`expected 10 result rows, got ${rows}`);
await bea.waitForSelector(".last-result", { timeout: 5000 }).catch(() => fail("Bea has no result card"));
await bea.waitForTimeout(600);
console.log("Bea's lobby after the match:", await bea.textContent(".lobby-side"));
await shot(bea, "6-lobby-match-over-result");

// Ann (host) heads back too: everyone is in the lobby for the next match.
await ann.click("text=Back to lobby");
await ann.waitForFunction(() => window.__prism?.stats().phase === "lobby" && !!document.querySelector(".code-tile"), null, { timeout: 5000 }).catch(() => fail("Ann not back in the lobby"));
await bea.waitForTimeout(800);
const roomPhase = await bea.evaluate(() => document.querySelector(".match-live") ? "still live" : "lobby");
console.log("after Ann leaves the results:", await phase(ann), await phase(bea), roomPhase);
if (roomPhase !== "lobby") fail("the lobby still shows a match");
const canStart = await ann.evaluate(() => !document.querySelector(".btn.start")?.hasAttribute("disabled"));
console.log("host can start the next match:", canStart, "|", await ann.textContent(".why"));
await shot(ann, "7-host-lobby-after");
await shot(bea, "8-guest-lobby-after");

console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
