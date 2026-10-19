// Keyboard + mouse and Gamepad API input, with rebindable keys saved in localStorage.
// Produces held buttons, newly pressed edges, a movement vector and an aim source.

import { BTN } from "@prism/shared";

export type Action = "up" | "down" | "left" | "right" | "shoot" | "dash" | "p1" | "p2" | "p3" | "ult" | "scoreboard";

export const DEFAULT_BINDS: Record<Action, string> = {
  up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", shoot: "Mouse0", dash: "Space",
  p1: "KeyQ", p2: "KeyE", p3: "KeyF", ult: "KeyR", scoreboard: "Tab",
};

export const ACTION_LABELS: Record<Action, string> = {
  up: "Move up", down: "Move down", left: "Move left", right: "Move right", shoot: "Shoot", dash: "Dash",
  p1: "Power 1", p2: "Power 2", p3: "Prism power", ult: "Ultimate", scoreboard: "Scoreboard",
};

const STORE = "prism.binds.v1";

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
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code.replace("Left", "L ").replace("Right", "R ");
}

const DEADZONE = 0.22;

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
    window.addEventListener("mouseup", (e) => this.down.delete(`Mouse${e.button}`));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  held(a: Action) {
    return this.down.has(this.binds[a]);
  }

  pressed(a: Action) {
    return this.edges.has(this.binds[a]);
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
    if (ls.l > 0 || rs.l > 0 || this.padHeld.size) this.usingPad = this.usingPad || rs.l > 0;
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

  /** Game buttons (held) and edges (newly pressed) as BTN bitfields. Gamepad: RT shoot, A dash, LB/RB powers, X prism, Y ult. */
  buttons(): { held: number; pressed: number } {
    let held = 0;
    let pressed = 0;
    const map: [Action, number, number][] = [["shoot", BTN.shoot, 7], ["dash", BTN.dash, 0], ["p1", BTN.p1, 4], ["p2", BTN.p2, 5], ["p3", BTN.p3, 2], ["ult", BTN.ult, 3]];
    for (const [a, bit, padBtn] of map) {
      if (this.held(a) || this.padHeld.has(padBtn)) held |= bit;
      if (this.pressed(a) || this.padEdges.has(padBtn)) pressed |= bit;
    }
    if (!this.enabled) return { held: 0, pressed: 0 };
    return { held, pressed };
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
