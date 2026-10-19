#!/usr/bin/env node
// Visual check for powers part B: practice vs bots in a test room, then for each power grant
// it from the F1 debug panel (it lands in slot 3), close the panel, cast it with F and
// screenshot it in action. If the tester dies, a fresh practice match is started.
//   node e2e/powers-b.mjs [url] [--headed] [--only moltenPath,boomerangGlaive]
// Screenshots land in e2e/out/pow-*.png. Fails (exit 1) on any page error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const out = "e2e/out";
mkdirSync(out, { recursive: true });

/** Each power: panel button title, keys held while it plays (switched after each shot), screenshot times (s after cast). */
const POWERS = [
  { id: "moltenPath", title: "Molten Path", shots: [0.8, 2.2, 3.8], moves: ["KeyD", "KeyS", "KeyA"] },
  { id: "boomerangGlaive", title: "Boomerang Glaive", shots: [0.25, 0.7, 1.4, 2.0], approach: 420 },
  { id: "gravityFlip", title: "Gravity Flip", shots: [0.2, 0.6, 1.2], approach: 380 },
  { id: "bountyBeacon", title: "Bounty Beacon", shots: [0.3, 1.5] },
  { id: "decoySwarm", title: "Decoy Swarm", shots: [0.25, 0.9, 2.2], approach: 450 },
  { id: "shockwaveSlam", title: "Shockwave Slam", shots: [0.2, 0.4, 0.62, 0.9], approach: 140 },
  { id: "thirdParty", title: "Third-Party", shots: [0.4, 1.6], fire: true },
].filter((p) => !only || only.has(p.id));

const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const aim = { x: 1000, y: 380 };
const alive = () => page.evaluate(() => !!window.__prism?.stats().alive);

async function startMatchOnce() {
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
  await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 60000 });
  await page.waitForTimeout(3200);
  // Walk toward the middle of the arena so there's someone to hit.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyW");
}

/** Other tools hot-reload the dev client now and then; retry the menu flow if it gets interrupted. */
async function startMatch() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startMatchOnce();
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log("retrying match start:", err.message.split(String.fromCharCode(10))[0]);
    }
  }
}

/** Offset from me to the nearest living enemy (world units), read from the client's own view. */
async function nearestEnemy() {
  return page.evaluate(async () => {
    // Import the exact module URL the app loaded (dev HMR may have added a ?t= stamp).
    const src = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/src/net/session.ts")) ?? "/src/net/session.ts";
    const { session } = await import(src);
    const v = session.view;
    const me = v?.me;
    const snap = v?.viewAt(v.lastTick);
    if (!me || !snap) return null;
    let best = null;
    for (const p of snap.players) {
      if (p.id === session.myId || !(p.flags & 1)) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (!best || d < best.d) best = { dx: p.x - me.x, dy: p.y - me.y, d };
    }
    return best;
  });
}

/** Points the mouse at the nearest enemy (falls back to the default aim point). */
async function aimAtEnemy() {
  const t = await nearestEnemy();
  if (!t) return page.mouse.move(aim.x, aim.y);
  const k = Math.min(0.75, 380 / Math.max(1, t.d));
  await page.mouse.move(800 + t.dx * k, 450 + t.dy * k);
}

/** Walks toward the nearest enemy until within `range` (or time runs out). */
async function approach(range, maxMs = 3000) {
  const t0 = Date.now();
  const held = new Set();
  while (Date.now() - t0 < maxMs) {
    const t = await nearestEnemy();
    if (!t || t.d < range) break;
    const want = new Set();
    if (t.dx > 40) want.add("KeyD");
    if (t.dx < -40) want.add("KeyA");
    if (t.dy > 40) want.add("KeyS");
    if (t.dy < -40) want.add("KeyW");
    for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    await page.waitForTimeout(60);
  }
  for (const k of held) await page.keyboard.up(k);
}

/** Opens the F1 panel, heals, grants the power, closes the panel. */
async function grant(title) {
  await page.keyboard.press("F1");
  await page.waitForTimeout(250);
  await page.locator('.debugpanel button:has-text("Heal")').first().click();
  await page.locator(`.debugpanel button[title="${title}"]`).first().click();
  await page.waitForTimeout(150);
  await page.keyboard.press("F1");
  await page.mouse.move(aim.x, aim.y);
  await page.waitForTimeout(150);
}

async function showcase(p) {
  if (!(await alive())) await startMatch();
  await grant(p.title);
  if (p.approach) await approach(p.approach);
  await aimAtEnemy();
  await page.keyboard.press("KeyF");
  const t0 = Date.now();
  if (p.fire) await page.mouse.down();
  let mi = 0;
  if (p.moves) await page.keyboard.down(p.moves[0]);
  try {
    for (const [i, s] of p.shots.entries()) {
      const wait = s * 1000 - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: `${out}/pow-${p.id}-${i + 1}.png` });
      console.log("shot", p.id, i + 1);
      if (p.moves && p.moves[mi + 1]) {
        await page.keyboard.up(p.moves[mi]);
        mi++;
        await page.keyboard.down(p.moves[mi]);
      }
    }
  } finally {
    if (p.moves) await page.keyboard.up(p.moves[mi]);
    if (p.fire) await page.mouse.up();
  }
  await page.waitForTimeout(1000);
}

await startMatch();
for (const p of POWERS) {
  try {
    await showcase(p);
  } catch (err) {
    // A hot reload from another tool interrupted us: start over for this power.
    console.log("retrying", p.id, err.message.split(String.fromCharCode(10))[0]);
    await startMatch();
    await showcase(p);
  }
}

console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
