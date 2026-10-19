#!/usr/bin/env node
// Visual check for the ultimates: practice vs bots in a test room, then for each ultimate
// grant it (full charge) from the F1 debug panel, fire it with R and screenshot it mid-flight.
//   node e2e/ultimates.mjs [url] [--headed] [--only meteorRain,riftCollapse]
// Screenshots land in e2e/out/ult-*.png. Fails (exit 1) on any page error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const out = "e2e/out";
mkdirSync(out, { recursive: true });

/** Each ultimate: its panel button title, extra keys after casting, and when to screenshot (s after cast). */
const ULTS = [
  { id: "huntersEye", title: "Hunter's Eye", shots: [0.7, 1.6], fire: true },
  { id: "meteorRain", title: "Meteor Rain", shots: [0.45, 1.3, 2.4] },
  { id: "overdrive", title: "Overdrive", shots: [0.5, 1.4], fire: true },
  { id: "riftCollapse", title: "Rift Collapse", shots: [0.8, 2.5, 3.08] },
  { id: "echoStorm", title: "Echo Storm", shots: [0.55, 1.2], afterCast: ["KeyQ", "KeyE"], move: "KeyA" },
  { id: "finalStand", title: "Final Stand", shots: [0.9, 2.6, 3.06] },
].filter((u) => !only || only.has(u.id));

const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

await page.goto(`${url}/?test=1`);
await page.waitForTimeout(1200);
await page.fill('input[aria-label="Your name"]', "Tester");
await page.click("text=Practice vs bots");
await page.waitForSelector(".card", { timeout: 15000 });
await page.waitForTimeout(500);
await page.locator(".card").first().click();
for (let k = 0; k < 2; k++) {
  await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.locator(".card").nth(k).click();
  await page.waitForTimeout(300);
}
// Wait for the round to start (countdown over).
await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 });
await page.waitForTimeout(3500);
await page.keyboard.press("F1");
await page.waitForTimeout(400);

// Keep the tester alive through the bots' focus fire: tap Heal in the debug panel constantly.
await page.evaluate(() => {
  setInterval(() => {
    const heal = [...document.querySelectorAll(".debugpanel button")].find((b) => b.textContent?.trim().toLowerCase() === "heal");
    heal?.click();
  }, 300);
});

const panelClick = async (sel) => {
  const el = page.locator(`.debugpanel ${sel}`).first();
  await el.click();
  await page.mouse.move(1150, 430);
};

for (const u of ULTS) {
  if (!(await page.evaluate(() => window.__prism?.stats().alive))) {
    console.log("player is dead, stopping");
    break;
  }
  await panelClick('button:has-text("Heal")');
  await panelClick(`button[title="${u.title}"]`);
  await page.waitForTimeout(250);
  await page.mouse.move(1150, 430);
  await page.keyboard.press("KeyR");
  const t0 = Date.now();
  if (u.fire) await page.mouse.down();
  if (u.move) await page.keyboard.down(u.move);
  for (const k of u.afterCast ?? []) {
    await page.waitForTimeout(80);
    await page.keyboard.press(k);
  }
  for (const [i, s] of u.shots.entries()) {
    const wait = s * 1000 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/ult-${u.id}-${i + 1}.png` });
    console.log("shot", u.id, i + 1);
  }
  if (u.fire) await page.mouse.up();
  if (u.move) await page.keyboard.up(u.move);
  await page.waitForTimeout(1500);
}

console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
