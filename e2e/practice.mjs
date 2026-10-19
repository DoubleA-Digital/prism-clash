#!/usr/bin/env node
// End-to-end: one player vs 4 bots through the whole flow, with screenshots at each stage.
//   node e2e/practice.mjs [url] [--latency 150] [--headed] [--rounds 1]
// Uses the installed Edge. Fails (exit 1) on any console error or page error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rounds = Number(opt("rounds", 1));
const latency = Number(opt("latency", 0));
const out = "e2e/out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

await page.goto(`${url}/?test=1`);
await page.waitForTimeout(1500);
await shot("01-menu");
await page.fill('input[aria-label="Your name"]', "Tester");
await page.click("text=Practice vs bots");

// Ultimate select
await page.waitForSelector(".card", { timeout: 15000 });
await page.waitForTimeout(700);
await shot("02-ult");
await page.locator(".card").first().click();
for (let r = 0; r < rounds; r++) {
  // Draft (two picks on round 1)
  for (let k = 0; k < (r === 0 ? 2 : 1); k++) {
    await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    if (r === 0 && k === 0) await shot("03-draft");
    await page.locator(".card").nth(k % 3).click();
    await page.waitForTimeout(400);
  }
  if (r === 0 && latency) {
    await page.keyboard.press("F2");
    await page.evaluate((l) => { window.__sim = l; }, latency);
  }
  await page.waitForTimeout(1800);
  await shot(`04-reveal-r${r + 1}`);
  // Fight: wiggle around, shoot toward the center, dash, use powers.
  await page.waitForTimeout(3200);
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 26000) {
    const keys = ["KeyW", "KeyA", "KeyS", "KeyD"];
    const k = keys[i % 4];
    await page.keyboard.down(k);
    await page.mouse.move(800 + Math.cos(i) * 300, 450 + Math.sin(i) * 200);
    await page.mouse.down();
    await page.waitForTimeout(350);
    await page.mouse.up();
    if (i % 5 === 0) await page.keyboard.press("Space");
    if (i % 7 === 0) await page.keyboard.press("KeyQ");
    if (i % 9 === 0) await page.keyboard.press("KeyE");
    if (i % 11 === 0) await page.keyboard.press("KeyR");
    await page.keyboard.up(k);
    if (i === 6) await shot(`05-fight-r${r + 1}a`);
    if (i === 30) await shot(`05-fight-r${r + 1}b`);
    i++;
    const phase = await page.evaluate(() => document.querySelector(".phase-title")?.textContent ?? "");
    if (phase.includes("COMPLETE")) break;
  }
  await shot(`06-late-r${r + 1}`);
}
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
