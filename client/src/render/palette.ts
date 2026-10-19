// Colors used across the renderer. Player colors come from shared config.

import { PLAYER_COLORS } from "@prism/shared";

export const PAL = {
  void: "#05040d",
  deep: "#0a0820",
  floor: "#11163a",
  grid: "#2a3a8a",
  edge: "#7cf6ff",
  zone: "#ff3d6e",
  zoneSafe: "#58f3ff",
  white: "#ffffff",
  gold: "#ffd34d",
  heal: "#5dff9d",
  cooldown: "#5fd0ff",
  ult: "#ffcc33",
  prism: "#ff7bf2",
  crystal: "#8fe7ff",
  danger: "#ff4a5e",
  text: "#e9ecff",
  dim: "#8a90c0",
} as const;

export const colorHex = (i: number): string => PLAYER_COLORS[i]?.hex ?? "#00F0FF";
