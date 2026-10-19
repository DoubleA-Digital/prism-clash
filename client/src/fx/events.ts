// Turns server events into what you see and hear: sparks, rings, floor ripples, damage
// numbers, kill feed lines, hit-stop, trauma shake, chromatic flashes and sounds. Shake and
// hit-stop only fire for events near you or about you.

import { FX, PLAYER, type GameEvent, type SourceId } from "@prism/shared";
import { audio } from "../audio/audio";
import type { Camera } from "../render/camera";
import type { Floor } from "../render/floor";
import { colorHex, PAL } from "../render/palette";
import type { Fx } from "./fx";
import { PSHAPE } from "./particles";

export interface KillFeedItem {
  killer: number;
  victim: number;
  source: SourceId;
  at: number;
}

export interface EventContext {
  fx: Fx;
  cam: Camera;
  floor: Floor | null;
  myId: number;
  colorOf: (id: number) => number;
  nameOf: (id: number) => string;
  /** Where the local player (or spectated player) is, for proximity checks. */
  listener: () => { x: number; y: number };
  killFeed: KillFeedItem[];
  /** Big center banner (your kills, combos). */
  banner: (text: string, sub: string, color: string) => void;
  /** Damage you took (HUD damage flash + delayed bar). */
  onSelfHit: (amount: number) => void;
  /** True while the slow-mo replay re-plays events: visuals only, no feed or banners. */
  replaying: boolean;
  /** Players who fired recently (minimap reveal). */
  firedAt: Map<number, number>;
}

const near = (ec: EventContext, x: number, y: number, r = 900) => {
  const l = ec.listener();
  return Math.hypot(x - l.x, y - l.y) < r;
};

