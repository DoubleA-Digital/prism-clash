// Shared harness for the v2 powers tests: a test-yard World with a caster holding a power
// and/or ultimate, enemies, walls on demand, guns in hand, and invariant checks
// ("nobody ends up inside geometry").

import {
  addSolid, BTN, circleBlocked, newWeapon, World,
  type Effect, type GameEvent, type InputFrame, type Player, type PowerId, type SolidKind, type UltId, type WeaponId,
} from "@prism/shared";

export const DT = 1 / 30;
export const ticks = (seconds: number) => Math.ceil(seconds * 30);
let seq = 0;

export interface Move {
  mx?: number;
  my?: number;
  buttons?: number;
  pressed?: number;
  aim?: number;
}

export interface Kit {
  w: World;
  caster: Player;
  enemies: Player[];
  events: GameEvent[];
  /** Steps n ticks; `moves(i, p)` gives each player's input for tick i (default idle). */
  run(n: number, moves?: (i: number, p: Player) => Move | undefined): void;
  /** One tick with only the caster acting. */
  act(m: Move): void;
  cast(slot?: 0 | 1, aim?: number): void;
  ult(aim?: number): void;
  fx(kind: Effect["kind"]): Effect[];
  wall(kind: SolidKind, x0: number, y0: number, x1: number, y1: number): ReturnType<typeof addSolid>;
  give(p: Player, id: WeaponId, rarity?: number): void;
}

export function kit(opts: { powers?: PowerId[]; ult?: UltId; enemies?: [number, number][]; seed?: number } = {}): Kit {
  const w = new World("testYard", opts.seed ?? 21, { loot: false });
  const caster = w.addPlayer(1, "CASTER", 0, false);
  caster.x = 0;
  caster.y = 0;
  caster.aim = 0;
  const pw = opts.powers ?? [];
  caster.slots = [pw[0] ? { id: pw[0], cd: 0, recast: 0 } : null, pw[1] ? { id: pw[1], cd: 0, recast: 0 } : null];
  caster.ult = opts.ult ? { id: opts.ult, charge: 100 } : null;
  const enemies = (opts.enemies ?? []).map(([x, y], i) => {
    const e = w.addPlayer(2 + i, `E${i}`, 1 + i, true);
    e.x = x;
    e.y = y;
    e.aim = Math.PI;
    return e;
  });
  const events: GameEvent[] = [];
  const k: Kit = {
    w, caster, enemies, events,
    run(n, moves) {
      for (let i = 0; i < n; i++) {
        const m = new Map<number, InputFrame[]>();
        for (const p of w.players.values()) {
          const mv = moves?.(i, p) ?? {};
          m.set(p.id, [{ seq: ++seq, mx: mv.mx ?? 0, my: mv.my ?? 0, aim: mv.aim ?? p.aim, buttons: mv.buttons ?? 0, pressed: mv.pressed ?? 0, dt: DT, shotId: 0 }]);
        }
        w.step(m);
        events.push(...w.events);
      }
    },
    act(mv) {
      k.run(1, (_i, p) => (p === caster ? mv : undefined));
    },
    cast(slot = 0, aim = caster.aim) {
      caster.aim = aim;
      k.act({ pressed: slot === 0 ? BTN.p1 : BTN.p2, aim });
    },
    ult(aim = caster.aim) {
      caster.aim = aim;
      k.act({ pressed: BTN.ult, buttons: BTN.ult, aim });
    },
    fx(kind) {
      return [...w.effects.values()].filter((e) => e.kind === kind && !e.dead);
    },
    wall(kind, x0, y0, x1, y1) {
      return addSolid(w.map, kind, x0, y0, x1, y1);
    },
    give(p, id, rarity = 0) {
      p.inv.weapons[1] = newWeapon(id, rarity);
      p.inv.active = 1;
    },
  };
  return k;
}

/** Bodies (players, clones, decoys, flying glaives) that overlap terrain, as readable labels. */
export function stuckInGeometry(w: World): string[] {
  const out: string[] = [];
  const h = w.map.half;
  for (const p of w.players.values()) {
    if (!p.alive) continue;
    if (circleBlocked(w.map, p.x, p.y, p.r - 1.5) || Math.abs(p.x) > h || Math.abs(p.y) > h) out.push(`player ${p.id} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  for (const e of w.effects.values()) {
    if (e.dead) continue;
    const body = e.kind === "clone" || e.kind === "decoy" || (e.kind === "glaive" && e.n < 2);
    if (body && circleBlocked(w.map, e.x, e.y, e.r - 1.5)) out.push(`${e.kind} ${e.id} at ${e.x.toFixed(1)},${e.y.toFixed(1)}`);
  }
  return out;
}
