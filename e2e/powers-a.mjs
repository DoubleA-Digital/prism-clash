#!/usr/bin/env node
// Visual check for powers part A: practice vs bots in a test room. For each power: grant it
// through the test-room debug grant (it lands in slot 3), line up on the nearest bot, cast it
// with F and screenshot it in action. The dev client's live session gives bot positions and
// keeps the tester healed so every power gets its turn.
//   node e2e/powers-a.mjs [url] [--headed] [--only chronoRewind,magnetar]
// Screenshots land in e2e/out/powa-*.png. Fails (exit 1) on any page error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const out = "e2e/out";
mkdirSync(out, { recursive: true });

/**
 * Each power: screenshot times (s after cast), how close to get to a bot first (`near`), a
 * walk before casting (rewind needs a path), movement keys held in turn between screenshots,
 * held fire, a single tap of fire (`fireAt`), a recast time, and whether to keep aiming at
 * the nearest bot.
 */
const POWERS = [
  { id: "chronoRewind", pre: ["KeyD", "KeyS"], shots: [0.05, 0.2, 0.45, 0.9] },
  { id: "mirrorSelf", near: 420, shots: [0.3, 1.2, 2.4, 3.3], moves: ["KeyD", "KeyW", "KeyA"], fire: true, recastAt: 3.1, track: true },
  { id: "stormTether", near: 330, shots: [0.12, 0.5, 1.3, 2.4], track: true, tries: 2 },
  { id: "timeBubble", near: 200, shots: [0.3, 1.4, 2.8], fire: true, track: true },
  { id: "ricochetPrism", near: 450, shots: [0.4, 1.2, 2.4], fire: true },
  { id: "phantomMark", near: 110, shots: [0.08, 0.25, 0.9, 1.4], fireAt: 0.5, track: true, tries: 3 },
  { id: "hexSwap", near: 380, shots: [0.08, 0.25, 0.5] },
  { id: "magnetar", near: 260, shots: [0.4, 1.8, 3.2, 3.35], recastAt: 3.1, track: true },
  { id: "voidCloak", shots: [0.15, 1.0, 1.75, 1.9], fireAt: 1.6, track: true },
].filter((p) => !only || only.has(p.id));

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
await page.waitForTimeout(1500);
await page.locator(".card").first().click();
for (let k = 0; k < 2; k++) {
  await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.locator(".card").nth(k).click();
  await page.waitForTimeout(300);
}
await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 60000 });

// Grab the live session (the exact module URL the app loaded; Vite may add a ?t= version)
// and keep the tester topped up.
await page.evaluate(async () => {
  const src = performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/src/net/session.ts")) ?? "/src/net/session.ts";
  const { session } = await import(src);
  window.__pa = session;
  setInterval(() => session.debugGrant(session.myId, "heal"), 150);
});
await page.waitForTimeout(3500);

const grant = (id) => page.evaluate((pid) => window.__pa.debugGrant(window.__pa.myId, pid), id);

/** Nearest living bot relative to the predicted local player, in world units. */
const nearest = () =>
  page.evaluate(() => {
    const v = window.__pa.view;
    if (!v || !v.me || !v.latest) return null;
    const snap = v.viewAt(v.latest.tick);
    let best = null;
    for (const p of snap?.players ?? []) {
      if (p.id === v.myId || !(p.flags & 1)) continue;
      const dx = p.x - v.me.x;
      const dy = p.y - v.me.y;
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = { dx, dy, d };
    }
    return best;
  });

const CENTER = { x: 800, y: 450 };
/** The camera keeps the player near the center, leading toward the mouse along the same line. */
const aimAt = async (t) => {
  if (!t) return;
  const a = Math.atan2(t.dy, t.dx);
  await page.mouse.move(CENTER.x + Math.cos(a) * 300, CENTER.y + Math.sin(a) * 300);
};

/** Walks toward the nearest bot until within `want` units (or gives up). */
const approach = async (want) => {
  for (let i = 0; i < 30; i++) {
    const t = await nearest();
    if (!t) return;
    await aimAt(t);
    if (t.d <= want) return;
    const keys = [];
    if (t.dx > 40) keys.push("KeyD");
    if (t.dx < -40) keys.push("KeyA");
    if (t.dy > 40) keys.push("KeyS");
    if (t.dy < -40) keys.push("KeyW");
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(Math.min(260, (t.d - want) * 2.2 + 60));
    for (const k of keys) await page.keyboard.up(k);
  }
};

for (const p of POWERS.flatMap((q) => Array.from({ length: q.tries ?? 1 }, (_, k) => ({ ...q, tag: q.tries ? `${q.id}-t${k + 1}` : q.id })))) {
  if (!(await page.evaluate(() => window.__prism?.stats().alive))) {
    console.log("player is dead, stopping");
    break;
  }
  await grant(p.id);
  await page.waitForTimeout(200);
  if (p.near) await approach(p.near);
  else await aimAt(await nearest());
  for (const k of p.pre ?? []) {
    await page.keyboard.down(k);
    await page.waitForTimeout(1300);
    await page.keyboard.up(k);
  }
  await page.keyboard.press("KeyF");
  const t0 = Date.now();
  if (p.fire) await page.mouse.down();
  let mi = 0;
  let recast = !p.recastAt;
  let fired = !p.fireAt;
  if (p.moves) await page.keyboard.down(p.moves[0]);
  for (const [i, s] of p.shots.entries()) {
    while (p.track && Date.now() - t0 < s * 1000 - 120) {
      await aimAt(await nearest());
      await page.waitForTimeout(60);
    }
    if (!recast && s >= p.recastAt) {
      await page.waitForTimeout(Math.max(0, p.recastAt * 1000 - (Date.now() - t0)));
      await page.keyboard.press("KeyF");
      recast = true;
    }
    if (!fired && s >= p.fireAt) {
      await page.waitForTimeout(Math.max(0, p.fireAt * 1000 - (Date.now() - t0)));
      await aimAt(await nearest());
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
      fired = true;
    }
    const wait = s * 1000 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/powa-${p.tag}-${i + 1}.png` });
    console.log("shot", p.tag, i + 1);
    if (p.moves && p.moves[mi + 1]) {
      await page.keyboard.up(p.moves[mi]);
      mi++;
      await page.keyboard.down(p.moves[mi]);
    }
  }
  if (p.moves) await page.keyboard.up(p.moves[mi]);
  if (p.fire) await page.mouse.up();
  await page.waitForTimeout(1000);
}

console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
