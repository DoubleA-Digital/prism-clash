#!/usr/bin/env node
// HUD gallery: draws the canvas HUD with fake in-match data (no server needed) over a dark arena-ish
// backdrop, in several situations, and screenshots each.  node e2e/ui-hud.mjs [url] [--sizes 1600x900,1280x720]
// Output: e2e/out/ui-hud-<state>-<w>x<h>.png

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const sizes = opt("sizes", "1600x900").split(",").map((s) => s.split("x").map(Number));
mkdirSync("e2e/out", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];

const SCRIPT = `
(async (W, H, scenario) => {
  const res = performance.getEntriesByType("resource").map((r) => r.name);
  const hudUrl = res.find((n) => n.includes("/src/ui/hud.ts"));
  const sharedUrl = res.find((n) => n.includes("shared/src/index.ts")) ?? res.find((n) => n.includes("@prism/shared"));
  const inputUrl = res.find((n) => n.includes("/src/input/input.ts"));
  const { Hud } = await import(hudUrl);
  const { DEFAULT_BINDS } = await import(inputUrl);
  const shared = await import(sharedUrl);
  document.getElementById("ui").style.display = "none";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:99";
  document.body.append(canvas);
  const dpr = 1;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const hud = new Hud();
  const bg = () => { const g = ctx.createRadialGradient(W/2, H/2, 50, W/2, H/2, H); g.addColorStop(0, "#161a52"); g.addColorStop(1, "#05040d"); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = "rgba(124,246,255,0.5)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(W/2, H/2, H*0.38, 0, 7); ctx.stroke();
    ctx.fillStyle = "#00f0ff"; ctx.beginPath(); ctx.arc(W/2, H/2, 22, 0, 7); ctx.fill(); };
  const A = shared.PFLAG.alive;
  const pl = (id, x, y, color) => ({ id, x, y, vx: 0, vy: 0, aim: 0, hp: 100, flags: A, status: 0, warp: false, color });
  const base = {
    w: W, h: H, dpr, ammo: { ammo: 3, reload: 0.4 }, myId: 1, meX: 0, meY: 0, arenaRadius: 1400,
    names: (id) => ["", "Tester", "Maya", "Jonathan", "ORBIT", "NOVA"][id] ?? "?", colors: (id) => (id - 1) % 5,
    killFeed: [], ping: 38, showPing: true, fps: 60, showFps: true, time: 3, dt: 1 / 60, input: { binds: DEFAULT_BINDS },
    colorblind: false, revealed: new Set([3]), huntersEye: false, round: 3,
    players: [pl(1, 0, 0, 0), pl(2, 400, -300, 1), pl(3, -500, 200, 2), pl(4, 1000, 800, 3)],
    g: { zx: 100, zy: 50, zr: 1000, tx: 300, ty: 200, tr: 600, stage: 1, phase: "warn", remaining: 12, alive: 4, roundTime: 40 },
  };
  const self = (o) => ({ hp: 78, alive: true, dashCd: 0, slots: [{ id: "chronoRewind", cd: 0, recast: 0 }, { id: "singularity", cd: 9.5, recast: 0 }, null], ult: { id: "meteorRain", charge: 55 }, ...o });
  const now = performance.now();
  const scenarios = {
    fight: () => ({ ...base, self: self({}), killFeed: [
      { killer: 2, victim: 3, source: "singularity", at: now - 400 }, { killer: 1, victim: 4, source: "shot", at: now - 2200 }, { killer: 0, victim: 5, source: "zone", at: now - 3500 } ] }),
    critical: () => ({ ...base, time: 3.2, self: self({ hp: 17, dashCd: 1.4, slots: [{ id: "portalPair", cd: 0, recast: 2 }, { id: "voidCloak", cd: 0, recast: 0 }, { id: "magnetar", cd: 4.2, recast: 0 }], ult: { id: "overdrive", charge: 100 } }),
      g: { ...base.g, remaining: 2.6 }, killFeed: [{ killer: 3, victim: 1, source: "boomerangGlaive", at: now - 600 }] }),
    colorblind: () => ({ ...base, colorblind: true, self: self({}), killFeed: [{ killer: 2, victim: 3, source: "wall", at: now - 800 }, { killer: 1, victim: 2, source: "hexSwap", at: now - 1500 }] }),
    countdown: () => ({ ...base, self: self({ hp: 100 }), ammo: { ammo: 5, reload: 0 }, g: { ...base.g, stage: -1, remaining: 30 } }),
  };
  const s = scenarios[scenario]();
  if (scenario === "critical") { hud.banner("COMBO!", "Portal + Ricochet", "#ffc83d"); hud.selfHit(); }
  if (scenario === "countdown") hud.countdown = { n: 2, age: 0 };
  if (scenario === "fight") hud.banner("KILL!", "Maya eliminated", "#ff2e88");
  for (let i = 0; i < 24; i++) { bg(); hud.draw(ctx, { ...s, time: s.time + i / 60 }); await new Promise((r) => requestAnimationFrame(r)); }
  if (scenario === "countdown") { hud.countdown = { n: 0, age: 0.3 }; bg(); hud.draw(ctx, { ...s, time: 5 }); }
})
`;

for (const [w, h] of sizes) {
  for (const scenario of ["fight", "critical", "colorblind", "countdown"]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
    await page.goto(`${url}/?test=1`);
    await page.waitForTimeout(1500);
    await page.evaluate(`(${SCRIPT})(${w}, ${h}, ${JSON.stringify(scenario)})`);
    await page.waitForTimeout(50);
    await page.screenshot({ path: `e2e/out/ui-hud-${scenario}-${w}x${h}.png` });
    console.log("shot", `ui-hud-${scenario}-${w}x${h}`);
    await page.close();
  }
}
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
process.exit(errors.length ? 1 : 0);
