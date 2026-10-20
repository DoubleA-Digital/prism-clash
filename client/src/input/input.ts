// Keyboard + mouse and Gamepad API input, with rebindable keys saved in localStorage.
// Produces held buttons, newly pressed edges, a movement vector and an aim source.

import { BTN } from "@prism/shared";

export type Action =
  | "up" | "down" | "left" | "right" | "shoot" | "scope" | "dash" | "reload" | "interact" | "slot1" | "slot2" | "swap"
  | "throw" | "heal" | "p1" | "p2" | "ult" | "scoreboard";

export const DEFAULT_BINDS: Record<Action, string> = {
  up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", shoot: "Mouse0", scope: "Mouse2", dash: "Space",
  reload: "KeyR", interact: "KeyF", slot1: "Digit1", slot2: "Digit2", swap: "Wheel", throw: "KeyG", heal: "KeyH",
  p1: "KeyQ", p2: "KeyE", ult: "KeyX", scoreboard: "Tab",
};

export const ACTION_LABELS: Record<Action, string> = {
  up: "Move up", down: "Move down", left: "Move left", right: "Move right", shoot: "Shoot", scope: "Scope (sniper)", dash: "Dash",
  reload: "Reload", interact: "Pick up / swap", slot1: "Weapon 1", slot2: "Weapon 2", swap: "Switch weapon", throw: "Throw grenade",
  heal: "Heal (hold)", p1: "Power 1", p2: "Power 2", ult: "Ultimate", scoreboard: "Scoreboard",
};

/** Gamepad buttons (standard mapping) for each game action. */
export const PAD: Partial<Record<Action, number>> = {
  shoot: 7, scope: 6, dash: 0, reload: 1, interact: 2, ult: 3, p1: 4, p2: 5, heal: 12, throw: 13, swap: 15,
};
export const PAD_LABELS: [string, string][] = [
  ["L stick", "Move"], ["R stick", "Aim"], ["RT", "Shoot"], ["LT", "Scope"], ["A", "Dash"], ["B", "Reload"], ["X", "Pick up"],
  ["Y", "Ultimate"], ["LB / RB", "Powers"], ["D-pad up", "Heal"], ["D-pad down", "Throw"], ["D-pad right", "Switch weapon"],
];

const STORE = "prism.binds.v2";

export function loadBinds(): Record<Action, string> {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...DEFAULT_BINDS, ...(JSON.parse(raw) as Partial<Record<Action, string>>) };
  } catch {
    /* storage blocked */
  }
  return { ...DEFAULT_BINDS };
}

export function saveBinds(b: Record<Action, string>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(b));
  } catch {
    /* storage blocked */
  }
}

export function keyLabel(code: string): string {
  if (code === "Mouse0") return "Left click";
  if (code === "Mouse2") return "Right click";
  if (code === "Mouse1") return "Middle click";
  if (code === "Wheel") return "Wheel";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code.replace("Left", "L ").replace("Right", "R ");
}

/** Short label for keycaps in the HUD. */
export function capLabel(code: string): string {
  if (code === "Mouse0") return "LMB";
  if (code === "Mouse2") return "RMB";
  if (code === "Mouse1") return "MMB";
  if (code === "Space") return "SPACE";
  return keyLabel(code).toUpperCase();
}

const DEADZONE = 0.22;

/** Game actions that map to a network button bit. */
const BITS: [Action, number][] = [
  ["shoot", BTN.shoot], ["dash", BTN.dash], ["p1", BTN.p1], ["p2", BTN.p2], ["ult", BTN.ult], ["reload", BTN.reload], ["interact", BTN.interact],
  ["swap", BTN.swap], ["slot1", BTN.slot1], ["slot2", BTN.slot2], ["throw", BTN.throw], ["heal", BTN.heal], ["scope", BTN.scope],
];

