/**
 * asymdoom-contracts — shared thin-client protocol constants and URL helpers.
 * JSON Schemas live under schemas/; fixtures under fixtures/.
 * Non-TS clients: use PROTOCOL.md + schemas/ directly.
 */

/** Wire protocol version. Bump in lockstep across host and all clients. */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** Response body for POST /api/join (see schemas/protocol/join.schema.json). */
export interface JoinResponse {
  protocolVersion: ProtocolVersion;
  mode: "thin";
  /** Absolute WebSocket URL (ws:// or wss://). Append ?sessionId= to resume. */
  wsUrl: string;
  /** Absolute HTTP URL for the shareware IWAD. */
  wadUrl: string;
  settings: Record<string, unknown>;
  /** @deprecated Actual role arrives in welcome over the WebSocket. */
  role?: string;
}

/** Strip trailing slashes from a sim base URL. */
export function normalizeSimBase(simBase: string): string {
  return simBase.replace(/\/+$/, "");
}

/** HTTP join endpoint: POST {sim}/api/join */
export function joinUrl(simBase: string): string {
  return `${normalizeSimBase(simBase)}/api/join`;
}

/**
 * Absolute WebSocket URL for the thin protocol.
 * Prefer the wsUrl from JoinResponse when available; this helper is for
 * clients that compose from a known sim base (or tests).
 */
export function wsUrl(simBase: string, sessionId?: string | null): string {
  const base = normalizeSimBase(simBase);
  const http = new URL(base.includes("://") ? base : `http://${base}`);
  const proto = http.protocol === "https:" ? "wss:" : "ws:";
  const path = "/ws";
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return `${proto}//${http.host}${path}${q}`;
}

/** Absolute HTTP URL for doom1.wad on the sim host. */
export function wadUrl(simBase: string): string {
  return `${normalizeSimBase(simBase)}/doom1.wad`;
}

/**
 * Attach sessionId to an absolute wsUrl from JoinResponse.
 * If the URL already has a query string, sessionId is appended with &.
 */
export function withSessionId(absoluteWsUrl: string, sessionId: string | null | undefined): string {
  if (!sessionId) return absoluteWsUrl;
  const u = new URL(absoluteWsUrl);
  u.searchParams.set("sessionId", sessionId);
  return u.toString();
}
