// Input validation and per-connection rate limiting. The server trusts nothing a client
// sends: names are sanitized, messages are size- and schema-checked, floods get cut off.

import { NET } from "@prism/shared";

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const clean = raw.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return [...clean].slice(0, NET.nameMaxLength).join("");
}

export function isRoomCode(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Z]{5}$/.test(raw);
}

export const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface RateState {
  second: number;
  inputs: number;
  other: number;
  strikes: number;
}

/** Returns "ok", "drop" (over the limit this second) or "kick" (repeated flooding). */
export function rateCheck(r: RateState, kind: "input" | "other", nowMs: number): "ok" | "drop" | "kick" {
  const sec = Math.floor(nowMs / 1000);
  if (sec !== r.second) {
    r.second = sec;
    r.inputs = 0;
    r.other = 0;
  }
  const lim = kind === "input" ? NET.rateLimit.inputsPerSecond : NET.rateLimit.otherPerSecond;
  const n = kind === "input" ? ++r.inputs : ++r.other;
  if (n === lim + 1) r.strikes++;
  if (r.strikes >= NET.rateLimit.floodStrikes) return "kick";
  return n > lim ? "drop" : "ok";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * WebSocket Origin policy. The client may be hosted elsewhere (Vercel, a games portal), so any
 * https page may connect, plus plain-http pages on localhost and the server's own host. A
 * missing Origin (non-browser clients, tests) is allowed: Origin only protects browsers.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  return LOCAL_HOSTS.has(u.hostname) || (!!host && u.host === host);
}