export class Input {
  binds = loadBinds();
  private down = new Set<string>();
  private edges = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  /** True when the last aim input came from a gamepad stick. */
  usingPad = false;
  padAim = 0;
  private padPrev = new Set<number>();
  private padEdges = new Set<number>();
  private padHeld = new Set<number>();
  padMove = { x: 0, y: 0 };
  /** Set while the rebinding UI waits for a key. */
  capture: ((code: string) => void) | null = null;
  enabled = true;
  /** Bits the game masks out this frame (e.g. 1/2 while the shard draft overlay owns them). */
  mask = 0;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (this.capture) {
        e.preventDefault();
        const c = this.capture;
        this.capture = null;
        c(e.code);
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      // Let Space/Enter press a focused menu button; otherwise keep the page from scrolling.
      if ((e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow")) && !(e.target instanceof HTMLButtonElement)) e.preventDefault();
      if (!this.down.has(e.code)) this.edges.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
    canvas.addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.usingPad = false;
    });
    canvas.addEventListener("mousedown", (e) => {
      const code = `Mouse${e.button}`;
      if (this.capture) {
        const c = this.capture;
        this.capture = null;
        c(code);
        return;
      }
      if (!this.down.has(code)) this.edges.add(code);
      this.down.add(code);
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (this.capture) {
        const c = this.capture;
        this.capture = null;
        c("Wheel");
        return;
      }
      if (Math.abs(e.deltaY) > 2) this.edges.add("Wheel");
    }, { passive: false });
    window.addEventListener("mouseup", (e) => this.down.delete(`Mouse${e.button}`));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  held(a: Action) {
    return this.down.has(this.binds[a]) || (PAD[a] !== undefined && this.padHeld.has(PAD[a] ?? -1));
  }

  pressed(a: Action) {
    return this.edges.has(this.binds[a]) || (PAD[a] !== undefined && this.padEdges.has(PAD[a] ?? -1));
  }

  /** A raw key edge (UI shortcuts like F1/F2/Escape). */
  keyPressed(code: string) {
    return this.edges.has(code);
  }

  padPressed(button: number) {
    return this.padEdges.has(button);
  }

  pollGamepad() {
    this.padEdges.clear();
    this.padHeld.clear();
    this.padMove = { x: 0, y: 0 };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    const dz = (x: number, y: number) => {
      const l = Math.hypot(x, y);
      if (l < DEADZONE) return { x: 0, y: 0, l: 0 };
      const k = Math.min(1, (l - DEADZONE) / (1 - DEADZONE)) / l;
      return { x: x * k, y: y * k, l: l * k };
    };
    const ls = dz(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const rs = dz(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    this.padMove = { x: ls.x, y: ls.y };
    if (rs.l > 0.3) {
      this.padAim = Math.atan2(rs.y, rs.x);
      this.usingPad = true;
    } else if (ls.l > 0.3 && this.usingPad) {
      this.padAim = Math.atan2(ls.y, ls.x);
    }
    pad.buttons.forEach((b, i) => {
      const on = b.pressed || b.value > 0.5;
      if (on) {
        this.padHeld.add(i);
        if (!this.padPrev.has(i)) this.padEdges.add(i);
      }
    });
    this.padPrev = new Set(this.padHeld);
  }

  /** Movement vector (keyboard or left stick). */
  move(): { x: number; y: number } {
    let x = (this.held("right") ? 1 : 0) - (this.held("left") ? 1 : 0);
    let y = (this.held("down") ? 1 : 0) - (this.held("up") ? 1 : 0);
    if (this.padMove.x || this.padMove.y) {
      x = this.padMove.x;
      y = this.padMove.y;
    }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  /** Game buttons (held) and edges (newly pressed) as BTN bitfields. */
  buttons(): { held: number; pressed: number } {
    if (!this.enabled) return { held: 0, pressed: 0 };
    let held = 0;
    let pressed = 0;
    for (const [a, bit] of BITS) {
      if (this.held(a)) held |= bit;
      if (this.pressed(a)) pressed |= bit;
    }
    return { held: held & ~this.mask, pressed: pressed & ~this.mask };
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.edges.clear();
  }

  clear() {
    this.down.clear();
    this.edges.clear();
  }

  get element() {
    return this.canvas;
  }
}
