// Player settings, saved in localStorage and applied immediately.

import { audio } from "./audio/audio";

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  shake: number;
  colorblind: boolean;
  showPing: boolean;
  showFps: boolean;
}

const KEY = "prism.settings.v1";
const DEFAULTS: Settings = { master: 0.8, music: 0.55, sfx: 0.9, shake: 1, colorblind: false, showPing: true, showFps: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage blocked */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function saveSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked */
  }
  audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
}

export function applySettings() {
  audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
}
