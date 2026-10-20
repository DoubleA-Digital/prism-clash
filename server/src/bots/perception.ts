// What a bot knows about enemies, gathered honestly. Sight covers the box a player's screen
// shows, then applies exactly the rules that decide what a human's client is sent (walls,
// smoke, bushes, cloaks) via World.visibleTo.
// Hearing: gunshots, explosions, throws and blade swings within range give a fuzzy position.
// Getting shot reveals roughly where it came from. Nothing else: no wallhacks.

import { activeWeapon, BOTS, FX, type GameEvent, type Player, type Rng, type WeaponId, type World } from "@prism/shared";

const P = BOTS.perception;

export interface Contact {
  id: number;
  /** Last known position and velocity (exact while visible, fuzzy when heard). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  visible: boolean;
  /** Last time we saw them (-Infinity if never). */
  seenAt: number;
  /** Last time we heard or felt them. */
  heardAt: number;
  /** Earliest time we react to this sighting (reaction delay). */
  noticeAt: number;
  /** What we could see last time: health, armor, gun in hand. */
  hp: number;
  armor: number;
  weapon: WeaponId;
  rarity: number;
  /** They shot at us recently (we felt it). */
  hitUsAt: number;
}

export interface Noise {
  x: number;
  y: number;
  at: number;
  /** Who made it, when the sound identifies a player (0 = unknown, e.g. a barrel). */
  by: number;
}

function hearRange(e: GameEvent): number {
  const H = P.hearing;
  switch (e.t) {
    case "shoot":
      return e.weapon === "sniper" ? H.sniper : e.weapon === "rocket" ? H.rocket : e.weapon === "lance" ? H.lance : H.gun;
    case "explode":
      return H.explosion;
    case "throw":
      return H.throw;
    case "slash":
      return H.blade;
    default:
      return 0;
  }
}

export class Perception {
  contacts = new Map<number, Contact>();
  noises: Noise[] = [];
  lastHitAt = -99;
  /** Damage taken recently: [time, amount] samples for burst checks. */
  private hurt: { at: number; amount: number }[] = [];
  private lastTick = -1;

  constructor(private reaction: number, private hearing: number, private rng: Rng) {}

  private contact(id: number): Contact {
    let c = this.contacts.get(id);
    if (!c) {
      c = { id, x: 0, y: 0, vx: 0, vy: 0, visible: false, seenAt: -Infinity, heardAt: -Infinity, noticeAt: Infinity, hp: 100, armor: 0, weapon: "pistol", rarity: 0, hitUsAt: -99 };
      this.contacts.set(id, c);
    }
    return c;
  }

  /** Every tick: take in the sounds and hits from the last world step. */
  listen(w: World, me: Player) {
    if (w.tick === this.lastTick) return;
    this.lastTick = w.tick;
    const now = w.time;
    for (const e of w.events) {
      if (e.t === "hit") {
        if (e.target !== me.id) continue;
        this.hurt.push({ at: now, amount: e.amount });
        if (!e.by || e.by === me.id) continue;
        this.lastHitAt = now;
        const a = w.players.get(e.by);
        const c = this.contact(e.by);
        c.hitUsAt = now;
        if (a && !c.visible) {
          c.x = a.x + (this.rng.next() * 2 - 1) * P.hitFuzz;
          c.y = a.y + (this.rng.next() * 2 - 1) * P.hitFuzz;
          c.vx = 0;
          c.vy = 0;
          c.heardAt = now;
        }
        continue;
      }
      if (e.t === "kill") {
        this.contacts.delete(e.victim);
        continue;
      }
      if (e.t !== "shoot" && e.t !== "explode" && e.t !== "throw" && e.t !== "slash") continue;
      const range = hearRange(e) * this.hearing;
      const by = e.by;
      if (by === me.id) continue;
      const d = Math.hypot(e.x - me.x, e.y - me.y);
      if (d > range) continue;
      const fuzz = d * P.soundFuzz;
      const x = e.x + (this.rng.next() * 2 - 1) * fuzz;
      const y = e.y + (this.rng.next() * 2 - 1) * fuzz;
      this.noises.push({ x, y, at: now, by: e.t === "explode" ? 0 : by });
      if (e.t === "explode" || !by) continue;
      const c = this.contact(by);
      if (c.visible) continue;
      c.x = x;
      c.y = y;
      c.vx = 0;
      c.vy = 0;
      c.heardAt = now;
    }
  }

