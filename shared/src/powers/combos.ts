// The six named combos. Each power calls triggerCombo at the exact moment its combo
// happens; using someone else's effect as an ingredient makes it a STOLEN COMBO.
// In the v2 world: Event Horizon Blade's orbiting glaive and Gravity Slam's doubled blast
// don't reach through walls; Prism Portal works with any gun's ricochet shots (rockets
// included); Storm Gate's chain is cut by walls on either side of the portals; Frozen Harvest
// catches any gun's projectiles; Lava Lock is unchanged (swaps land on clear floor).

import type { World } from "../sim/world";

export const COMBO_NAMES = {
  prismPortal: "PRISM PORTAL",
  eventHorizonBlade: "EVENT HORIZON BLADE",
  frozenHarvest: "FROZEN HARVEST",
  lavaLock: "LAVA LOCK",
  gravitySlam: "GRAVITY SLAM",
  stormGate: "STORM GATE",
} as const;
export type ComboKey = keyof typeof COMBO_NAMES;

/** Announces a combo. `ingredientOwners` are the owners of the effects involved. */
export function triggerCombo(w: World, by: number, key: ComboKey, x: number, y: number, ingredientOwners: readonly number[]) {
  if (!by) return;
  const stolen = ingredientOwners.some((o) => o !== 0 && o !== by);
  const name = COMBO_NAMES[key];
  // One announcement per combo per player per half second, so repeated hits don't spam.
  const recent = w.comboLog.some((c) => c.by === by && c.name === name && w.tick - c.tick < 15);
  if (recent) return;
  w.comboLog.push({ by, name, stolen, tick: w.tick });
  w.stat(by).combos++;
  w.emit({ t: "combo", by, name, stolen, x, y });
}
