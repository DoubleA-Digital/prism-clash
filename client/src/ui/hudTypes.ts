// Data the game hands the HUD every frame.

import type { NetGlobal, NetPlayer, NetSelf } from "@prism/shared";
import type { KillFeedItem } from "../fx/events";
import type { Input } from "../input/input";

export interface HudInput {
  w: number;
  h: number;
  dpr: number;
  self: NetSelf | null;
  ammo: { ammo: number; reload: number };
  g: NetGlobal | null;
  players: NetPlayer[];
  myId: number;
  meX: number;
  meY: number;
  arenaRadius: number;
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
  round: number;
}
