// THIRD-PARTY: for 5s you deal double damage to anyone someone else is already hurting
// (world.damage applies the doubling from the "thirdParty" status). The caster's "vulture"
// effect (n = 0) follows them as a crimson aura and keeps one marker effect (n = 1,
// link = target) on every enemy that currently qualifies, so the caster's client can draw
// crosshairs on exactly the players worth swooping in on.

import { POWERS } from "../config";
import { definePower } from "../sim/hooks";
import type { Effect } from "../sim/types";
import type { World } from "../sim/world";
import { glow, poly } from "./icon";

const C = POWERS.thirdParty;

function track(w: World, aura: Effect) {
  const owner = w.players.get(aura.owner);
  if (!owner || !owner.alive || (owner.status.thirdParty ?? 0) <= 0) {
    aura.dead = true;
    return;
  }
  aura.x = owner.x;
  aura.y = owner.y;
  // hits: target id → marker effect id
  aura.hits ??= new Map();
  for (const t of w.enemiesOf(owner)) {
    if (!w.hurtByOther(t, owner.id)) continue;
    const mid = aura.hits.get(t.id);
    const m = mid !== undefined ? w.effects.get(mid) : undefined;
    if (m && !m.dead) {
      m.life = m.age + C.markerLinger;
      continue;
    }
    const nm = w.spawnEffect({ kind: "vulture", owner: owner.id, source: "thirdParty", x: t.x, y: t.y, r: t.r, life: C.markerLinger, n: 1, link: t.id });
    aura.hits.set(t.id, nm.id);
  }
}

export const thirdParty = definePower({
  id: "thirdParty",
  name: "Third-Party",
  description: "For 5s, deal double damage to any enemy who is currently being damaged by someone else.",
  color: "#FF2B4A",
  cooldown: C.cooldown,
  drawIcon(ctx, size, t) {
    // Vulture wings over a crosshair
    const flap = Math.sin(t * 3) * 0.05;
    glow(ctx, "#FF2B4A", size * 0.12, size * 0.06);
    for (const s of [-1, 1]) {
      poly(ctx, [
        [0, -size * 0.06], [s * size * 0.2, -size * (0.22 + flap)], [s * size * 0.46, -size * (0.12 + flap)],
        [s * size * 0.34, -size * 0.04], [s * size * 0.4, size * 0.04], [s * size * 0.24, size * 0.02], [s * size * 0.26, size * 0.12], [0, size * 0.04],
      ]);
    }
    glow(ctx, "#FFD0D6", size * 0.06, size * 0.045);
    ctx.beginPath();
    ctx.arc(0, size * 0.22, size * 0.14, 0, Math.PI * 2);
    ctx.stroke();
    poly(ctx, [[0, size * 0.04], [0, size * 0.4]], false);
    poly(ctx, [[-size * 0.18, size * 0.22], [size * 0.18, size * 0.22]], false);
    ctx.fillStyle = "#FF2B4A";
    ctx.font = `900 ${size * 0.2}px Orbitron, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("×2", size * 0.3, size * 0.36);
  },
  onCast(w, p) {
    w.addStatus(p, "thirdParty", C.duration);
    for (const e of w.effects.values()) if (e.kind === "vulture" && e.owner === p.id && e.n === 0) e.dead = true;
    w.spawnEffect({ kind: "vulture", owner: p.id, source: "thirdParty", x: p.x, y: p.y, r: p.r, life: C.duration, n: 0 });
    return true;
  },
  effects: {
    vulture: {
      update(w, e) {
        if (e.n === 0) return track(w, e);
        const t = w.players.get(e.link);
        if (!t || !t.alive) {
          e.dead = true;
          return;
        }
        e.x = t.x;
        e.y = t.y;
      },
    },
  },
  bot: { role: "buff" },
});
