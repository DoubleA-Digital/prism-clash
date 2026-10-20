// Data the game hands the HUD every frame.

import type { MapDef, NetEffect, NetGlobal, NetLoot, NetPlayer, NetSelf, Player } from "@prism/shared";
import type { KillFeedItem } from "../fx/events";
import type { Input } from "../input/input";

export interface HudInput {
  w: number;
  h: number;
  dpr: number;
  self: NetSelf | null;
  /** The predicted local player (inventory, timers), or null when dead. */
  me: Player | null;
  g: NetGlobal | null;
  players: NetPlayer[];
  effects: NetEffect[];
  map: MapDef;
  mapName: string;
  myId: number;
  meX: number;
  meY: number;
  names: (id: number) => string;
  colors: (id: number) => number;
  killFeed: KillFeedItem[];
  ping: number;
  showPing: boolean;
  fps: number;
  showFps: boolean;
  time: number;
  dt: number;
  input: Input;
  colorblind: boolean;
  /** Players the minimap may reveal (fired recently). */
  revealed: Set<number>;
  huntersEye: boolean;
  /** The item F would pick up right now. */
  interact: NetLoot | null;
  /** Total fighters this match. */
  fighters: number;
}
