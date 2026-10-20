// Turns server events into what you see and hear: sparks, rings, floor ripples, damage
// numbers, kill feed lines, hit-stop, trauma shake and chromatic flashes. Every sound goes
// through the v2 game audio module (playGameAudio). Shake and hit-stop only fire for events
// near you or about you.

import { FX, ITEMS, PLAYER, type GameEvent, type Solid, type SolidKind, type SourceId } from "@prism/shared";
import { playGameAudio } from "../audio/gameAudio";
import type { Camera } from "../render/camera";
import type { Floor } from "../render/floor";
import { itemColor, lootName, rarityColor } from "../render/items";
import { breakColors } from "../render/terrain";
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
  /** Players who fired recently (minimap reveal). */
  firedAt: Map<number, number>;
  /** Kind of a destructible by id (for break sounds). */
  solidKind: (id: number) => SolidKind | null;
  /** The destructible itself (break particles in its own colors). */
  solidOf: (id: number) => Solid | null;
  /** You were eliminated (the game starts spectating your killer). */
  onEliminated: (killer: number) => void;
  /** Rarity (0..3) of the gun a fighter holds (richer shot sounds). */
  rarityOf: (id: number) => number;
  /** Where a fighter is, if visible (positional sounds for events without a position). */
  posOf: (id: number) => { x: number; y: number } | null;
}

const near = (ec: EventContext, x: number, y: number, r = 900) => {
  const l = ec.listener();
  return Math.hypot(x - l.x, y - l.y) < r;
};

