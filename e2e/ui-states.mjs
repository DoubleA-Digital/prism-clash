#!/usr/bin/env node
// UI state gallery: fakes session state in the page (no server needed for most screens) and
// screenshots every UI screen at several viewport sizes.
//   node e2e/ui-states.mjs [url] [--only menu,lobby] [--sizes 1600x900,1280x720]
// Output: e2e/out/ui-<state>-<w>x<h>.png. Exits 1 on any console error.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const only = opt("only", "")?.split(",").filter(Boolean);
const sizes = opt("sizes", "1600x900").split(",").map((s) => s.split("x").map(Number));
const out = "e2e/out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];

// Runs inside the page: builds fake session data.
const SETUP = `
  const sessionUrl = performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/src/net/session.ts")) ?? "/src/net/session.ts";
  const { session } = await import(sessionUrl);
  const P = (id, name, color, o = {}) => ({ id, name, color, ready: false, bot: false, connected: true, host: false, points: 0, ...o });
  const room = (fill = true) => ({ code: "QXZWA", hostId: 1, phase: "lobby", settings: { fillBots: fill, botDifficulty: "normal", layout: "auto", testRoom: false },
    players: [P(1, "Tester", 0, { host: true, ready: true }), P(2, "Maya", 1, { ready: true }), P(3, "Jonathan", 2)] });
  const five = (pts) => [P(1, "Tester", 0, { host: true, ready: true, points: pts[0] }), P(2, "Maya", 1, { ready: true, points: pts[1] }), P(3, "Jonathan", 2, { ready: true, points: pts[2] }), P(4, "ORBIT", 3, { bot: true, ready: true, points: pts[3] }), P(5, "NOVA", 4, { bot: true, ready: true, points: pts[4] })];
  window.__set = (patch) => { Object.assign(session, patch); session.changed(); };
  window.__session = session;
  window.__P = P; window.__room = room; window.__five = five;
`;

async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
  await page.goto(`${url}/?test=1`);
  await page.waitForTimeout(1200);
  await page.evaluate(`(async () => { ${SETUP} })()`);
  return page;
}

