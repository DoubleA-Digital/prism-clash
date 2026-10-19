#!/usr/bin/env node
// Live UI flow vs bots: menu -> ult select -> draft -> reveal -> fight -> standings -> round 2 draft.
// Exercises the real screens (keyboard hotkeys, locked state, standings animation) and screenshots them.
//   node e2e/ui-flow.mjs [url]     Output: e2e/out/ui-flow-*.png

import { chromium } from "playwright-core";

const url = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `e2e/out/ui-flow-${n}.png` }).then(() => console.log("shot", n));
const title = () => page.evaluate(() => document.querySelector(".phase-title")?.textContent ?? "");

await page.goto(`${url}/?test=1`);
await page.waitForTimeout(1200);
await page.fill('input[aria-label="Your name"]', "Tester");
// Keyboard-only: Tab/arrow focus to Practice, press Enter.
await page.click("text=Practice vs bots");
// Pick through whatever pick screens appear (ultimate, draft x2) until the loadout reveal shows up.
await page.waitForSelector(".card", { timeout: 15000 });
let shots = 0;
let lastKey = "";
for (let n = 0; n < 150 && !(await page.$(".rv")); n++) {
  const state = await page.evaluate(() => ({
    title: document.querySelector(".phase-title")?.textContent ?? "",
    hint: document.querySelector(".pick-head .hint")?.textContent ?? "",
    open: document.querySelectorAll(".card:not(.picked):not(.dim)").length,
  }));
  const key = `${state.title}|${state.hint}`;
  if (state.open > 0 && key !== lastKey) {
    lastKey = key;
    await page.waitForTimeout(1100);
    await shot(`pick-${++shots}`);
    await page.keyboard.press("2"); // hotkey pick
    await page.waitForTimeout(250);
    await shot(`pick-${shots}-locked`);
  }
  await page.waitForTimeout(200);
}
await page.waitForSelector(".rv", { timeout: 15000 });
await page.waitForTimeout(1500);
await shot("reveal");

if (process.argv.includes("--quick")) {
  console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}
// Fight until the round ends (standings), wiggling and shooting.
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < 110000 && !(await title()).includes("COMPLETE")) {
  const k = ["KeyW", "KeyA", "KeyS", "KeyD"][i % 4];
  await page.keyboard.down(k);
  await page.mouse.move(800 + Math.cos(i) * 300, 450 + Math.sin(i) * 200);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  if (i % 4 === 0) await page.keyboard.press("Space");
  if (i % 6 === 0) await page.keyboard.press("KeyQ");
  if (i % 8 === 0) await page.keyboard.press("KeyE");
  if (i === 5) {
    await page.keyboard.down("Tab");
    await page.waitForTimeout(400);
    await shot("scoreboard");
    await page.keyboard.up("Tab");
  }
  await page.keyboard.up(k);
  i++;
}
console.log("round ended after", Math.round((Date.now() - t0) / 1000), "s:", await title());
await page.waitForTimeout(3300);
await shot("standings");
await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT"), null, { timeout: 30000 });
await page.waitForTimeout(800);
await shot("draft-r2");
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
