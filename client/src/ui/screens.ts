// Screen router: shows the right DOM screen for the session phase, plus overlays
// (settings, how-to, the in-match Esc menu, Tab scoreboard, F1/F2 panels, spectator bar,
// shard draft, toasts).
// A screen is rebuilt only when its structural key changes; data changes call its update() hook,
// so animations never replay and typing/focus are never interrupted.

import { isMapId } from "@prism/shared";
import { audio } from "../audio/audio";
import type { Game } from "../game";
import { session } from "../net/session";
import { keyLabel } from "../input/input";
import { clear, h } from "./dom";
import { stopConfetti } from "./fx";
import { history } from "./history";
import { lobbyScreen } from "./lobby";
import { menuScreen } from "./menu";
import { howToModal, settingsModal } from "./modals";
import { hudUnit, MENU_BTN } from "./hud";
import { escMenu, spectateBar, type LeaveAction, type MenuExit } from "./overlays";
import { debugPanel, netPanel } from "./panels";
import { draftScreen, shardOverlay, ultScreen } from "./picks";
import { matchEndScreen, scoreboard } from "./results";
import type { Built } from "./types";

const CLICKABLE = ".btn, .tab, .seg button, .swatch, .switch, .x-btn, .code-tile, .card, .bind-btn";

export class Screens {
  private root: HTMLElement;
  private layer = h("div", { style: { position: "absolute", inset: "0", pointerEvents: "none" } });
  private screenKey = "";
  private current: Built | null = null;
  private modal: HTMLElement | null = null;
  private net: ReturnType<typeof netPanel> | null = null;
  private debug: ReturnType<typeof debugPanel> | null = null;
  private board: ReturnType<typeof scoreboard> | null = null;
  private boardAt = 0;
  private spectate: ReturnType<typeof spectateBar> | null = null;
  /** The Esc menu is the open modal (and whether it was built for a dead player). */
  private esc: { el: HTMLElement; key: string } | null = null;
  /** The HUD's always-visible menu button during a match. */
  private menuBtn: HTMLElement | null = null;
  private shard: ReturnType<typeof shardOverlay> | null = null;
  private shardKey = "";
  private autoStart = false;
  private prevPhase = "";
  private lastHover: Element | null = null;

  constructor(private game: Game) {
    const root = document.getElementById("ui");
    if (!root) throw new Error("#ui missing");
    this.root = root;
    this.root.append(this.layer);
    history.install();
    session.subscribe(() => this.sync());
    window.addEventListener("keydown", (e) => this.keys(e));
    this.sound();
    this.sync();
    game.onFrame = () => this.frame();
  }

