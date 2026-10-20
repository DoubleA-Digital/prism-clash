#!/usr/bin/env node
// End-to-end for v2: practice vs 11 bots on the big map. Picks an ultimate and a power,
// plays (moves, shoots, picks up, reloads, scopes, heals), grants a full kit from the F1
// test panel, and takes screenshots to e2e/out/v2-*.png.
//   node e2e/v2-play.mjs [url] [--headed] [--seconds 40]
// Uses the installed Edge. Fails (exit 1) on any console error or page error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const seconds = Number(opt("seconds", 40));
const out = "e2e/out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/v2-${opt("tag", "")}${name}.png` });
  console.log("shot", name);
};
const stats = () => page.evaluate(() => window.__prism?.stats());

await page.goto(`${url}/?test=1${opt("map", "") ? `&map=${opt("map", "")}` : ""}`);
await page.waitForTimeout(1500);
await shot("01-menu");
await page.fill('input[aria-label="Your name"]', "Tester");
await page.click("text=Practice vs bots");

await page.waitForSelector(".card", { timeout: 15000 });
await page.waitForTimeout(700);
await shot("02-ult");
await page.locator(".card").first().click();
await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
await page.waitForTimeout(600);
await shot("03-draft");
await page.locator(".card").nth(1).click();

// Countdown, then the drop.
await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 });
await page.waitForTimeout(1200);
await shot("04-drop");

const t0 = Date.now();
let i = 0;
let granted = false;
while (Date.now() - t0 < seconds * 1000) {
  const s = await stats();
  if (!s || s.phase !== "round") break;
  const keys = ["KeyW", "KeyD", "KeyS", "KeyA"];
  const k = keys[Math.floor(i / 3) % 4];
  await page.keyboard.down(k);
  await page.mouse.move(800 + Math.cos(i * 0.7) * 320, 450 + Math.sin(i * 0.7) * 220);
  if (i % 2 === 0) await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.keyboard.up(k);
  if (i % 4 === 1) await page.keyboard.press("KeyF");
  if (i % 9 === 4) await page.keyboard.press("KeyR");
  if (i % 7 === 3) await page.keyboard.press("Space");
  if (i === 6) await shot("05-explore");
  if (i === 10 && !granted && s.alive) {
    // Test room: grant a legendary gun + kit from the F1 panel.
    await page.keyboard.press("F1");
    await page.waitForTimeout(200);
    await page.click("text=Loadout");
    await page.keyboard.press("F1");
    granted = true;
    await page.waitForTimeout(300);
    await shot("06-loadout");
  }
  if (i === 14) {
    await page.keyboard.press("Digit2");
    await page.mouse.move(1300, 450);
    await page.mouse.down({ button: "right" });
    await page.waitForTimeout(500);
    await shot("07-scope-or-aim");
    await page.mouse.up({ button: "right" });
  }
  if (i === 18) {
    await page.keyboard.down("KeyH");
    await page.waitForTimeout(600);
    await shot("08-heal");
    await page.keyboard.up("KeyH");
  }
  if (i === 22) {
    await page.keyboard.down("Tab");
    await page.waitForTimeout(250);
    await shot("09-scoreboard");
    await page.keyboard.up("Tab");
  }
  if (i === 26) await page.keyboard.press("KeyG");
  if (i === 40) await shot("10-later");
  i++;
}
if (args.includes("--full")) {
  // Stand still and let the match play out: spectate once dead, then the results.
  let spectated = false;
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    const st = await stats();
    if (!st || st.phase === "matchEnd") break;
    if (!st.alive && !spectated && st.phase === "round") {
      await page.waitForTimeout(1500);
      await shot("12-spectate");
      spectated = true;
    }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2500);
  await shot("13-results");
}
const s = await stats();
console.log("stats", JSON.stringify(s));
console.log("recent", JSON.stringify(await page.evaluate(() => window.__prism?.recent())));
await shot("11-end");
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
