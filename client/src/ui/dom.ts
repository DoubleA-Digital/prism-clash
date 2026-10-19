// Tiny DOM helper: h("div.cls#id", {attrs}, children). Keeps screens readable without a framework.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { style?: Partial<CSSStyleDeclaration> | Record<string, string> };

export function h<K extends keyof HTMLElementTagNameMap>(tagSpec: K | string, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElement {
  const [tagPart, ...rest] = tagSpec.split(/(?=[.#])/);
  const el = document.createElement(tagPart || "div");
  for (const r of rest) {
    if (r.startsWith(".")) el.classList.add(r.slice(1));
    else if (r.startsWith("#")) el.id = r.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "style" && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
          if (sk.startsWith("--")) el.style.setProperty(sk, sv);
          else (el.style as unknown as Record<string, string>)[sk] = sv;
        }
      } else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === "class") {
        for (const c of String(v).split(/\s+/).filter(Boolean)) el.classList.add(c);
      } else if (v === true) {
        el.setAttribute(k, "");
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
