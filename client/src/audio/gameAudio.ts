// v2 game audio entry point. The integrator calls `playGameAudio(event, ctx)` for every sim
// GameEvent (from fx/events.ts), plus the per-frame helpers re-exported below. All sounds are
// synthesized recipes played through the positional mixer (distance falloff, pan, air
// low-pass) with per-type voice caps; the master bus has a glue compressor and a limiter.
//
// GameEvent → sound (own = the event is about ctx.myId; "pos" = positional at the event point)
// ------------------------------------------------------------------------------------------------
// shoot        gun:<weapon> close voice (pos, long range) or gun:far:<weapon> pop past 1250u;
//              + rarity:<1..3> layer (ctx.rarityOf). Own non-lance shots are skipped when
//              ctx.ownShotsPredicted (call weaponShot at prediction time). Lance stops its hum.
// slash        blade:swing (own centered)
// deflect      blade:deflect ping
// hit          own target: hurt · by you: hit / crit · nearby: hit (quiet); source blade adds
//              blade:hit sizzle; armor=true adds armor:break
// kill         kill crunch (pos) · killer=you: + kill:confirm · victim=you: + sting:eliminated
// impact       impact:bullet tick (pos, short range, cap 4)
// solidHit     crate:hit · barrel:hit · glass:hit · fence:hit (by ctx.solidKind)
// solidBroken  crate:break · glass:shatter · fence:break (barrels: their explode event)
// loot         weapon: pickup:weapon:<rarity> (3 = legendary sparkle jingle) · ammo: pickup:ammo
//              · bandage/medkit: pickup:item · shield: armor:equip · throwable: pickup:throwable
//              · shard: shard:chime. Own centered, others quiet and positional.
// reload       reload:<weapon> (mag out/in + slide, shell inserts + pump, bolt, tube, cell)
// throw        grenade:pin (not for mines) + grenade:throw whoosh
// heal         start (own): bandage / medkit loop (sustains) · done: heal:done / heal:doneBig,
//              shield: shield:charge
// supply       incoming: supply:alarm, then supply:whistle timed to end at landing (pos) ·
//              landed: supply:land thud (pos, very long range)
// shard        own: shard:draft whoosh
// explode      barrel: barrel:explode · frag: frag:explode · mine: mine:trigger · rocket:
//              rocket:explode · zone (supply landing): none · powers: boom
// bounce       ricochet (pitch rises per bounce)
// zoneStage    zone:warn
// win          winner=you: sting:victory (others: placementSting from the results screen)
// dash/cast/combo/portal/wallSlam/haunt   the v1 recipes (dash, cast:<id>, combo, portal, slam, haunt)
//
// Not event-driven (call from the client):
//   weaponShot(weapon, x, y, {own, rarity})   own shot at prediction time
//   dryFire(weapon) · weaponSwap(weapon, rarity)
//   lanceCharge(id, charge01, x?, y?) per frame while charging · stopLanceCharge(id)
//   stopHeal(id) when a heal channel is cancelled
//   trackFootsteps(movers, surfaceAt, myId) per frame: step:floor / step:water / step:bush
//   trackProjectiles(projectiles) per frame: grenade:bounce
//   updateMatchAudio({g, fighters, outside}) per frame: music intensity, duel layer, zone drone
//   placementSting(place) · resetGameAudio() when leaving a match
// Effect tracker (automatic via audio.matchFrame): smoke cloud → smoke:hiss, mine armed → mine:arm.

import { ITEMS, SUPPLY, type GameEvent, type SolidKind } from "@prism/shared";
import { audio, type SfxOpts } from "./audio";
import { resetMatchAudio, stopLanceCharge } from "./matchAudio";
import { sustains } from "./sustains";
import { bladeDeflect, bladeHit, bladeSwing, rocketExplosion, weaponReload, weaponShot } from "./weapons";

export { dryFire, weaponShot, weaponSwap } from "./weapons";
export { lanceCharge, matchIntensity, placementSting, stopHeal, stopLanceCharge, trackFootsteps, trackProjectiles, updateMatchAudio } from "./matchAudio";
export type { MatchAudioState, Mover, Surface } from "./matchAudio";