export function handleEvent(ec: EventContext, e: GameEvent, immediate: boolean) {
  const { fx, cam } = ec;
  void immediate;
  if (e.t === "shoot") ec.firedAt.set(e.by, performance.now());
  if (ec.replaying) {
    // During the replay: only visuals and sound, never feed, banners or HUD changes.
    const saved = { banner: ec.banner, onSelfHit: ec.onSelfHit, feed: ec.killFeed };
    ec.banner = () => {};
    ec.onSelfHit = () => {};
    ec.killFeed = [];
    try {
      handleEvent({ ...ec, replaying: false }, e, immediate);
    } finally {
      ec.banner = saved.banner;
      ec.onSelfHit = saved.onSelfHit;
      ec.killFeed = saved.feed;
    }
    return;
  }
  switch (e.t) {
    case "shoot": {
      if (e.by === ec.myId) break; // own shots already flashed when predicted
      const col = colorHex(ec.colorOf(e.by));
      fx.particles.cone(e.x, e.y, 4, e.angle, 0.6, col, 380, 0.18, 3);
      audio.sfx("shoot", e.x, e.y, { pitch: 0.95 + Math.random() * 0.1 });
      break;
    }
    case "hit": {
      const col = colorHex(ec.colorOf(e.target));
      if (e.amount > 0) fx.damage(e.x, e.y - PLAYER.radius, e.amount, e.crit, e.by === ec.myId ? "#ffffff" : col);
      fx.particles.burst(e.x, e.y, e.crit ? 14 : 8, e.crit ? PAL.gold : col, e.crit ? 420 : 300, 0.35, e.crit ? 9 : 6, PSHAPE.spark);
      const big = e.amount >= FX.bigHitThreshold || e.crit;
      if (e.target === ec.myId) {
        cam.addTrauma(0.18 + Math.min(0.35, e.amount / 60));
        if (big) fx.stop(FX.hitStopBig);
        ec.onSelfHit(e.amount);
        audio.sfx("hurt", e.x, e.y, { gain: 1 });
      } else if (e.by === ec.myId) {
        if (big) fx.stop(FX.hitStopBig * 0.8);
        cam.addTrauma(big ? 0.12 : 0.04);
        audio.sfx(e.crit ? "crit" : "hit", e.x, e.y);
      } else if (near(ec, e.x, e.y, 600)) {
        audio.sfx("hit", e.x, e.y, { gain: 0.6 });
      }
      break;
    }
    case "kill": {
      const col = colorHex(ec.colorOf(e.victim));
      fx.particles.burst(e.x, e.y, 46, col, 640, 0.9, 12, PSHAPE.shard);
      fx.particles.burst(e.x, e.y, 30, "#ffffff", 420, 0.6, 8);
      fx.ring(e.x, e.y, 10, 260, 0.6, col, 8);
      fx.ring(e.x, e.y, 10, 160, 0.4, "#ffffff", 4);
      ec.floor?.ripple(e.x, e.y, 2, col);
      ec.killFeed.unshift({ killer: e.killer, victim: e.victim, source: e.source, at: performance.now() });
      if (ec.killFeed.length > 6) ec.killFeed.pop();
      audio.sfx("kill", e.x, e.y);
      if (e.killer === ec.myId) {
        fx.stop(FX.hitStopKill);
        fx.aberrate(1);
        cam.punch = FX.zoomPunch;
        cam.addTrauma(0.35);
        ec.banner("ELIMINATED", ec.nameOf(e.victim), col);
      } else if (e.victim === ec.myId) {
        fx.stop(FX.hitStopKill);
        cam.addTrauma(0.6);
        fx.screenFlash("#ff2244", 0.7);
        ec.banner("YOU WERE ELIMINATED", e.killer ? `by ${ec.nameOf(e.killer)}` : "by the zone", "#ff4a5e");
      } else if (near(ec, e.x, e.y)) cam.addTrauma(0.15);
      break;
    }
    case "impact": {
      const col = colorHex(e.color);
      fx.particles.burst(e.x, e.y, 6 * e.size, col, 260, 0.3, 5, PSHAPE.spark);
      fx.ring(e.x, e.y, 4, 26 * e.size, 0.25, col, 2);
      if (e.size > 1) ec.floor?.ripple(e.x, e.y, 0.5, col);
      break;
    }
    case "pillarHit":
      fx.particles.burst(e.x, e.y, 5, PAL.crystal, 220, 0.4, 5, PSHAPE.shard);
      if (near(ec, e.x, e.y, 700)) audio.sfx("crystal", e.x, e.y, { gain: 0.5 });
      break;
    case "pillarBroken":
      fx.particles.burst(e.x, e.y, 60, PAL.crystal, 700, 1.1, 14, PSHAPE.shard);
      fx.particles.burst(e.x, e.y, 30, "#ffffff", 400, 0.6, 9);
      fx.ring(e.x, e.y, e.r, e.r * 3, 0.6, PAL.crystal, 6);
      ec.floor?.ripple(e.x, e.y, 1.5, PAL.crystal);
      if (near(ec, e.x, e.y)) cam.addTrauma(0.25);
      audio.sfx("shatter", e.x, e.y);
      break;
    case "pickup": {
      const col = e.kind === "heal" ? PAL.heal : e.kind === "cooldown" ? PAL.cooldown : e.kind === "ult" ? PAL.ult : PAL.prism;
      fx.particles.burst(e.x, e.y, 24, col, 300, 0.6, 8);
      fx.ring(e.x, e.y, 10, 90, 0.4, col, 4);
      audio.sfx("pickup", e.x, e.y, { pitch: e.kind === "prism" ? 1.5 : 1 });
      if (e.by === ec.myId) {
        const text = e.kind === "heal" ? "+20 HEALTH" : e.kind === "cooldown" ? "COOLDOWNS RESET" : e.kind === "ult" ? "+ULT CHARGE" : "PRISM CORE!";
        fx.label(e.x, e.y - 50, text, e.kind === "prism" ? "Press F for your 3rd power" : "", col);
      }
      break;
    }
    case "dash": {
      const col = colorHex(ec.colorOf(e.by));
      fx.ring(e.x, e.y, 8, 70, 0.3, col, 3);
      audio.sfx("dash", e.x, e.y, { gain: e.by === ec.myId ? 0.9 : 0.5 });
      break;
    }
    case "cast": {
      const col = colorHex(ec.colorOf(e.by));
      fx.ring(e.x, e.y, 20, 110, 0.45, col, 4);
      fx.particles.burst(e.x, e.y, 16, col, 280, 0.5, 7);
      audio.sfx(`cast:${e.power}`, e.x, e.y);
      if (isUlt(e.power)) {
        ec.floor?.ripple(e.x, e.y, 2.2, col);
        if (e.by === ec.myId || near(ec, e.x, e.y, 700)) {
          fx.aberrate(e.by === ec.myId ? 1 : 0.5);
          cam.punch = FX.zoomPunch * (e.by === ec.myId ? 1 : 0.5);
          cam.addTrauma(0.3);
        }
        fx.label(e.x, e.y - 80, ULT_NAME[e.power] ?? "ULTIMATE", ec.nameOf(e.by), col, true);
      }
      break;
    }
    case "explode": {
      const col = sourceColor(e.source, colorHex(ec.colorOf(e.by)));
      fx.particles.burst(e.x, e.y, Math.min(70, 20 + e.r / 5), col, e.r * 3, 0.7, 12);
      fx.particles.burst(e.x, e.y, 20, "#ffffff", e.r * 2, 0.4, 8, PSHAPE.spark);
      fx.ring(e.x, e.y, e.r * 0.2, e.r * 1.1, 0.5, col, 7);
      ec.floor?.ripple(e.x, e.y, Math.min(2.5, e.r / 120), col);
      if (near(ec, e.x, e.y, e.r + 500)) cam.addTrauma(Math.min(0.5, e.r / 500));
      audio.sfx("boom", e.x, e.y, { gain: Math.min(1.3, 0.6 + e.r / 300) });
      break;
    }
    case "bounce":
      fx.particles.burst(e.x, e.y, 5, "#ffffff", 200, 0.25, 4, PSHAPE.spark);
      audio.sfx("bounce", e.x, e.y, { pitch: 1 + e.n * 0.15, gain: 0.5 });
      break;
    case "portal":
      fx.ring(e.x, e.y, 40, 6, 0.3, "#FF8A2B", 3);
      fx.ring(e.x2, e.y2, 6, 50, 0.3, "#3FA9FF", 3);
      audio.sfx("portal", e.x2, e.y2, { gain: 0.6 });
      break;
    case "wallSlam":
      fx.particles.burst(e.x, e.y, 22, "#ffffff", 500, 0.5, 8, PSHAPE.spark);
      fx.ring(e.x, e.y, 10, 120, 0.35, "#ffffff", 5);
      ec.floor?.ripple(e.x, e.y, 1.2, "#ffffff");
      if (near(ec, e.x, e.y)) cam.addTrauma(0.25);
      audio.sfx("slam", e.x, e.y);
      break;
    case "combo": {
      const label = e.stolen ? "STOLEN COMBO!" : "COMBO!";
      fx.label(e.x, e.y - 70, label, e.name, e.stolen ? "#ff7bf2" : "#ffd34d", true);
      fx.particles.burst(e.x, e.y, 30, "#ffd34d", 500, 0.8, 10);
      audio.sfx("combo", e.x, e.y);
      if (e.by === ec.myId) {
        ec.banner(label, e.name, e.stolen ? "#ff7bf2" : "#ffd34d");
        fx.aberrate(0.6);
      }
      break;
    }
    case "zoneStage":
      audio.sfx("zoneWarn", 0, 0, { positional: false });
      ec.banner("THE ZONE IS CLOSING", "Get inside the dashed circle", "#ff3d6e");
      break;
    case "haunt": {
      const col = colorHex(ec.colorOf(e.by));
      fx.ring(e.x, e.y, 6, 100, 0.5, col, 4);
      audio.sfx("haunt", e.x, e.y);
      break;
    }
    default:
      break;
  }
}

const ULT_NAME: Record<string, string> = {
  meteorRain: "METEOR RAIN", overdrive: "OVERDRIVE", riftCollapse: "RIFT COLLAPSE", echoStorm: "ECHO STORM", finalStand: "FINAL STAND", huntersEye: "HUNTER'S EYE",
};

export function isUlt(id: string): boolean {
  return id in ULT_NAME;
}

function sourceColor(s: SourceId, fallback: string): string {
  switch (s) {
    case "singularity":
      return "#9B5CFF";
    case "meteorRain":
      return "#ff7a2b";
    case "riftCollapse":
      return "#ff3df0";
    case "finalStand":
      return "#ffd34d";
    case "phantomMark":
      return "#c06bff";
    case "shockwaveSlam":
      return "#7cf6ff";
    default:
      return fallback;
  }
}
