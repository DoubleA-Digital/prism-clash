#!/usr/bin/env node
// The static (Vercel-style) build with no game server: Practice vs Bots runs in the in-browser
// worker all the way to the results screen, and Create Room shows the friendly offline message.
//   pnpm -C client build && npx serve -s client/dist -l 4321
//   node e2e/static.mjs [url] [--prefix static] [--server ws://localhost:8787/ws] [--headed]
// --server: instead of the offline check, opens ?server=... and checks an online room is created.
// Screenshots go to e2e/out/<prefix>-*.png. Fails on console errors during practice, on any
// WebSocket opened during practice, or on janky frame timing.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:4321";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const prefix = opt("prefix", "static");
const server = opt("server", "");
const out = "e2e/out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const failures = [];

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  const sockets = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
  page.on("websocket", (ws) => sockets.push(ws.url()));
  page.on("worker", (w) => console.log("worker started:", w.url().split("/").pop()));
  // Frame timing: every requestAnimationFrame delta, from page load on.
  await page.addInitScript(() => {
    const w = window;
    w.__frames = [];
    let last = 0;
    const loop = (t) => {
      if (last) w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return { page, errors, sockets };
}

const shotOf = (page) => async (name) => {
  const path = `${out}/${prefix}-${name}.png`;
  await page.screenshot({ path });
  console.log("shot", path);
};

if (!server) {
  // ---- 1. Practice vs Bots, offline, to the results screen -------------------------------
  const { page, errors, sockets } = await newPage();
  const shot = shotOf(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const stats = () => page.evaluate(() => window.__prism?.stats());
  const grant = (g) => page.evaluate((x) => window.__prism?.grant(x), g);
  const foe = () => page.evaluate(() => window.__prism?.foe());
  const frames = async (label) => {
    const f = await page.evaluate(() => {
      const d = window.__frames.splice(0).slice(5);
      d.sort((a, b) => a - b);
      const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))] ?? 0;
      return { n: d.length, mean: d.reduce((a, b) => a + b, 0) / Math.max(1, d.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d[d.length - 1] ?? 0, over50: d.filter((x) => x > 50).length };
    });
    console.log(`frames ${label}: n=${f.n} mean=${f.mean.toFixed(1)}ms p50=${f.p50.toFixed(1)} p95=${f.p95.toFixed(1)} p99=${f.p99.toFixed(1)} max=${f.max.toFixed(1)} >50ms=${f.over50}`);
    return f;
  };

  await page.goto(`${url}/?test=1`);
  await wait(1500);
  await shot("01-menu");
  await page.fill('input[aria-label="Your name"]', "Tester");
  await page.evaluate(() => window.__frames.splice(0));
  await page.click("text=Practice vs bots");
  await page.waitForSelector(".card", { timeout: 15000 });
  await wait(700);
  await shot("02-ult");
  await page.locator(".card").first().click();
  await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
  await wait(700);
  await shot("03-draft");
  await page.locator(".card").nth(1).click();
  // The countdown is when the worker builds the bots' nav grid: the page must keep rendering smoothly.
  await page.waitForFunction(() => window.__prism?.stats().phase === "countdown", null, { timeout: 30000 });
  await page.evaluate(() => window.__frames.splice(0));
  await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 });
  const countdown = await frames("countdown (nav build in worker)");
  await wait(400);
  await shot("04-drop");

  const roam = async (n) => {
    const keys = ["KeyW", "KeyD", "KeyS", "KeyA"];
    for (let i = 0; i < n; i++) {
      const k = keys[Math.floor(i / 2) % 4];
      await page.keyboard.down(k);
      await page.mouse.move(800 + Math.cos(i * 0.7) * 300, 450 + Math.sin(i * 0.7) * 200);
      await wait(320);
      await page.keyboard.up(k);
      await page.keyboard.press("KeyF");
    }
  };
  const fight = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const f = await foe();
      if (f) await page.mouse.move(f.x, f.y);
      await page.mouse.down();
      await wait(180);
      await page.mouse.up();
      await wait(60);
    }
  };

  await page.evaluate(() => window.__frames.splice(0));
  await roam(6);
  await shot("05-explore");
  await grant("loadout");
  await wait(300);
  await grant("toFight");
  await wait(700);
  await fight(2500);
  await shot("06-fight");
  await grant("shard");
  await page.waitForSelector(".shard-overlay .card", { timeout: 5000 }).catch(() => null);
  await wait(700);
  await shot("07-shard");
  const card = page.locator(".shard-overlay .card").first();
  if (await card.count()) await card.click();
  await fight(2000);
  const round = await frames("round");
  const st = await stats();
  console.log("netcode", JSON.stringify(st));

  // Walk into fights until eliminated, spectate, then wait for the results.
  let spectated = false;
  const until = Date.now() + 8 * 60 * 1000;
  while (Date.now() < until) {
    const s = await stats();
    if (!s || s.phase === "matchEnd") break;
    if (s.alive) {
      await grant("toFight");
      await wait(2500);
    } else if (!spectated && s.phase === "round") {
      await wait(1800);
      await shot("08-spectate");
      spectated = true;
    } else await wait(1000);
  }
  await page.waitForFunction(() => window.__prism?.stats().phase === "matchEnd", null, { timeout: 60000 });
  await wait(3000);
  await shot("09-results");
  const resultsText = await page.evaluate(() => document.body.innerText);
  if (!/MATCH COMPLETE|WINNER|VICTORY|place|#1/i.test(resultsText)) failures.push("results screen text not found");

  if (sockets.length) failures.push(`practice opened WebSockets: ${sockets.join(", ")}`);
  if (errors.length) failures.push(`practice console errors:\n${errors.join("\n")}`);
  for (const [label, f] of [["countdown", countdown], ["round", round]]) {
    if (f.p95 > 34) failures.push(`${label} frame p95 ${f.p95.toFixed(1)}ms`);
  }
  if (Math.abs(st?.snaps ?? 0) < 20) failures.push(`snapshots/s too low: ${st?.snaps}`);
  await page.close();

  // ---- 2. Create Room with no game server: the friendly message ---------------------------
  const p2 = await newPage();
  const shot2 = shotOf(p2.page);
  await p2.page.goto(`${url}/`);
  await p2.page.waitForTimeout(1200);
  await p2.page.fill('input[aria-label="Your name"]', "Tester");
  await p2.page.click("text=Create room");
  await p2.page.waitForFunction(() => document.querySelector(".menu-card .error")?.textContent?.includes("Practice vs Bots works right now"), null, { timeout: 15000 }).catch(() => failures.push("offline message did not appear"));
  await p2.page.waitForTimeout(500);
  const msg = await p2.page.evaluate(() => document.querySelector(".menu-card .error")?.textContent ?? "");
  console.log("create room message:", JSON.stringify(msg));
  await shot2("10-create-offline");
  // The browser itself logs the refused WebSocket; anything else is an app error.
  const appErrors = p2.errors.filter((e) => !/WebSocket connection to .* failed/.test(e));
  console.log("create room: browser-level messages:", p2.errors.length - appErrors.length);
  if (appErrors.length) failures.push(`create room console errors:\n${appErrors.join("\n")}`);
  await p2.page.close();
} else {
  // ---- Online room through ?server= from the static build ---------------------------------
  const p = await newPage();
  const shot = shotOf(p.page);
  await p.page.goto(`${url}/?server=${encodeURIComponent(server)}`);
  await p.page.waitForTimeout(1200);
  await p.page.fill('input[aria-label="Your name"]', "Tester");
  await p.page.click("text=Create room");
  await p.page.waitForSelector(".lobby .code-tiles", { timeout: 15000 }).catch(() => failures.push("lobby did not open"));
  await p.page.waitForTimeout(900);
  const invite = await p.page.evaluate(() => document.querySelector('input[aria-label="Invite link"]')?.value ?? "");
  console.log("invite link:", invite);
  console.log("websockets:", p.sockets.join(", "));
  if (!p.sockets.some((s) => s.startsWith(server))) failures.push(`no WebSocket to ${server}`);
  if (new URL(invite || "http://x").searchParams.get("server") !== server) failures.push("invite link lacks the server param");
  await shot("11-online-lobby");
  // A friend opening the invite joins the same room on the same server.
  const friend = await newPage();
  await friend.page.goto(invite);
  await friend.page.waitForTimeout(1200);
  await friend.page.fill('input[aria-label="Your name"]', "Friend");
  await friend.page.click("text=/Join room/");
  await friend.page.waitForSelector(".lobby .code-tiles", { timeout: 15000 }).catch(() => failures.push("friend did not join"));
  await p.page.waitForTimeout(1200);
  const names = await p.page.evaluate(() => [...document.querySelectorAll(".slot .name")].map((n) => n.textContent));
  console.log("lobby players:", names.join(", "));
  if (!names.includes("Friend")) failures.push("friend not in host lobby");
  await shot("12-online-friend");
  for (const x of [p, friend]) if (x.errors.length) failures.push(`console errors:\n${x.errors.join("\n")}`);
}

await browser.close();
console.log(failures.length ? `FAILURES:\n${failures.join("\n")}` : "all checks passed");
process.exit(failures.length ? 1 : 0);