export interface GameAudioContext {
  myId: number;
  /** Rarity (0..3) of the weapon a fighter is holding, to enrich their shots. */
  rarityOf?: (playerId: number) => number;
  /** Kind of a destructible by id. */
  solidKind?: (id: number) => SolidKind | null;
  /** Where a fighter is (for events without a position, like others' reloads). */
  posOf?: (playerId: number) => { x: number; y: number } | null;
  /** Own gun shots were already played at prediction time (default true). */
  ownShotsPredicted?: boolean;
}

const SOLID_HIT: Partial<Record<SolidKind, string>> = { crate: "crate:hit", barrel: "barrel:hit", glass: "glass:hit", fence: "fence:hit" };
const SOLID_BREAK: Partial<Record<SolidKind, string>> = { crate: "crate:break", glass: "glass:shatter", fence: "fence:break" };
const WHISTLE_LEAD = 2.4;

const supplyTimers = new Set<number>();

/** Plays a sound centered for your own actions, positional (with options) for others'. */
function at(name: string, x: number, y: number, own: boolean, o: SfxOpts = {}) {
  audio.sfx(name, x, y, own ? { ...o, positional: false } : o);
}

export function playGameAudio(e: GameEvent, ctx: GameAudioContext) {
  const me = ctx.myId;
  switch (e.t) {
    case "shoot": {
      const own = e.by === me;
      if (e.weapon === "lance") stopLanceCharge(e.by);
      if (own && e.weapon !== "lance" && ctx.ownShotsPredicted !== false) return;
      weaponShot(e.weapon, e.x, e.y, { own, rarity: ctx.rarityOf?.(e.by) ?? 0 });
      return;
    }
    case "slash":
      bladeSwing(e.x, e.y, e.by === me);
      return;
    case "deflect":
      bladeDeflect(e.x, e.y);
      return;
    case "hit": {
      if (e.source === "blade") bladeHit(e.x, e.y);
      if (e.armor) at("armor:break", e.x, e.y, e.target === me, { gain: 0.8, group: "armor:break", cap: 2 });
      if (e.target === me) audio.sfx("hurt", e.x, e.y, { positional: false, group: "hurt", cap: 2 });
      else if (e.by === me) audio.sfx(e.crit ? "crit" : "hit", e.x, e.y, { group: "hit:own", cap: 3 });
      else audio.sfx("hit", e.x, e.y, { gain: 0.6, range: 700, group: "hit", cap: 3 });
      return;
    }
    case "kill":
      audio.sfx("kill", e.x, e.y, { gain: e.killer === me || e.victim === me ? 1 : 0.7, range: 1800, group: "kill", cap: 2 });
      if (e.killer === me && e.victim !== me) audio.sfx("kill:confirm", 0, 0, { positional: false, group: "confirm", cap: 1 });
      if (e.victim === me) audio.sfx("sting:eliminated", 0, 0, { positional: false, gain: 0.9, group: "sting", cap: 1 });
      return;
    case "impact":
      audio.sfx("impact:bullet", e.x, e.y, { gain: 0.45 * Math.min(2, e.size), range: 700, ref: 260, group: "impact", cap: 4 });
      return;
    case "solidHit": {
      const name = SOLID_HIT[ctx.solidKind?.(e.id) ?? "crate"] ?? "crate:hit";
      audio.sfx(name, e.x, e.y, { gain: 0.6, range: 1000, group: "solidHit", cap: 4 });
      return;
    }
    case "solidBroken": {
      const name = SOLID_BREAK[ctx.solidKind?.(e.id) ?? "crate"];
      if (name) audio.sfx(name, e.x, e.y, { gain: 0.9, range: 1800, group: "solidBroken", cap: 3 });
      return;
    }
    case "loot": {
      const own = e.by === me;
      const name =
        e.kind === "weapon" ? `pickup:weapon:${Math.max(0, Math.min(3, e.rarity))}`
        : e.kind === "ammo" ? "pickup:ammo"
        : e.kind === "shield" ? "armor:equip"
        : e.kind === "throwable" ? "pickup:throwable"
        : e.kind === "shard" ? "shard:chime"
        : "pickup:item";
      at(name, e.x, e.y, own, { gain: own ? 1.3 : 0.6, range: 700, ref: 260, group: "pickup", cap: 3 });
      return;
    }
    case "reload": {
      const own = e.by === me;
      const p = own ? audio.listenerPos : ctx.posOf?.(e.by);
      if (p) weaponReload(e.weapon, p.x, p.y, own);
      return;
    }
    case "throw": {
      const own = e.by === me;
      if (e.item !== "mine") at("grenade:pin", e.x, e.y, own, { gain: 0.8, range: 900, group: "throw", cap: 3 });
      at("grenade:throw", e.x, e.y, own, { gain: 0.7, range: 900, group: "throw", cap: 3 });
      return;
    }
    case "heal": {
      const own = e.by === me;
      const p = own ? null : ctx.posOf?.(e.by);
      if (!own && !p) return;
      const opts = { x: p?.x, y: p?.y, level: own ? 1 : 0.6 };
      if (!e.done) {
        if (e.item !== "shield") sustains.hold(`heal:${e.by}`, e.item, { ...opts, ttlMs: ITEMS[e.item].time * 1000 + 400 });
        return;
      }
      sustains.release(`heal:${e.by}`);
      const name = e.item === "shield" ? "shield:charge" : e.item === "medkit" ? "heal:doneBig" : "heal:done";
      audio.sfx(name, p?.x ?? 0, p?.y ?? 0, { positional: !own, gain: own ? 0.9 : 0.5, range: 800, group: "heal", cap: 2 });
      return;
    }
    case "supply":
      if (e.landed) {
        audio.sfx("supply:land", e.x, e.y, { gain: 1.1, range: 4200, ref: 800, group: "supply", cap: 2 });
        return;
      }
      audio.sfx("supply:alarm", 0, 0, { positional: false, gain: 0.8, group: "alarm", cap: 1 });
      scheduleWhistle(e.x, e.y);
      return;
    case "shard":
      if (e.by === me) audio.sfx("shard:draft", 0, 0, { positional: false, gain: 0.8 });
      return;
    case "explode":
      explosion(e.source, e.x, e.y, e.r);
      return;
    case "bounce":
      audio.sfx("ricochet", e.x, e.y, { pitch: 1 + e.n * 0.12, gain: 0.55, range: 1000, group: "ricochet", cap: 3 });
      return;
    case "zoneStage":
      audio.sfx("zone:warn", 0, 0, { positional: false, gain: 0.9, group: "zone", cap: 1 });
      return;
    case "win":
      if (e.winner === me) audio.sfx("sting:victory", 0, 0, { positional: false, group: "sting", cap: 1 });
      return;
    case "dash":
      audio.sfx("dash", e.x, e.y, { gain: e.by === me ? 0.9 : 0.5, group: "dash", cap: 3 });
      return;
    case "cast":
      audio.sfx(`cast:${e.power}`, e.x, e.y, { range: 2000, group: "cast", cap: 4 });
      return;
    case "combo":
      audio.sfx("combo", e.x, e.y);
      return;
    case "portal":
      audio.sfx("portal", e.x2, e.y2, { gain: 0.6 });
      return;
    case "wallSlam":
      audio.sfx("slam", e.x, e.y, { group: "slam", cap: 2 });
      return;
    case "haunt":
      audio.sfx("haunt", e.x, e.y);
      return;
  }
}

