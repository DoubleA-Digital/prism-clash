#!/usr/bin/env node
// Real two-tab lobby: host creates a room, a second player joins via the invite link, changes color
// and readies up; screenshots both sides. Also checks keyboard navigation on the menu.
//   node e2e/ui-lobby.mjs [url]     Output: e2e/out/ui-lobby-*.png

import { chromium } from "playwright-core";

const url = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const open = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
  return { ctx, page, name };
};

const a = await open("Host");
await a.page.goto(url);
await a.page.waitForTimeout(1200);
// Keyboard navigation: type a name, arrow down to focus the next control, and show the focus state.
await a.page.fill('input[aria-label="Your name"]', "Hostess");
await a.page.keyboard.press("ArrowDown");
await a.page.waitForTimeout(400);
await a.page.screenshot({ path: "e2e/out/ui-lobby-menu-focus.png" });
await a.page.keyboard.press("Enter"); // Create room
await a.page.waitForSelector(".code-tile", { timeout: 10000 });
const code = (await a.page.$$eval(".code-tile", (els) => els.map((e) => e.textContent).join("")));
console.log("room code", code);

const b = await open("Guest");
await b.page.goto(`${url}/?room=${code}`);
await b.page.waitForTimeout(1000);
await b.page.fill('input[aria-label="Your name"]', "Guesty");
await b.page.keyboard.press("Enter");
await b.page.waitForSelector(".code-tile", { timeout: 10000 });
await b.page.waitForTimeout(600);
await b.page.locator(".swatch:not(.taken):not(.on)").first().click();
await b.page.waitForTimeout(300);
await b.page.click(".ready-btn");
await a.page.waitForTimeout(900);
await a.page.click("text=Copy invite link");
await a.page.waitForTimeout(400);
await a.page.screenshot({ path: "e2e/out/ui-lobby-host-live.png" });
await b.page.screenshot({ path: "e2e/out/ui-lobby-guest-live.png" });
console.log("start enabled:", await a.page.evaluate(() => !document.querySelector(".btn.start")?.hasAttribute("disabled")));
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
