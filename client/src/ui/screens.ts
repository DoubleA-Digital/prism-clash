// Screen router: shows the right DOM screen for the session phase, plus overlays
// (settings, how-to, Tab scoreboard, F1/F2 panels, spectator bar, replay bars, toasts).
// Screens re-render only when the data they show changes, so typing is never interrupted.

import { audio } from "../audio/audio";
import type { Game } from "../game";
import { session } from "../net/session";
import { clear, h } from "./dom";
import { lobbyScreen } from "./lobby";
import { menuScreen } from "./menu";
import { debugPanel, howToModal, netPanel, settingsModal } from "./panels";
import { draftScreen, revealScreen, ultScreen } from "./picks";
import { matchEndScreen, scoreboard, standingsScreen } from "./results";

export class Screens {
  private root: HTMLElement;
  private layer = h("div", { style: { position: "absolute", inset: "0", pointerEvents: "none" } });
  private screenKey = "";
  private modal: HTMLElement | null = null;
  private net: ReturnType<typeof netPanel> | null = null;
  private debug: ReturnType<typeof debugPanel> | null = null;
  private board: HTMLElement | null = null;
  private spectate: HTMLElement | null = null;
  private replayEl: HTMLElement | null = null;
  private autoStart = false;
  private practiceRequested = false;

  constructor(private game: Game) {
    const root = document.getElementById("ui");
    if (!root) throw new Error("#ui missing");
    this.root = root;
    this.root.append(this.layer);
    session.subscribe(() => this.sync());
    window.addEventListener("keydown", (e) => this.keys(e));
    this.sync();
    game.onFrame = () => this.frame();
  }

