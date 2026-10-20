// Mini chibi heroes (PLAN.md 12.1): the public surface of the hero renderer.
//
//   drawHero(ctx, state)                       one hero in the world (see ChibiDrawState)
//   drawHeroPortrait(ctx, heroId, color, size) lobby / hero select / podium portrait
//   drawWeaponItem(ctx, id, rarity, x, y, t)   weapon lying on the floor as loot
//   drawWeaponIcon(ctx, id, rarity, x, y, w, h) HUD icon centered in a w x h box
//
// The hero catalog (ids, names, taglines, palettes) is pure data in @prism/shared (HEROES).

export { drawHero } from "./hero";
export { drawHeroPortrait } from "./portrait";
export { drawWeaponItem, drawWeaponIcon, weaponCanvas, WEAPON_ART } from "./weapons";
export { warmChibiCache, setChibiResolution, clearChibiCache, chibiCacheStats } from "./sprites";
export { benchmarkChibi, type ChibiBenchResult } from "./bench";
export { idleAnim, playing, CHIBI_TIMING, type ChibiAnim, type ChibiDrawState, type ChibiWeapon } from "./types";
