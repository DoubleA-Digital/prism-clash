#!/usr/bin/env node
// Exit to Prism Clash's own title screen from inside a match, the way a player in an embedded
// iframe would (the portal's own close button is never needed):
//   1. Practice, twice in a row: the HUD menu button (first run) or Esc (second run) opens the
//      menu, "Exit to main menu" asks to confirm while alive, and lands on the title screen.
//      Counts WebSockets and Workers the page creates, so a leak or duplicate shows up.
//   2. Online: a guest exits mid-match while alive (forfeit), lands on the title screen, the host
//      sees them gone from the room; Esc in the lobby offers "Leave room".
//   3. Screenshots of the HUD button at 1600x900, 1280x720 and 520x900.
//   node e2e/v2b-exit.mjs [url] [--headed]
// Output: e2e/out/v2b-exit-*.png. Fails (exit 1) on any console/page error or a wrong turn.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const out = "e2e/out";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: !args.includes("--headed"), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const fail = (msg) => {
  errors.push(msg);
  console.log("FAIL:", msg);
};
// Counts live sockets and workers the page makes (wrapped before any app code runs).
const COUNTERS = () => {
  const c = { sockets: 0, liveSockets: 0, workers: 0, liveWorkers: 0, navigations: 0 };
  window.__counts = c;
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      // Only the game's own socket (the dev server's hot-reload socket doesn't count).
      if (!String(a[0]).includes("/ws")) return;
      c.sockets++;
      c.liveSockets++;
      this.addEventListener("close", () => c.liveSockets--);
    }
  };
  if (window.Worker) {
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(...a) {
        super(...a);
        c.workers++;
        c.liveWorkers++;
        const t = this.terminate.bind(this);
        this.terminate = () => {
          c.liveWorkers--;
          t();
        };
      }
    };
  }
  window.addEventListener("beforeunload", () => c.navigations++);
};
const open = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(COUNTERS);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
  return page;
};
const shot = async (page, name) => {
  await page.screenshot({ path: `${out}/v2b-exit-${name}.png` });
  console.log("shot", name);
};
const phase = (page) => page.evaluate(() => window.__prism?.stats().phase ?? null);
const counts = (page) => page.evaluate(() => ({ ...window.__counts, url: location.href }));
const pickToRound = async (page) => {
  await page.waitForSelector(".card", { timeout: 20000 });
  await page.locator(".card").first().click();
  await page.waitForFunction(() => document.querySelector(".phase-title")?.textContent?.includes("DRAFT") && document.querySelectorAll(".card:not(.picked):not(.dim)").length > 0, null, { timeout: 30000 });
  await page.locator(".card").first().click();
  await page.waitForFunction(() => window.__prism?.stats().phase === "round", null, { timeout: 30000 });
};
const atTitle = async (page, what) => {
  await page.waitForFunction(() => window.__prism?.stats().phase === "menu", null, { timeout: 5000 }).catch(() => fail(`${what}: not back on the title screen`));
  await page.waitForSelector("text=Practice vs bots", { timeout: 5000 }).catch(() => fail(`${what}: title menu missing`));
};
const notOverlapping = async (page, label) => {
  const r = await page.evaluate(() => {
    const b = document.querySelector(".hud-menu-btn")?.getBoundingClientRect();
    return b ? { x: b.x, y: b.y, w: b.width, h: b.height, W: innerWidth, H: innerHeight } : null;
  });
  if (!r) return fail(`${label}: no HUD menu button`);
  // Zone timer: centered top panel; kill feed: top right; minimap: bottom right (all canvas).
  const zoneLeft = r.W / 2 - 190 * Math.max(0.75, Math.min(1.3, Math.min(r.W / 1600, r.H / 900) * 1.1));
  if (r.x + r.w > zoneLeft) fail(`${label}: menu button reaches the zone timer (${r.x + r.w} > ${zoneLeft})`);
  if (r.x + r.w > r.W * 0.5 || r.y > 80) fail(`${label}: menu button not in the top left corner`);
  console.log(`${label}: button at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`);
};