  /** Delegated UI sounds: a soft tick when hovering something new, a click (or confirm) when pressed. */
  private sound() {
    this.root.addEventListener("pointermove", (e) => {
      const t = (e.target as Element | null)?.closest?.(CLICKABLE) ?? null;
      if (t === this.lastHover) return;
      this.lastHover = t;
      if (t && !t.hasAttribute("disabled") && !t.classList.contains("dim")) audio.sfx("uiHover", 0, 0, { positional: false });
    });
    this.root.addEventListener("click", (e) => {
      const t = (e.target as Element | null)?.closest?.(CLICKABLE);
      if (!t || t.hasAttribute("disabled")) return;
      audio.unlock();
      audio.sfx(t.matches(".btn.primary, .btn.gold, .card") ? "uiConfirm" : t.matches(".x-btn") ? "uiBack" : "uiClick", 0, 0, { positional: false });
    });
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
        return "menu";
      case "lobby":
        return s.room ? "lobby" : "none";
      case "ultSelect":
        return `ult|${s.ultOptions.join()}`;
      case "draft":
        return `draft|${s.draftOptions.join()}`;
      case "matchEnd":
        return `matchEnd|${s.matchEnd ? 1 : 0}`;
      default:
        return s.phase;
    }
  }

  private sync() {
    // Solo practice: a rematch drops straight into the next match.
    if (this.prevPhase === "matchEnd" && session.phase === "lobby" && session.practice && session.room) this.autoStart = true;
    this.prevPhase = session.phase;
    // Practice: once our fresh room exists and we're host, start right away.
    if (this.autoStart && session.phase === "lobby" && session.room && session.room.hostId === session.myId) {
      this.autoStart = false;
      // ?map=crystalWilds (or neonCity) pins the practice map, handy for testing.
      const map = new URLSearchParams(location.search).get("map");
      session.lobbySet(isMapId(map) ? { fillBots: true, map } : { fillBots: true });
      setTimeout(() => session.start(), 250);
    }
    const key = this.key();
    if (key === this.screenKey) {
      this.current?.update?.();
      return;
    }
    const hold = this.current?.hold?.() ?? 0;
    if (hold > 0) {
      window.setTimeout(() => this.sync(), hold + 20);
      return;
    }
    this.screenKey = key;
    this.current?.dispose?.();
    this.current = null;
    clear(this.layer);
    if (!key.startsWith("matchEnd")) stopConfetti();
    const built = this.build();
    if (built) {
      this.current = built;
      built.el.style.pointerEvents = "auto";
      this.layer.append(built.el);
      if (!built.el.classList.contains("picks") && !built.el.classList.contains("title")) this.focusFirst();
    }
  }

  private build(): Built | null {
    switch (session.phase) {
      case "menu":
        return menuScreen(
          {
            openSettings: () => this.openModal(settingsModal(this.game.input, () => this.closeModal())),
            openHowTo: () => this.openModal(howToModal(() => this.closeModal(), this.game.input)),
            practice: () => {
              this.autoStart = true;
              session.createRoom(new URLSearchParams(location.search).has("test"), true);
            },
          },
          this.game.input,
        );
      case "lobby":
        return session.room ? lobbyScreen((t) => this.toast(t)) : null;
      case "ultSelect":
        return ultScreen();
      case "draft":
        return draftScreen();
      case "matchEnd":
        return matchEndScreen(this.root);
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
    el.querySelector<HTMLElement>(".tab.on, [data-nav]")?.focus({ preventScroll: true });
  }

  /** Eliminated and watching (the match view is up but you're not in it). */
  private isDead(): boolean {
    return !!(session.view && !session.view.me && session.view.latest);
  }

  /** Leaving the match: practice ends at the main menu; online, the eliminated go back to the
   *  room's lobby (the match carries on) and anyone still alive can only quit the room. */
  private leaveAction(): LeaveAction {
    const go = (f: () => void) => () => {
      this.closeModal();
      f();
    };
    if (session.practice) return { label: "Back to menu", run: go(() => session.leave()) };
    if (this.isDead()) return { label: "Back to lobby", run: go(() => session.leaveMatch()) };
    return { label: "Leave room", run: go(() => session.leave()) };
  }

  /** In a match (or picking for one): you have a fighter at stake. */
  private inMatch(): boolean {
    return session.phase === "ultSelect" || session.phase === "draft" || session.phase === "countdown" || session.phase === "round";
  }

  /** The Esc menu's ways out for where you are now. Every one ends on Prism Clash's own screens
   *  (never navigating the page away): the title screen, or the room's lobby. */
  private menuExits(): MenuExit[] {
    const go = (f: () => void) => () => {
      this.closeModal();
      f();
    };
    const toMenu = (confirm?: MenuExit["confirm"], hint?: string): MenuExit => ({ id: "menu", label: "Exit to main menu", run: go(() => session.leave()), confirm, hint });
    if (session.phase === "lobby") return [{ id: "room", label: "Leave room", run: go(() => session.leave()), hint: "Back to the title screen." }];
    if (session.phase === "matchEnd") {
      return session.practice ? [toMenu()] : [{ id: "lobby", label: "Back to room lobby", run: go(() => session.leaveMatch()) }, toMenu(undefined, "Leaves the room.")];
    }
    if (!this.inMatch()) return [];
    if (this.isDead()) {
      return session.practice
        ? [toMenu(undefined, "Ends this practice match.")]
        : [{ id: "lobby", label: "Back to room lobby", run: go(() => session.leaveMatch()), hint: "The match carries on; your placement and kills show in the lobby." }, toMenu(undefined, "Leaves the room.")];
    }
    return [toMenu(
      session.practice
        ? { question: "End this practice match?", detail: "You'll go back to the title screen.", yes: "End practice" }
        : { question: "Leave the match?", detail: "You'll be eliminated, and you'll leave the room.", yes: "Leave match" },
    )];
  }

  /** What the Esc menu was built for (rebuilt when it changes, e.g. you're eliminated meanwhile). */
  private menuKey(): string {
    return `${this.inMatch() ? "match" : session.phase}|${this.isDead() ? "dead" : "alive"}|${session.practice ? "p" : "o"}`;
  }

  private openEscMenu() {
    const el = escMenu({
      resumeLabel: this.inMatch() ? "Resume" : "Back",
      note: this.inMatch() && !session.practice ? "The match keeps running while this menu is open." : null,
      exits: this.menuExits(),
      resume: () => this.closeModal(),
      settings: () => this.openModal(settingsModal(this.game.input, () => this.closeModal())),
      howTo: () => this.openModal(howToModal(() => this.closeModal(), this.game.input)),
    });
    this.openModal(el);
    this.esc = { el, key: this.menuKey() };
  }

  private closeModal() {
    this.modal?.remove();
    this.modal = null;
    this.esc = null;
    this.game.input.capture = null;
    // Don't leave a menu button focused under the game (Space would press it again).
    if (this.inMatch() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  private keys(e: KeyboardEvent) {
    if (e.code === "Escape" && this.modal) {
      audio.sfx("uiBack", 0, 0, { positional: false });
      this.closeModal();
      return;
    }
    // Esc opens the menu anywhere past the title screen (unless a text field or rebinding has it).
    if (e.code === "Escape" && session.phase !== "menu" && !this.game.input.capture && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      audio.sfx("uiClick", 0, 0, { positional: false });
      this.openEscMenu();
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
    // Arrow-key navigation for menus (gamepad D-pad maps here too). Left/Right stay with text fields and sliders.
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.code) && session.phase !== "round") {
      const a = document.activeElement;
      const horizontal = e.code === "ArrowLeft" || e.code === "ArrowRight";
      if (horizontal && a instanceof HTMLInputElement) return;
      if (this.game.input.capture) return;
      e.preventDefault();
      this.moveFocus(e.code === "ArrowDown" || e.code === "ArrowRight" ? 1 : -1);
    }
  }

  private moveFocus(dir: number) {
    const scope = this.modal ?? this.layer;
    const items = [...scope.querySelectorAll<HTMLElement>("[data-nav], button:not([data-nav]), input")].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null && !el.classList.contains("dim"));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + dir + items.length) % items.length];
    next?.focus();
    audio.sfx("uiHover", 0, 0, { positional: false });
  }

  /** Per-frame UI bits: screen timers, Tab scoreboard, spectator bar, replay bars, panels, gamepad menu nav. */
  private frame() {
    const g = this.game;
    this.current?.tick?.();
    const inRound = session.phase === "round";
    const wantBoard = inRound && g.input.held("scoreboard");
    if (wantBoard && !this.board) {
      this.board = scoreboard();
      this.root.append(this.board.el);
      this.boardAt = performance.now();
    } else if (!wantBoard && this.board) {
      this.board.el.remove();
      this.board = null;
    } else if (this.board && performance.now() - this.boardAt > 300) {
      this.board.refresh();
      this.boardAt = performance.now();
    }
    const dead = inRound && session.view && !session.view.me && session.view.latest;
    if (dead) {
      if (!this.spectate) {
        this.spectate = spectateBar(this.leaveAction());
        this.root.append(this.spectate.el);
      }
      this.spectate.set(g.spectating(), g.hauntCooldown(), keyLabel(g.input.binds.p1), keyLabel(g.input.binds.p2));
    } else if (this.spectate) {
      this.spectate.el.remove();
      this.spectate = null;
    }
    // The Esc menu follows the game: gone on the title screen, rebuilt when its exits change.
    if (this.esc) {
      if (session.phase === "menu") this.closeModal();
      else if (this.esc.key !== this.menuKey()) this.openEscMenu();
    }
    // The HUD menu button, top left next to the ping chip, whenever the match view is up.
    const showBtn = session.phase === "round" || session.phase === "countdown";
    if (showBtn && !this.menuBtn) {
      this.menuBtn = h("button.hud-menu-btn", { onclick: () => this.openEscMenu(), "aria-label": "Menu", title: "Menu (Esc)" }, h("span.bars"), h("span.lbl", null, "MENU"));
      this.root.append(this.menuBtn);
    } else if (!showBtn && this.menuBtn) {
      this.menuBtn.remove();
      this.menuBtn = null;
    }
    if (this.menuBtn) {
      const u = hudUnit(window.innerWidth, window.innerHeight);
      const st = this.menuBtn.style;
      st.left = `${MENU_BTN.x * u}px`;
      st.top = `${MENU_BTN.y * u}px`;
      st.width = `${MENU_BTN.w * u}px`;
      st.height = `${MENU_BTN.h * u}px`;
      st.setProperty("--u", `${u}px`);
    }
    // In-match Prism Shard draft: the card overlay, while the game keeps running.
    const key = inRound && session.shard ? session.shard.options.join() : "";
    if (key !== this.shardKey) {
      this.shardKey = key;
      this.shard?.dispose();
      this.shard?.el.remove();
      this.shard = null;
      if (key) {
        this.shard = shardOverlay();
        this.root.append(this.shard.el);
      }
    }
    this.shard?.tick();
    this.net?.update();
    this.debug?.update();
    // Gamepad: D-pad navigates, A clicks the focused button in menus.
    if (session.phase !== "round") {
      if (g.input.padPressed(13) || g.input.padPressed(15)) this.moveFocus(1);
      if (g.input.padPressed(12) || g.input.padPressed(14)) this.moveFocus(-1);
      if (g.input.padPressed(0)) (document.activeElement as HTMLElement | null)?.click();
    }
  }
}