const states = {
  menu: async () => {},
  "menu-invite": async (page) => { await page.goto(`${url}/?room=QXZWA`); await page.waitForTimeout(1500); },
  lobby: async (page) => {
    await page.evaluate(`window.__set({ myId: 3, room: window.__room(true), phase: "lobby" })`);
    await page.waitForTimeout(1300);
  },
  "lobby-host": async (page) => {
    await page.evaluate(`window.__set({ myId: 1, room: window.__room(true), phase: "lobby" })`);
    await page.waitForTimeout(1300);
  },
  ult: async (page) => {
    await page.evaluate(`window.__set({ myId: 1, room: window.__room(), phase: "ultSelect", ultOptions: ["meteorRain", "overdrive", "riftCollapse"], myPick: null, phaseEndsAt: performance.now() + 9000 })`);
    await page.waitForTimeout(1300);
  },
  draft: async (page) => {
    await page.evaluate(`window.__set({ myId: 1, room: window.__room(), phase: "draft", round: 1, draftPickNumber: 1, draftPicks: 1, draftOptions: ["chronoRewind", "singularity", "portalPair", "voidCloak"], draftLocked: new Set([2]), myPick: null, phaseEndsAt: performance.now() + 12000 })`);
    await page.waitForTimeout(1500);
  },
  "draft-hover": async (page) => {
    await states.draft(page);
    const c = page.locator(".card").nth(1);
    const b = await c.boundingBox();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3, { steps: 4 });
    await page.waitForTimeout(500);
  },
  "draft-picked": async (page) => {
    await states.draft(page);
    await page.evaluate(`window.__set({ myPick: 2, draftLocked: new Set([2, 3]) })`);
    await page.waitForTimeout(900);
  },
  "draft-urgent": async (page) => {
    await states.draft(page);
    await page.evaluate(`window.__set({ phaseEndsAt: performance.now() + 3300 })`);
    await page.waitForTimeout(500);
  },
  reveal: async (page) => {
    await page.evaluate(`window.__set({ myId: 1, room: { ...window.__room(), players: window.__five([0,0,0,0,0]) }, phase: "countdown", round: 1, loadouts: [
      { playerId: 1, slots: ["chronoRewind", "singularity"], ult: "meteorRain" }, { playerId: 2, slots: ["portalPair", "voidCloak"], ult: "overdrive" },
      { playerId: 3, slots: ["moltenPath", "hexSwap"], ult: "riftCollapse" }, { playerId: 4, slots: ["magnetar", "mirrorSelf"], ult: "echoStorm" }, { playerId: 5, slots: ["thirdParty", "timeBubble"], ult: "finalStand" } ], phaseEndsAt: performance.now() + 3000 })`);
    await page.waitForTimeout(1700);
  },
  standings: async (page) => {
    const pl = `[{ playerId: 2, place: 1, points: 6, kills: 1 }, { playerId: 1, place: 2, points: 4, kills: 1 }, { playerId: 3, place: 3, points: 2, kills: 0 }, { playerId: 4, place: 4, points: 1, kills: 0 }, { playerId: 5, place: 5, points: 0, kills: 0 }]`;
    await page.evaluate(`window.__set({ myId: 1, room: { ...window.__room(), players: window.__five([9, 11, 6, 5, 2]) }, phase: "standings", round: 3, phaseEndsAt: performance.now() + 5000, roundEnd: { placements: ${pl}, totals: {}, killTick: 0, killerId: 2, victimId: 1, winnerId: 2, round: 3 } })`);
    await page.waitForTimeout(3200);
  },
  matchend: async (page) => {
    await page.evaluate(`window.__set({ myId: 1, room: { ...window.__room(), players: window.__five([16, 12, 9, 7, 3]) }, phase: "matchEnd", round: 5, matchEnd: { winnerId: 1, chaosMoment: { playerId: 2, damage: 164, round: 3 }, stats: [
      { playerId: 1, points: 16, kills: 7, damage: 912, shots: 120, hits: 71, powersUsed: 22, combos: 3, roundWins: 3, placements: [1, 2, 1, 1, 3], chaos: 80 },
      { playerId: 2, points: 12, kills: 5, damage: 801, shots: 150, hits: 66, powersUsed: 31, combos: 5, roundWins: 1, placements: [2, 1, 2, 2, 1], chaos: 164 },
      { playerId: 3, points: 9, kills: 3, damage: 540, shots: 90, hits: 40, powersUsed: 15, combos: 0, roundWins: 1, placements: [3, 3, 3, 3, 2], chaos: 40 },
      { playerId: 4, points: 7, kills: 2, damage: 420, shots: 200, hits: 60, powersUsed: 12, combos: 1, roundWins: 0, placements: [4, 4, 4, 4, 4], chaos: 30 },
      { playerId: 5, points: 3, kills: 1, damage: 300, shots: 80, hits: 20, powersUsed: 9, combos: 0, roundWins: 0, placements: [5, 5, 5, 5, 5], chaos: 20 } ] } })`);
    await page.waitForTimeout(3600);
  },
  settings: async (page) => {
    await page.click("text=Settings");
    await page.waitForTimeout(700);
  },
  "settings-controls": async (page) => {
    await page.click("text=Settings");
    await page.click(".tab:has-text('Controls')");
    await page.waitForTimeout(600);
  },
  howto: async (page) => {
    await page.click("text=How to play");
    await page.waitForTimeout(800);
  },
  "howto-powers": async (page) => {
    await page.click("text=How to play");
    await page.click(".tab:has-text('Powers')");
    await page.waitForTimeout(600);
  },
};

for (const [w, h] of sizes) {
  for (const [name, run] of Object.entries(states)) {
    if (only.length && !only.includes(name)) continue;
    const page = await newPage(w, h);
    try {
      await run(page);
      await page.screenshot({ path: `${out}/ui-${name}-${w}x${h}.png` });
      console.log("shot", `ui-${name}-${w}x${h}`);
    } catch (e) {
      console.log("FAILED", name, String(e).split("\n")[0]);
      errors.push(`state ${name}: ${String(e).split("\n")[0]}`);
    }
    await page.close();
  }
}
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
