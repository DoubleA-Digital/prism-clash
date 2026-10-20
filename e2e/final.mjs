#!/usr/bin/env node
// Showcase screenshots for v2 (heroes, terrain, HUD, flow) to e2e/out/final-*.png.
//   node e2e/final.mjs [url] [--map neonCity|crystalWilds] [--lobby] [--full] [--headed]
// --lobby  also shoots the menu, the lobby with the hero picker and the draft.
// --full   plays on until you're eliminated (spectate shot) and the match ends (results shot).
// Practice runs in a test room, so it uses the F1 helpers (window.__prism.grant) to jump into
// a building, next to a fight, and to open a Prism Shard draft. Fails on console errors.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const map = opt("map", "neonCity");
const tag = map === "crystalWilds" ? "wilds" : "city";
const out = "e2e/out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/final-${name}.png` });
  console.log("shot", `${out}/final-${name}.png`);
};
const stats = () => page.evaluate(() => window.__prism?.stats());
const grant = (g) => page.evaluate((x) => window.__prism?.grant(x), g);
const foe = () => page.evaluate(() => window.__prism?.foe());
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${url}/?test=1&map=${map}`);
await wait(1500);
if (args.includes("--lobby")) {
  await shot("01-menu");
  await page.click("text=How to play");
  await wait(900);
  await shot("04-howto");
  await page.mouse.wheel(0, 900);
  await wait(500);
  await shot("04-howto-tips");
  await page.keyboard.press("Escape");
  await wait(500);
  await page.fill('input[aria-label="Your name"]', "Tester");
  await page.click("text=Create room");
  await page.waitForSelector(".lobby .hero-card", { timeout: 15000 });
  await wait(900);
  await page.click('.lobby .hero-card[data-hero="vex"]');
  await wait(700);
  await shot("02-lobby");
  await page.click("text=Leave room");
  await wait(800);
} else {
  await page.fill('input[aria-label="Your name"]', "Tester");
}

await page.click("text=Practice vs bots");
await page.waitForSelector(".card", { timeout: 15000 });
await wait(600);
await page.locator(".card").first().click();
await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
await wait(700);
if (args.includes("--lobby")) await shot("03-draft");
await page.locator(".card").nth(1).click();
await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 });
await wait(400);
await shot(`${tag}-drop`);
await wait(1200);

/** Walk a little (and pick things up) for `n` steps. */
async function roam(n, start = 0) {
  const keys = ["KeyW", "KeyD", "KeyS", "KeyA"];
  for (let i = start; i < start + n; i++) {
    const k = keys[Math.floor(i / 2) % 4];
    await page.keyboard.down(k);
    await page.mouse.move(800 + Math.cos(i * 0.7) * 300, 450 + Math.sin(i * 0.7) * 200);
    await wait(320);
    await page.keyboard.up(k);
    await page.keyboard.press("KeyF");
  }
}

/** Aim at the nearest enemy and fire in bursts for `ms`. */
async function fight(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const f = await foe();
    if (f) await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    await wait(180);
    await page.mouse.up();
    await wait(60);
  }
}

await roam(6);
await shot(`${tag}-explore`);
await grant("loadout");
await wait(300);
await grant("toFight");
await wait(700);
await fight(1600);
await page.mouse.down();
await wait(250);
await shot(`${tag}-fight`);
await page.mouse.up();
await fight(1500);

if (map === "neonCity") {
  // Crystal Wilds has no roofed buildings (its ruins are open-air).
  await grant("toBuilding");
  await wait(1100);
  await page.mouse.move(1150, 380);
  await shot(`${tag}-interior`);
}

// Scope: the debug loadout cycles rifle → shotgun → sniper.
await grant("loadout");
await wait(150);
await grant("loadout");
await wait(300);
await page.keyboard.press("Digit2");
await page.mouse.move(1350, 400);
await page.mouse.down({ button: "right" });
await wait(700);
await shot(`${tag}-scope`);
await page.mouse.up({ button: "right" });

// Heal: hold H (a bandage or medkit if hurt; otherwise the shield cell kit shows on the HUD).
await page.keyboard.down("KeyH");
await wait(900);
await shot(`${tag}-heal`);
await page.keyboard.up("KeyH");

await grant("shard");
await page.waitForSelector(".shard-overlay .card", { timeout: 5000 }).catch(() => null);
await wait(700);
await shot(`${tag}-shard`);
const card = page.locator(".shard-overlay .card").first();
if (await card.count()) await card.click();
await wait(500);

await roam(8, 20);
await shot(`${tag}-later`);

if (args.includes("--full")) {
  // Seek fights without shooting back until eliminated, then watch and wait for the results.
  let spectated = false;
  const until = Date.now() + 11 * 60 * 1000;
  while (Date.now() < until) {
    const st = await stats();
    if (!st || st.phase === "matchEnd") break;
    if (st.alive) {
      await grant("toFight");
      await wait(2500);
    } else if (!spectated && st.phase === "round") {
      await wait(1800);
      await shot(`${tag}-spectate`);
      spectated = true;
    } else await wait(1000);
  }
  await wait(3000);
  await shot(`${tag}-results`);
}
console.log("stats", JSON.stringify(await stats()));
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