export function handleEvent(ec: EventContext, e: GameEvent, immediate: boolean) {
  const { fx, cam } = ec;
  void immediate;
  if (e.t === "shoot" || e.t === "slash") ec.firedAt.set(e.by, performance.now());
  playGameAudio(e, { myId: ec.myId, rarityOf: ec.rarityOf, solidKind: ec.solidKind, posOf: ec.posOf, ownShotsPredicted: true });
  switch (e.t) {
    case "shoot": {
      const own = e.by === ec.myId;
      // Own bullet shots already flashed when predicted; lance beams are server-only.
      if (own && e.weapon !== "lance") break;
      const col = colorHex(ec.colorOf(e.by));
      fx.particles.cone(e.x, e.y, e.weapon === "shotgun" ? 8 : 4, e.angle, 0.6, col, 380, 0.18, 3);
      break;
    }
    case "slash": {
      const col = colorHex(ec.colorOf(e.by));
      fx.particles.cone(e.x, e.y, 10, e.angle, 1.1, col, 420, 0.25, 4);
      break;
    }
    case "deflect":
      fx.particles.burst(e.x, e.y, 10, "#ffffff", 320, 0.3, 5, PSHAPE.spark);
      break;
    case "hit": {
      const col = colorHex(ec.colorOf(e.target));
      if (e.amount > 0) fx.damage(e.x, e.y - PLAYER.radius, e.amount, e.crit, e.by === ec.myId ? "#ffffff" : col);
      fx.particles.burst(e.x, e.y, e.crit ? 14 : 8, e.crit ? PAL.gold : col, e.crit ? 420 : 300, 0.35, e.crit ? 9 : 6, PSHAPE.spark);
      const big = e.amount >= FX.bigHitThreshold || e.crit;
      if (e.target === ec.myId) {
        cam.addTrauma(0.18 + Math.min(0.35, e.amount / 60));
        if (big) fx.stop(FX.hitStopBig);
        ec.onSelfHit(e.amount);
      } else if (e.by === ec.myId) {
        if (big) fx.stop(FX.hitStopBig * 0.8);
        cam.addTrauma(big ? 0.12 : 0.04);
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
      if (e.victim === ec.myId) ec.onEliminated(e.killer);
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
    case "solidHit": {
      const solid = ec.solidOf(e.id);
      const cols = solid ? breakColors(solid) : [PAL.crystal];
      fx.particles.burst(e.x, e.y, 4, cols[0] ?? PAL.crystal, 220, 0.35, 4, PSHAPE.shard);
      if (cols[1]) fx.particles.burst(e.x, e.y, 2, cols[1], 180, 0.3, 3, PSHAPE.shard);
      break;
    }
    case "solidBroken": {
      const solid = ec.solidOf(e.id);
      const kind = solid?.kind ?? "crate";
      const cols = solid ? breakColors(solid) : [PAL.crystal];
      const main = cols[0] ?? PAL.crystal;
      if (kind === "glass") {
        // Glass bursts into a spray of glinting shards that skitter across the floor.
        fx.particles.burst(e.x, e.y, 36, cols[1] ?? main, 560, 0.9, 9, PSHAPE.shard);
        fx.particles.burst(e.x, e.y, 22, "#ffffff", 420, 0.55, 5, PSHAPE.shard);
        fx.particles.burst(e.x, e.y, 14, main, 300, 0.35, 4, PSHAPE.spark);
      } else {
        // Splinters / panels in the solid's own colors, plus a puff of dust.
        cols.forEach((c, i) => fx.particles.burst(e.x, e.y, i === 0 ? 20 : 10, c, 480 - i * 60, 0.85 + i * 0.1, 11 - i * 2, PSHAPE.shard));
        if (kind === "crate") fx.particles.burst(e.x, e.y, 10, "#d8d2c4", 200, 0.7, 14);
      }
      fx.ring(e.x, e.y, 10, 90, 0.4, main, 4);
      if (near(ec, e.x, e.y)) cam.addTrauma(0.12);
      break;
    }
    case "loot": {
      const col = e.kind === "weapon" ? rarityColor(e.rarity) : itemColor(e.kind);
      fx.particles.burst(e.x, e.y, 12, col, 240, 0.45, 6);
      if (e.by === ec.myId) {
        fx.label(e.x, e.y - 46, lootName({ kind: e.kind, weapon: e.weapon, rarity: e.rarity, throwable: "frag", count: 1 }).toUpperCase(), "", col);
      }
      break;
    }
    case "throw":
      if (e.by === ec.myId) fx.label(e.x, e.y - 50, ITEMS.throwables[e.item].name.toUpperCase(), "", ITEMS.throwables[e.item].color);
      break;
    case "heal":
      if (e.by !== ec.myId) break;
      if (e.done) {
        const col = e.item === "shield" ? "#5fd0ff" : PAL.heal;
        const l = ec.listener();
        fx.ring(l.x, l.y, 10, 80, 0.4, col, 4);
        fx.label(l.x, l.y - 60, e.item === "shield" ? `+${ITEMS.shield.amount} SHIELD` : `+${ITEMS[e.item].heal} HEALTH`, "", col);
      }
      break;
    case "supply":
      if (e.landed) {
        fx.particles.burst(e.x, e.y, 50, "#ffd34d", 600, 1, 10, PSHAPE.shard);
        fx.ring(e.x, e.y, 20, 220, 0.6, "#ffd34d", 6);
        ec.floor?.ripple(e.x, e.y, 2, "#ffd34d");
      } else {
        ec.banner("SUPPLY DROP INCOMING", "Epic and legendary gear: check the map", "#ffd34d");
      }
      break;
    case "shard":
      if (e.by === ec.myId) ec.banner("PRISM SHARD", "Pick a new power", "#ff7bf2");
      break;
    case "win": {
      const mine = e.winner === ec.myId;
      ec.banner(mine ? "VICTORY ROYALE" : e.winner ? `${ec.nameOf(e.winner).toUpperCase()} WINS` : "MATCH OVER", mine ? "Last one standing" : "", mine ? "#ffd34d" : "#ffffff");
      break;
    }
    case "dash": {
      const col = colorHex(ec.colorOf(e.by));
      fx.ring(e.x, e.y, 8, 70, 0.3, col, 3);
      break;
    }
    case "cast": {
      const col = colorHex(ec.colorOf(e.by));
      fx.ring(e.x, e.y, 20, 110, 0.45, col, 4);
      fx.particles.burst(e.x, e.y, 16, col, 280, 0.5, 7);
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
      break;
    }
    case "bounce":
      fx.particles.burst(e.x, e.y, 5, "#ffffff", 200, 0.25, 4, PSHAPE.spark);
      break;
    case "portal":
      fx.ring(e.x, e.y, 40, 6, 0.3, "#FF8A2B", 3);
      fx.ring(e.x2, e.y2, 6, 50, 0.3, "#3FA9FF", 3);
      break;
    case "wallSlam":
      fx.particles.burst(e.x, e.y, 22, "#ffffff", 500, 0.5, 8, PSHAPE.spark);
      fx.ring(e.x, e.y, 10, 120, 0.35, "#ffffff", 5);
      ec.floor?.ripple(e.x, e.y, 1.2, "#ffffff");
      if (near(ec, e.x, e.y)) cam.addTrauma(0.25);
      break;
    case "combo": {
      const label = e.stolen ? "STOLEN COMBO!" : "COMBO!";
      fx.label(e.x, e.y - 70, label, e.name, e.stolen ? "#ff7bf2" : "#ffd34d", true);
      fx.particles.burst(e.x, e.y, 30, "#ffd34d", 500, 0.8, 10);
      if (e.by === ec.myId) {
        ec.banner(label, e.name, e.stolen ? "#ff7bf2" : "#ffd34d");
        fx.aberrate(0.6);
      }
      break;
    }
    case "zoneStage":
      ec.banner("THE ZONE IS MOVING", "Get inside the dashed circle", "#ff3d6e");
      break;
    case "haunt": {
      const col = colorHex(ec.colorOf(e.by));
      fx.ring(e.x, e.y, 6, 100, 0.5, col, 4);
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
