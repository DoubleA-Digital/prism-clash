#!/usr/bin/env node
// Netcode check: two browser tabs in one room (no bots) at simulated latency.
// Both move, dash and shoot; we measure prediction corrections, RTT and bandwidth.
//   node e2e/two-tabs.mjs [url] [--latency 150] [--jitter 30] [--loss 0] [--seconds 25]

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => Number(args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const latency = opt("latency", 150);
const jitter = opt("jitter", 30);
const loss = opt("loss", 0);
const seconds = opt("seconds", 25);
mkdirSync("e2e/out", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
const errors = [];
for (const [n, p] of [["A", a], ["B", b]]) {
  p.on("pageerror", (e) => errors.push(`${n} pageerror: ${e.message}`));
  p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${n} ${m.type()}: ${m.text()}`));
}

await a.goto(`${url}/?test=1`);
await a.fill('input[aria-label="Your name"]', "Alpha");
await a.click("text=Create room");
await a.waitForSelector(".room-code", { timeout: 10000 });
const code = (await a.textContent(".room-code"))?.trim();
console.log("room", code);
// Host turns bots off so it's a pure 1v1.
const fill = a.locator("button.switch").first();
if (await fill.evaluate((el) => el.classList.contains("on"))) await fill.click();

await b.goto(`${url}/?test=1&room=${code}`);
await b.fill('input[aria-label="Your name"]', "Bravo");
await b.click(`text=Join room ${code}`);
await b.waitForSelector(".room-code", { timeout: 10000 });
await b.click("text=I'm ready");
await a.waitForTimeout(500);
await a.click("text=Start match");

for (const p of [a, b]) {
  await p.waitForSelector(".card", { timeout: 15000 });
  await p.locator(".card").first().click();
}
for (let k = 0; k < 2; k++) {
  for (const p of [a, b]) {
    await p.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
    await p.locator(".card").nth(k).click();
  }
}
for (const p of [a, b]) await p.evaluate(([l, j, s]) => window.__prism?.setSim(l, j, s), [latency, jitter, loss]);
await a.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 20000 });
await a.waitForTimeout(800);

// Drive both players: circle-strafe, dash, shoot toward screen center.
const drive = async (p, phase) => {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const keys = ["KeyW", "KeyD", "KeyS", "KeyA"];
    const k = keys[(i + phase) % 4];
    await p.keyboard.down(k);
    await p.mouse.move(640 + Math.cos(i * 0.7) * 250, 360 + Math.sin(i * 0.7) * 180);
    await p.mouse.down();
    await p.waitForTimeout(260);
    await p.mouse.up();
    if (i % 4 === 0) await p.keyboard.press("Space");
    await p.keyboard.up(k);
    i++;
    const st = await p.evaluate(() => window.__prism?.stats());
    if (!st || st.phase !== "round") break;
  }
};
await Promise.all([drive(a, 0), drive(b, 2)]);
const sa = await a.evaluate(() => window.__prism?.stats());
const sb = await b.evaluate(() => window.__prism?.stats());
await a.screenshot({ path: "e2e/out/two-tabs-a.png" });
await b.screenshot({ path: "e2e/out/two-tabs-b.png" });
console.log("A", JSON.stringify(sa));
console.log("A recent", JSON.stringify(await a.evaluate(() => window.__prism?.recent()), (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)));
console.log("B", JSON.stringify(sb));
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
