// Shared UI types. A screen is a DOM element plus optional hooks the router calls when
// the session changes (update) or every frame (tick), so state changes never rebuild the screen.

export interface Built {
  el: HTMLElement;
  /** Called when session data changed but the screen's structural key did not. */
  update?: () => void;
  /** Called every animation frame while the screen is showing (timers). */
  tick?: () => void;
  /** Milliseconds the router should keep this screen up before swapping it out (lets a pick animation finish). */
  hold?: () => number;
  /** Called when the screen is torn down. */
  dispose?: () => void;
}
