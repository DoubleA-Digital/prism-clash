// Hero picker: the 8 chibi heroes as portrait cards (name + tagline), click or arrow keys to
// choose. Self-contained: mount it anywhere, read choices through onSelect.
//
//   const picker = mountHeroPicker(el, { selected: "blaze", color: "#00F0FF", onSelect: (id) => send(id) });
//   picker.setColor(hex); picker.setSelected(id); picker.destroy();

import { HERO_IDS, HEROES, type HeroId } from "@prism/shared";
import { drawHeroPortrait } from "../render/chibi";
import "./css/heroPicker.css";

export interface HeroPickerOptions {
  /** Initially selected hero. */
  selected?: HeroId;
  /** Player color hex; portraits wear it as their rim glow. */
  color?: string;
  /** Heroes shown as unavailable (optional). */
  disabled?: readonly HeroId[];
  onSelect: (id: HeroId) => void;
}

export interface HeroPicker {
  el: HTMLElement;
  setSelected(id: HeroId): void;
  setColor(hex: string): void;
  setDisabled(ids: readonly HeroId[]): void;
  destroy(): void;
}

const PORTRAIT = 136;

export function mountHeroPicker(parent: HTMLElement, opts: HeroPickerOptions): HeroPicker {
  let selected: HeroId = opts.selected ?? HERO_IDS[0];
  let color = opts.color ?? "#00F0FF";
  let disabled = new Set<HeroId>(opts.disabled ?? []);
  const root = document.createElement("div");
  root.className = "hero-picker";
  root.setAttribute("role", "radiogroup");
  root.setAttribute("aria-label", "Choose your hero");
  const cards = new Map<HeroId, { btn: HTMLButtonElement; canvas: HTMLCanvasElement }>();

  const paint = (id: HeroId) => {
    const c = cards.get(id);
    if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.round(PORTRAIT * dpr);
    if (c.canvas.width !== px) c.canvas.width = c.canvas.height = px;
    const g = c.canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.scale(dpr, dpr);
    drawHeroPortrait(g, id, color, PORTRAIT);
  };

  const sync = () => {
    for (const [id, c] of cards) {
      const on = id === selected;
      c.btn.classList.toggle("on", on);
      c.btn.classList.toggle("off", disabled.has(id));
      c.btn.disabled = disabled.has(id);
      c.btn.setAttribute("aria-checked", String(on));
      c.btn.tabIndex = on ? 0 : -1;
    }
    root.style.setProperty("--c", color);
  };

  const choose = (id: HeroId, focus = false) => {
    if (disabled.has(id)) return;
    const changed = id !== selected;
    selected = id;
    sync();
    if (focus) cards.get(id)?.btn.focus();
    if (changed) {
      const c = cards.get(id);
      c?.btn.classList.remove("picked");
      void c?.btn.offsetWidth;
      c?.btn.classList.add("picked");
    }
    opts.onSelect(id);
  };

  HERO_IDS.forEach((id, i) => {
    const h = HEROES[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hero-card";
    btn.setAttribute("role", "radio");
    btn.style.setProperty("--i", String(i));
    btn.style.setProperty("--h", h.palette.accent);
    btn.dataset.hero = id;
    const canvas = document.createElement("canvas");
    canvas.className = "hero-portrait";
    canvas.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "hero-name";
    name.textContent = h.name;
    const tag = document.createElement("span");
    tag.className = "hero-tag";
    tag.textContent = h.tagline;
    btn.append(canvas, name, tag);
    btn.setAttribute("aria-label", `${h.name}: ${h.tagline}`);
    btn.addEventListener("click", () => choose(id));
    root.append(btn);
    cards.set(id, { btn, canvas });
  });

  const onKey = (e: KeyboardEvent) => {
    const cols = Math.max(1, Math.round(root.clientWidth / (cards.get(selected)?.btn.offsetWidth || 1)));
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    const d = step[e.key];
    if (d === undefined) return;
    e.preventDefault();
    let i = HERO_IDS.indexOf(selected);
    for (let n = 0; n < HERO_IDS.length; n++) {
      i = (i + d + HERO_IDS.length) % HERO_IDS.length;
      const id = HERO_IDS[i];
      if (id && !disabled.has(id)) return choose(id, true);
    }
  };
  root.addEventListener("keydown", onKey);

  parent.append(root);
  for (const id of HERO_IDS) paint(id);
  sync();

  return {
    el: root,
    setSelected(id) {
      selected = id;
      sync();
    },
    setColor(hex) {
      if (hex === color) return;
      color = hex;
      for (const id of HERO_IDS) paint(id);
      sync();
    },
    setDisabled(ids) {
      disabled = new Set(ids);
      sync();
    },
    destroy() {
      root.removeEventListener("keydown", onKey);
      root.remove();
      cards.clear();
    },
  };
}
