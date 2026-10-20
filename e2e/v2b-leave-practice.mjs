#!/usr/bin/env node
// Practice: drop in, get eliminated (test-room grant), check the death screen offers
// "Back to menu" (and the Esc menu does too), press it, land on the main menu, then start a
// second practice match to show nothing was left behind.
//   node e2e/v2b-leave-practice.mjs [url] [--headed]
// Output: e2e/out/v2b-practice-*.png. Fails (exit 1) on any console/page error or a wrong turn.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const out = "e2e/out";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/v2b-practice-${name}.png` });
  console.log("shot", name);
};
const phase = () => page.evaluate(() => window.__prism?.stats().phase ?? null);
const fail = (msg) => {
  errors.push(msg);
  console.log("FAIL:", msg);
};

const playToRound = async () => {
  await page.click("text=Practice vs bots");
  await page.waitForSelector(".card", { timeout: 15000 });
  await page.locator(".card").first().click();
  await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
  await page.locator(".card").first().click();
  await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 });
};

await page.goto(`${url}/?test=1`);
await page.waitForTimeout(1200);
await page.fill('input[aria-label="Your name"]', "Tester");
await playToRound();
await page.waitForTimeout(1500);
await page.evaluate(() => window.__prism?.grant("die"));
await page.waitForSelector(".spectate-bar .leave-btn", { timeout: 8000 });
await page.waitForTimeout(1600);
const label = await page.textContent(".spectate-bar .leave-btn");
console.log("death screen button:", label);
if (label?.trim() !== "Back to menu") fail(`expected "Back to menu", got "${label}"`);
await shot("1-death");

await page.keyboard.press("Escape");
await page.waitForSelector(".esc-menu", { timeout: 3000 });
await page.waitForTimeout(400);
const escLabel = await page.textContent(".esc-menu .esc-leave");
console.log("esc menu leave:", escLabel);
if (escLabel?.trim() !== "Back to menu") fail(`Esc menu: expected "Back to menu", got "${escLabel}"`);
await shot("2-esc-menu");
await page.click(".esc-menu >> text=Resume");
await page.waitForTimeout(300);
if (await page.$(".esc-menu")) fail("Esc menu did not close on Resume");

await page.click(".spectate-bar .leave-btn");
await page.waitForFunction(() => window.__prism?.stats().phase === "menu", null, { timeout: 5000 }).catch(() => fail("did not return to the menu"));
await page.waitForSelector("text=Practice vs bots", { timeout: 5000 });
await page.waitForTimeout(800);
await shot("3-menu");
console.log("after leaving:", await phase());

// A fresh practice session starts cleanly.
await playToRound();
await page.waitForTimeout(1500);
const s = await page.evaluate(() => window.__prism?.stats());
console.log("second session:", JSON.stringify(s));
if (!s?.alive) fail("second practice session: not alive in the round");
await shot("4-second-session");

console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
