// Hero catalog: the 8 mini chibi heroes. Looks only (every hero has the same stats, so the
// game stays fair). Pure data so the server and lobby can validate and store hero ids; the
// client's chibi renderer reads the palette and style params to draw them.

export const HERO_IDS = ["glitch", "blaze", "nova", "drip", "vex", "pixel", "riot", "groove"] as const;
export type HeroId = (typeof HERO_IDS)[number];

/** What sits on the hero's head (the main silhouette read). */
export type HeroHeadgear = "hood" | "spiky" | "helmet" | "beanie" | "ponytail" | "catphones" | "bandana" | "afro";
/** Torso outfit style. */
export type HeroOutfit = "hoodie" | "tank" | "flightsuit" | "puffer" | "coat" | "tee" | "vest" | "track";
/** Face treatment (eyes, brows, mouth, eyewear). */
export type HeroFace = "glow" | "grin" | "visor" | "chill" | "scope" | "sparkle" | "smirk" | "shades";

/** Base colors. The renderer derives cel-shade and highlight tones from these. */
export interface HeroPalette {
  skin: string;
  hair: string;
  /** Headgear: hood, helmet, beanie, headphones, bandana (unused by plain hairstyles). */
  gear: string;
  outfit: string;
  /** Secondary outfit color: stripes, straps, pants, collar. */
  trim: string;
  /** One small emissive neon detail (glowing eyes, visor, cat ears, lenses). */
  accent: string;
  hands: string;
  shoe: string;
}

export interface HeroDef {
  id: HeroId;
  name: string;
  tagline: string;
  palette: HeroPalette;
  headgear: HeroHeadgear;
  outfit: HeroOutfit;
  face: HeroFace;
}

export const HEROES: Record<HeroId, HeroDef> = {
  glitch: {
    id: "glitch", name: "Glitch", tagline: "Already inside your system.", headgear: "hood", outfit: "hoodie", face: "glow",
    palette: { skin: "#e8b48c", hair: "#1d2438", gear: "#2c3a63", outfit: "#2c3a63", trim: "#171d33", accent: "#3dffb5", hands: "#e8b48c", shoe: "#1d2236" },
  },
  blaze: {
    id: "blaze", name: "Blaze", tagline: "Hits first. Asks never.", headgear: "spiky", outfit: "tank", face: "grin",
    palette: { skin: "#ffcfa3", hair: "#ff5a24", gear: "#ffb02e", outfit: "#eef1fa", trim: "#3b3f99", accent: "#ffb02e", hands: "#e8344e", shoe: "#e8344e" },
  },
  nova: {
    id: "nova", name: "Nova", tagline: "Born in the cockpit.", headgear: "helmet", outfit: "flightsuit", face: "visor",
    palette: { skin: "#c98e64", hair: "#3b2a20", gear: "#f2f4ff", outfit: "#ff8a2b", trim: "#3d4566", accent: "#58f3ff", hands: "#f2f4ff", shoe: "#3d4566" },
  },
  drip: {
    id: "drip", name: "Drip", tagline: "Fresh fit, fresher aim.", headgear: "beanie", outfit: "puffer", face: "chill",
    palette: { skin: "#8d5a3b", hair: "#1a1414", gear: "#ffd23d", outfit: "#7b5cff", trim: "#2a2350", accent: "#ff4fd8", hands: "#8d5a3b", shoe: "#f4f4ff" },
  },
  vex: {
    id: "vex", name: "Vex", tagline: "One shot. One story.", headgear: "ponytail", outfit: "coat", face: "scope",
    palette: { skin: "#f3c5a3", hair: "#3a2466", gear: "#ff3d5a", outfit: "#3f6b55", trim: "#1f3329", accent: "#ff3d5a", hands: "#f3c5a3", shoe: "#1f2a24" },
  },
  pixel: {
    id: "pixel", name: "Pixel", tagline: "GG before it starts.", headgear: "catphones", outfit: "tee", face: "sparkle",
    palette: { skin: "#ffe0c7", hair: "#ff9fd2", gear: "#f6f3ff", outfit: "#8a7dff", trim: "#3a3470", accent: "#ff5fc8", hands: "#ffe0c7", shoe: "#ff9fd2" },
  },
  riot: {
    id: "riot", name: "Riot", tagline: "Rules are a suggestion.", headgear: "bandana", outfit: "vest", face: "smirk",
    palette: { skin: "#d9a07a", hair: "#2bdc9c", gear: "#e8344e", outfit: "#2b2536", trim: "#e8344e", accent: "#ff3d6e", hands: "#d9a07a", shoe: "#1c1824" },
  },
  groove: {
    id: "groove", name: "Groove", tagline: "Keeps the beat, drops the heat.", headgear: "afro", outfit: "track", face: "shades",
    palette: { skin: "#6b3f26", hair: "#24170f", gear: "#ffd23d", outfit: "#12b5a6", trim: "#f4f4ff", accent: "#ff6bd5", hands: "#6b3f26", shoe: "#f4f4ff" },
  },
};

export const DEFAULT_HERO: HeroId = "blaze";
export const isHeroId = (s: unknown): s is HeroId => typeof s === "string" && (HERO_IDS as readonly string[]).includes(s);
/** Compact wire index for a hero id (and back). */
export const heroIndex = (id: HeroId): number => HERO_IDS.indexOf(id);
export const heroAt = (i: number): HeroId => HERO_IDS[i] ?? DEFAULT_HERO;