  /** At think rate: who is in sight right now? Also forgets stale contacts and noises. */
  look(w: World, me: Player) {
    const now = w.time;
    // The same box a player's screen shows (bigger while scoped with a sniper).
    const zoom = activeWeapon(me)?.id === "sniper" ? FX.scopeZoom : 1;
    const halfH = (FX.viewHeight / 2) * zoom + P.viewMargin;
    const halfW = ((FX.viewHeight * P.viewAspect) / 2) * zoom + P.viewMargin;
    for (const o of w.players.values()) {
      if (o.id === me.id) continue;
      if (!o.alive) {
        this.contacts.delete(o.id);
        continue;
      }
      const d2 = (o.x - me.x) ** 2 + (o.y - me.y) ** 2;
      let vis = Math.abs(o.x - me.x) <= halfW && Math.abs(o.y - me.y) <= halfH && w.visibleTo(me, o);
      if (vis && (o.status.cloaked ?? 0) > 0 && (me.status.hunter ?? 0) <= 0 && d2 > P.cloakSeeRange ** 2) vis = false;
      const c = vis ? this.contact(o.id) : this.contacts.get(o.id);
      if (!c) continue;
      if (!vis) {
        c.visible = false;
        continue;
      }
      if (!c.visible && now - c.seenAt > P.renoticeSeconds) c.noticeAt = now + this.reaction * (0.8 + this.rng.next() * 0.4);
      c.visible = true;
      c.seenAt = now;
      c.x = o.x;
      c.y = o.y;
      c.vx = o.vx + o.px;
      c.vy = o.vy + o.py;
      c.hp = o.hp;
      c.armor = o.armor;
      const gun = activeWeapon(o);
      c.weapon = gun?.id ?? "pistol";
      c.rarity = gun?.rarity ?? 0;
    }
    for (const [id, c] of this.contacts) {
      if (!c.visible && Math.max(c.seenAt, c.heardAt) < now - P.forgetSeconds) this.contacts.delete(id);
    }
    if (this.noises.length) this.noises = this.noises.filter((n) => n.at > now - P.noiseSeconds);
    if (this.hurt.length) this.hurt = this.hurt.filter((h) => h.at > now - 3);
  }

  visible(): Contact[] {
    return [...this.contacts.values()].filter((c) => c.visible);
  }

  /** Contacts seen or heard within `seconds`. */
  recent(now: number, seconds: number): Contact[] {
    return [...this.contacts.values()].filter((c) => c.visible || Math.max(c.seenAt, c.heardAt) > now - seconds);
  }

  /** Damage taken within the last `seconds`. */
  damageWithin(now: number, seconds: number): number {
    let s = 0;
    for (const h of this.hurt) if (h.at > now - seconds) s += h.amount;
    return s;
  }

  /** Seconds since anything threatening was seen, heard nearby or felt. */
  quietFor(now: number, me: Player, near = 900): number {
    let last = this.lastHitAt;
    for (const c of this.contacts.values()) {
      if (c.visible) return 0;
      if (Math.hypot(c.x - me.x, c.y - me.y) < near) last = Math.max(last, c.seenAt, c.heardAt);
    }
    return now - last;
  }

  /** The most recent noise from someone else's fight (for third-partying). */
  latestFight(now: number, maxAge: number): Noise | null {
    let best: Noise | null = null;
    for (const n of this.noises) if (n.at > now - maxAge && (!best || n.at > best.at)) best = n;
    return best;
  }
}