function explosion(source: string, x: number, y: number, r: number) {
  switch (source) {
    case "barrel":
      audio.sfx("barrel:explode", x, y, { gain: 1, range: 3600, ref: 700, group: "explosion", cap: 4 });
      return;
    case "frag":
      audio.sfx("frag:explode", x, y, { gain: 0.95, range: 3200, ref: 640, group: "explosion", cap: 4 });
      return;
    case "mine":
      audio.sfx("mine:trigger", x, y, { gain: 0.95, range: 2200, ref: 520, group: "explosion", cap: 4 });
      return;
    case "rocket":
      rocketExplosion(x, y);
      return;
    case "zone":
      return;
    default:
      audio.sfx("boom", x, y, { gain: Math.min(1.3, 0.6 + r / 300), range: 2400, group: "explosion", cap: 4 });
  }
}

/** The falling whistle starts so that it ends as the crate lands. */
function scheduleWhistle(x: number, y: number) {
  const id = window.setTimeout(() => {
    supplyTimers.delete(id);
    audio.sfx("supply:whistle", x, y, { gain: 1, range: 4200, ref: 900, group: "supply", cap: 2 });
  }, Math.max(0, SUPPLY.fallTime - WHISTLE_LEAD) * 1000);
  supplyTimers.add(id);
}

/** Leaving a match: stop loops, pending supply whistles and trackers. */
export function resetGameAudio() {
  for (const id of supplyTimers) window.clearTimeout(id);
  supplyTimers.clear();
  resetMatchAudio();
}
