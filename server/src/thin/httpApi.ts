/**
 * Public sim base + CORS helpers (no side effects — safe for unit tests).
 */
import type http from "node:http";
import { PROTOCOL_VERSION, type JoinResponse } from "asymdoom-contracts";

const PORT = Number(process.env.PORT ?? 8666);

/** Comma-separated Origins allowed for CORS (Pages / other thin clients). */
export function parseCorsOrigins(envValue: string | undefined = process.env.CORS_ORIGINS): string[] {
  return (envValue ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Dev defaults so `npm run dev` (Vite :5173 → host) works without env. */
export function defaultDevCorsOrigins(nodeEnv = process.env.NODE_ENV): string[] {
  return nodeEnv !== "production"
    ? ["http://127.0.0.1:5173", "http://localhost:5173"]
    : [];
}

export function allowedOrigins(
  corsEnv = process.env.CORS_ORIGINS,
  nodeEnv = process.env.NODE_ENV,
): Set<string> {
  return new Set([...parseCorsOrigins(corsEnv), ...defaultDevCorsOrigins(nodeEnv)]);
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Public sim base for absolute join URLs.
 * Prefer SIM_PUBLIC_URL; else reconstruct from X-Forwarded-* / Host.
 */
export function publicSimBase(
  req: Pick<http.IncomingMessage, "headers">,
  opts: { simPublicUrl?: string; port?: number } = {},
): string {
  const env = (opts.simPublicUrl ?? process.env.SIM_PUBLIC_URL)?.replace(/\/+$/, "");
  if (env) return env;
  const xfProto = headerFirst(req.headers["x-forwarded-proto"]);
  const xfHost = headerFirst(req.headers["x-forwarded-host"]);
  const host = xfHost ?? req.headers.host ?? `127.0.0.1:${opts.port ?? PORT}`;
  const proto = xfProto ?? "http";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export function corsAllowOrigin(
  req: Pick<http.IncomingMessage, "headers">,
  origins: Set<string> = allowedOrigins(),
): string | null {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== "string") return null;
  if (origins.has(origin)) return origin;
  return null;
}

export function applyCorsHeaders(
  req: Pick<http.IncomingMessage, "headers">,
  res: Pick<http.ServerResponse, "setHeader">,
  origins: Set<string> = allowedOrigins(),
): boolean {
  const allowed = corsAllowOrigin(req, origins);
  if (!allowed) return false;
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

export function buildJoinResponse(
  req: Pick<http.IncomingMessage, "headers">,
  settings: Record<string, unknown>,
  opts: { simPublicUrl?: string; port?: number } = {},
): JoinResponse {
  const base = publicSimBase(req, opts);
  return {
    protocolVersion: PROTOCOL_VERSION,
    mode: "thin",
    wsUrl: base.replace(/^http/, "ws") + "/ws",
    wadUrl: `${base}/doom1.wad`,
    settings,
  };
}