  private toast(text: string) {
    const t = h("div.toast", null, text);
    this.root.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  private key(): string {
    const s = session;
    switch (s.phase) {
      case "menu":
        return `menu|${s.lastError ?? ""}`;
      case "lobby":
        return `lobby|${JSON.stringify(s.room)}`;
      case "ultSelect":
        return `ult|${s.ultOptions.join()}|${s.myPick}`;
      case "draft":
        return `draft|${s.round}|${s.draftPickNumber}|${s.draftOptions.join()}|${s.myPick}|${[...s.draftLocked].join()}`;
      case "countdown":
        return `countdown|${s.round}|${s.loadouts.length}`;
      case "round":
        return "round";
      case "replay":
        return "replay";
      case "standings":
        return `standings|${s.round}|${JSON.stringify(s.room?.players.map((p) => p.points))}`;
      case "matchEnd":
        return `matchEnd|${s.matchEnd ? 1 : 0}`;
      default:
        return s.phase;
    }
  }

  private sync() {
    // Practice: once our fresh room exists and we're host, start right away.
    if (this.autoStart && session.phase === "lobby" && session.room && session.room.hostId === session.myId) {
      this.autoStart = false;
      session.lobbySet({ fillBots: true });
      setTimeout(() => session.start(), 250);
    }
    if (this.practiceRequested && session.myId && session.phase === "menu" && !session.room) this.practiceRequested = false;
    const key = this.key();
    if (key === this.screenKey) return;
    this.screenKey = key;
    clear(this.layer);
    const el = this.build();
    if (el) {
      el.style.pointerEvents = "auto";
      this.layer.append(el);
    }
    this.focusFirst();
  }

  private build(): HTMLElement | null {
    switch (session.phase) {
      case "menu":
        return menuScreen({
          openSettings: () => this.openModal(settingsModal(this.game.input, () => this.closeModal())),
          openHowTo: () => this.openModal(howToModal(() => this.closeModal())),
          practice: () => {
            this.autoStart = true;
            this.practiceRequested = true;
            session.createRoom(new URLSearchParams(location.search).has("test"));
          },
        });
      case "lobby":
        return session.room ? lobbyScreen(session.room, (t) => this.toast(t)) : null;
      case "ultSelect":
        return ultScreen();
      case "draft":
        return draftScreen();
      case "countdown":
        return session.loadouts.length ? revealScreen() : null;
      case "standings":
        return standingsScreen();
      case "matchEnd":
        return matchEndScreen();
      default:
        return null;
    }
  }

  private focusFirst() {
    const first = this.layer.querySelector<HTMLElement>("[data-nav]");
    if (first && !(document.activeElement instanceof HTMLInputElement)) first.focus({ preventScroll: true });
  }

  private openModal(el: HTMLElement) {
    this.closeModal();
    this.modal = el;
    this.root.append(el);
    audio.unlock();
  }

  private closeModal() {
    this.modal?.remove();
    this.modal = null;
  }

  private keys(e: KeyboardEvent) {
    if (e.code === "Escape" && this.modal) {
      this.closeModal();
      return;
    }
    if (e.code === "F2") {
      e.preventDefault();
      if (this.net) {
        this.net.el.remove();
        this.net = null;
      } else {
        this.net = netPanel();
        this.root.append(this.net.el);
      }
    }
    if (e.code === "F1") {
      e.preventDefault();
      if (this.debug) {
        this.debug.el.remove();
        this.debug = null;
        this.game.debugHitboxes = false;
      } else {
        this.debug = debugPanel(() => ({ fps: this.game.fps, frameMs: this.game.frameMs, particles: this.game.fx.particles.count }));
        this.root.append(this.debug.el);
        this.game.debugHitboxes = true;
      }
    }
    // Arrow-key / Enter navigation for menus (gamepad D-pad maps here too).
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.code) && session.phase !== "round") this.moveFocus(e.code === "ArrowDown" || e.code === "ArrowRight" ? 1 : -1);
  }

  private moveFocus(dir: number) {
    const scope = this.modal ?? this.layer;
    const items = [...scope.querySelectorAll<HTMLElement>("[data-nav], button, input")].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + dir + items.length) % items.length];
    next?.focus();
    audio.sfx("ui", 0, 0, { positional: false, gain: 0.4 });
  }

  /** Per-frame UI bits: Tab scoreboard, spectator bar, replay bars, panels, gamepad menu nav. */
  private frame() {
    const g = this.game;
    const inRound = session.phase === "round";
    const wantBoard = inRound && g.input.held("scoreboard");
    if (wantBoard && !this.board) {
      this.board = scoreboard();
      this.root.append(this.board);
    } else if (!wantBoard && this.board) {
      this.board.remove();
      this.board = null;
    }
    const dead = inRound && session.view && !session.view.me && session.view.latest;
    if (dead) {
      const cd = g.hauntCooldown();
      const text = `Spectating ${g.spectatingName()}`;
      const keys = `←/→ or click to switch · ${cd > 0 ? `haunt ready in ${Math.ceil(cd)}s` : "Q: drop lava · E: drop slow field (at your cursor)"}`;
      if (!this.spectate) {
        this.spectate = h("div.spectate-bar", null, h("div.who"), h("div.keys"));
        this.root.append(this.spectate);
      }
      const [who, k] = [this.spectate.children[0], this.spectate.children[1]];
      if (who && who.textContent !== text) who.textContent = text;
      if (k && k.textContent !== keys) k.textContent = keys;
    } else if (this.spectate) {
      this.spectate.remove();
      this.spectate = null;
    }
    if (session.phase === "replay" && !this.replayEl) {
      this.replayEl = h("div.replay-bars", { style: { position: "absolute", inset: "0", pointerEvents: "none" } }, h("div.replay-title", null, "FINAL BLOW"));
      this.root.append(this.replayEl);
    } else if (session.phase !== "replay" && this.replayEl) {
      this.replayEl.remove();
      this.replayEl = null;
    }
    this.net?.update();
    this.debug?.update();
    // Gamepad: D-pad navigates, A clicks the focused button in menus.
    if (session.phase !== "round") {
      if (g.input.padPressed(13) || g.input.padPressed(15)) this.moveFocus(1);
      if (g.input.padPressed(12) || g.input.padPressed(14)) this.moveFocus(-1);
      if (g.input.padPressed(0)) (document.activeElement as HTMLElement | null)?.click();
    }
    // Draft/ult countdown bars and lock pips refresh via the session; nothing per-frame needed.
  }
}
