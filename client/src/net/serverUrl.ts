// Which game server online rooms connect to, in priority order:
//   1. ?server=wss://host/ws in the page URL (remembered in sessionStorage so reloads and
//      invite links keep it), the same pattern other games on the portal use;
//   2. VITE_GAME_SERVER, baked in at build time (e.g. the Vercel build points at Render);
//   3. same-origin /ws (the all-in-one Render deploy and `pnpm dev`).
// Pure functions here; the browser wrapper is currentServer() at the bottom.

export type ServerSource = "param" | "env" | "sameOrigin";

export interface ServerChoice {
  url: string;
  source: ServerSource;
  /** The ?server= value to carry in invite links (only when the server came from the URL). */
  param: string | null;
}

export const SERVER_PARAM = "server";
export const SERVER_STORAGE_KEY = "prism.server";

/**
 * Accepts ws:// and wss:// URLs (http/https are converted). A bare host such as
 * wss://prism-clash.onrender.com gets the server's /ws path. Anything else is rejected.
 */
export function normalizeServerUrl(raw: string | null | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol === "http:") u.protocol = "ws:";
  if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
  if (!u.hostname || u.username || u.password) return null;
  if (u.pathname === "" || u.pathname === "/") u.pathname = "/ws";
  u.hash = "";
  return u.toString();
}

export interface ServerInputs {
  /** location.search */
  search: string;
  /** The remembered ?server= value from sessionStorage, if any. */
  stored: string | null;
  /** import.meta.env.VITE_GAME_SERVER */
  env: string | undefined;
  /** import.meta.env.VITE_WS_URL (older name, still honored). */
  legacyEnv?: string | undefined;
  /** location.protocol and location.host, for the same-origin fallback. */
  protocol: string;
  host: string;
}

export function chooseServer(i: ServerInputs): ServerChoice {
  const fromUrl = normalizeServerUrl(new URLSearchParams(i.search).get(SERVER_PARAM));
  if (fromUrl) return { url: fromUrl, source: "param", param: fromUrl };
  const remembered = normalizeServerUrl(i.stored);
  if (remembered) return { url: remembered, source: "param", param: remembered };
  const env = normalizeServerUrl(i.env) ?? normalizeServerUrl(i.legacyEnv);
  if (env) return { url: env, source: "env", param: null };
  const proto = i.protocol === "https:" ? "wss:" : "ws:";
  return { url: `${proto}//${i.host}/ws`, source: "sameOrigin", param: null };
}

/** A room invite link; carries ?server= when the game server came from the URL. */
export function inviteUrl(pageBase: string, code: string, serverParam: string | null): string {
  const q = new URLSearchParams({ room: code });
  if (serverParam) q.set(SERVER_PARAM, serverParam);
  return `${pageBase}?${q.toString()}`;
}

/** The game server for this page (remembers a ?server= param for the rest of the tab session). */
export function currentServer(): ServerChoice {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(SERVER_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  const choice = chooseServer({
    search: location.search,
    stored,
    env: import.meta.env.VITE_GAME_SERVER as string | undefined,
    legacyEnv: import.meta.env.VITE_WS_URL as string | undefined,
    protocol: location.protocol,
    host: location.host,
  });
  if (choice.param && choice.param !== stored) {
    try {
      sessionStorage.setItem(SERVER_STORAGE_KEY, choice.param);
    } catch {
      /* storage blocked */
    }
  }
  return choice;
}