// ---- 1. Practice, twice --------------------------------------------------------------------
const page = await open(1600, 900);
await page.goto(`${url}/?test=1`);
await page.waitForTimeout(1200);
await page.fill('input[aria-label="Your name"]', "Tester");
for (let run = 1; run <= 2; run++) {
  await page.click("text=Practice vs bots");
  await pickToRound(page);
  await page.waitForTimeout(1500);
  if (run === 1) {
    await notOverlapping(page, "1600x900");
    await shot(page, "1-hud-button-1600");
    for (const [w, h] of [[1280, 720], [520, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(600);
      await notOverlapping(page, `${w}x${h}`);
      await shot(page, `1-hud-button-${w}`);
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(400);
    await page.click(".hud-menu-btn");
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForSelector(".esc-menu", { timeout: 3000 });
  await page.waitForTimeout(350);
  if (run === 1) await shot(page, "2-menu-practice");
  await page.click('[data-exit="menu"]');
  await page.waitForSelector("[data-confirm]", { timeout: 2000 }).catch(() => fail("no confirm while alive"));
  if (run === 1) await shot(page, "3-confirm-practice");
  await page.click("[data-confirm]");
  await atTitle(page, `practice run ${run}`);
  await page.waitForTimeout(700);
  const c = await counts(page);
  console.log(`practice run ${run}: back on the title screen; sockets made ${c.sockets} (live ${c.liveSockets}), workers made ${c.workers} (live ${c.liveWorkers}), page navigations ${c.navigations}`);
  if (c.liveSockets > 1) fail(`run ${run}: ${c.liveSockets} live sockets`);
  if (c.liveWorkers > 1) fail(`run ${run}: ${c.liveWorkers} live workers`);
  if (c.navigations > 0) fail(`run ${run}: the page navigated away`);
}
await shot(page, "4-title-after-two-exits");
// And a third start still works.
await page.click("text=Practice vs bots");
await pickToRound(page);
const s3 = await page.evaluate(() => window.__prism?.stats());
if (!s3?.alive) fail("third practice start: not in the round");
console.log("third practice start: in the round, alive");

// ---- 2. Online ---------------------------------------------------------------------------
const ann = await open(1600, 900);
await ann.goto(`${url}/?test=1`);
await ann.waitForTimeout(1000);
await ann.fill('input[aria-label="Your name"]', "Ann");
await ann.click("text=Create room");
await ann.waitForSelector(".code-tile", { timeout: 10000 });
const code = await ann.$$eval(".code-tile", (els) => els.map((e) => e.textContent).join(""));
const bea = await open(1280, 720);
await bea.goto(`${url}/?room=${code}&test=1`);
await bea.waitForTimeout(800);
await bea.fill('input[aria-label="Your name"]', "Bea");
await bea.keyboard.press("Enter");
await bea.waitForSelector(".ready-btn", { timeout: 10000 });
// Esc in the lobby: the same menu, with "Leave room".
await bea.keyboard.press("Escape");
await bea.waitForSelector(".esc-menu", { timeout: 3000 });
await bea.waitForTimeout(300);
const lobbyExit = (await bea.textContent(".esc-menu .esc-leave"))?.trim();
console.log("lobby Esc menu:", lobbyExit);
if (lobbyExit !== "Leave room") fail(`lobby Esc menu: expected "Leave room", got "${lobbyExit}"`);
await shot(bea, "5-lobby-esc-menu");
await bea.keyboard.press("Escape");
await bea.click(".ready-btn");
await ann.waitForFunction(() => !document.querySelector(".btn.start")?.hasAttribute("disabled"), null, { timeout: 5000 });
await ann.click(".btn.start");
await Promise.all([pickToRound(ann), pickToRound(bea)]);
await bea.waitForTimeout(1500);
await bea.keyboard.press("Escape");
await bea.waitForSelector(".esc-menu", { timeout: 3000 });
await bea.waitForTimeout(300);
await shot(bea, "6-menu-online-alive");
await bea.click('[data-exit="menu"]');
await bea.waitForSelector("[data-confirm]", { timeout: 2000 });
const q = await bea.textContent(".esc-confirm");
console.log("online confirm:", q);
if (!q?.includes("Leave the match?") || !q.includes("eliminated")) fail("online confirm text");
await shot(bea, "7-confirm-online");
await bea.click("[data-confirm]");
await atTitle(bea, "online exit");
await ann.waitForTimeout(1500);
// The host's Tab board no longer lists Bea as alive, and the room no longer has her.
await ann.keyboard.down("Tab");
await ann.waitForTimeout(400);
const board = await ann.textContent(".scoreboard");
await shot(ann, "8-host-after-guest-exit");
await ann.keyboard.up("Tab");
console.log("host's board:", board?.replace(/\s+/g, " ").slice(0, 160));
if (/Bea\s*ALIVE/i.test(board ?? "")) fail("Bea still alive on the host's board");
const bc = await counts(bea);
console.log(`guest after exit: sockets made ${bc.sockets} (live ${bc.liveSockets}), navigations ${bc.navigations}`);
if (bc.liveSockets > 1 || bc.navigations > 0) fail("guest: socket leak or navigation");
// Bea can start practice straight away from the title screen.
await bea.click("text=Practice vs bots");
await pickToRound(bea);
console.log("guest practice after exit:", await phase(bea));

console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
